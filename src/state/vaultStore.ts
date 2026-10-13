/**
 * Unlocked vault state.
 *
 * The master key is held here for the lifetime of an unlocked session and
 * cleared on lock. That is the entire security model of the unlocked state:
 * whoever can read this store can read the vault, so it lives in memory only
 * and never touches storage.
 *
 * Items and standalone notes are persisted as separate authenticated
 * ciphertexts. The encrypted header holds templates and settings, so editing a
 * record does not re-encrypt unrelated data.
 */
import { create } from 'zustand'
import type { KdfParams } from '@/crypto/envelope'
import { DecryptError } from '@/crypto/aes'
import { cancelPendingClear } from '@/lib/clipboard'
import { newId } from '@/lib/id'
import { createBuiltinTemplates, isBuiltinTemplateId, LEGACY_NOTE_TEMPLATE_ID } from '@/storage/builtins'
import { validateFolderPlacement, validateFolderTree } from '@/storage/noteFolders'
import { clearSyncSessionKey } from '@/sync/syncEngine'
import {
  removeItemFields,
  resolveFields,
  touchItem,
  touchTemplate,
} from '@/storage/templateEngine'
import {
  DEFAULT_SETTINGS,
  VAULT_PAYLOAD_VERSION,
  type VaultItem,
  type VaultNote,
  type VaultNoteFolder,
  type VaultPayload,
  type VaultSettings,
  type VaultTemplate,
  type CustomField,
} from '@/storage/types'
import {
  WrongPasswordError,
  createVault,
  getHeaderSignature,
  getVaultState,
  savePayloadChanges,
  unlock,
} from '@/storage/vaultService'
import { DEFAULT_GITHUB_SYNC_CONFIG, type GitHubSyncConfig } from '@/sync/types'

/** Which screen the app is showing. */
export type Screen = 'loading' | 'onboarding' | 'unlock' | 'vault'

export interface VaultStore {
  screen: Screen
  /** True once the first state probe has finished. */
  ready: boolean

  items: VaultItem[]
  notes: VaultNote[]
  /** Deleted note tombstones retained until remote sync propagates them. */
  deletedNotes: VaultNote[]
  noteFolders: VaultNoteFolder[]
  deletedNoteFolders: VaultNoteFolder[]
  /**
   * Soft-deleted items, kept out of the UI but retained in memory so their
   * tombstones still reach the sync payload.
   *
   * This is load-bearing: if deleted items were simply dropped, the next save
   * would rewrite the vault without them and a sync would treat the absent
   * record as "never deleted", resurrecting it on the other device.
   */
  deletedItems: VaultItem[]
  templates: VaultTemplate[]
  settings: VaultSettings
  sync: { config: GitHubSyncConfig }

  /** True while a write is in flight; the shell uses this for the save indicator. */
  saving: boolean
  /** True while unlock or creation is running, so buttons can show progress. */
  busy: boolean
  /** Human-readable error for the current screen, cleared on the next action. */
  error: string | null

  // Non-serialisable session material. Held in module scope below rather than
  // in the store so it never lands in devtools snapshots or persistence.
  lastSavedAt: number | null

  // Actions
  initialize: () => Promise<void>
  createNewVault: (
    password: string,
    confirm: string,
    syncConfig?: GitHubSyncConfig,
  ) => Promise<boolean>
  unlockVault: (password: string) => Promise<boolean>
  lock: () => void
  addItem: (item: VaultItem) => Promise<void>
  addItems: (items: VaultItem[]) => Promise<void>
  updateItem: (id: string, changes: Partial<VaultItem>) => Promise<void>
  saveItemFromForm: (
    item: VaultItem,
    template: VaultTemplate | null,
    input: Record<string, unknown>,
    title: string,
    tags: string[],
    notes: string,
    customFields: CustomField[],
    fieldOrder: string[],
    removedFieldIds: string[],
  ) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  restoreItem: (id: string) => Promise<void>

  addNote: (title: string, markdown: string, folderId?: string | null) => Promise<VaultNote>
  updateNote: (id: string, changes: Pick<VaultNote, 'title' | 'markdown' | 'folderId'>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  restoreNote: (id: string) => Promise<void>
  addNoteFolder: (name: string, parentId: string | null) => Promise<VaultNoteFolder>
  updateNoteFolder: (id: string, changes: Pick<VaultNoteFolder, 'name' | 'parentId'>) => Promise<void>
  deleteNoteFolder: (id: string) => Promise<string | null>

  addTemplate: (
    template: Omit<VaultTemplate, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>,
  ) => Promise<VaultTemplate | null>
  updateTemplate: (id: string, changes: Partial<VaultTemplate>) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  duplicateTemplate: (id: string) => Promise<VaultTemplate | null>

  updateSettings: (changes: Partial<VaultSettings>) => Promise<void>
  updateSyncConfig: (changes: Partial<GitHubSyncConfig>) => Promise<void>

  /** Replaces the whole payload, used by the sync merge. */
  applyMergedPayload: (payload: VaultPayload) => Promise<void>
  clearError: () => void
}

// --- Session material, deliberately outside the store ------------------------

let masterKey: CryptoKey | null = null
let masterKdf: KdfParams | null = null
/** Monotonic guard so a slow persist cannot overwrite a newer one. */
let writeSequence = 0
let persistQueue: Promise<void> = Promise.resolve()
let persistedItems = new Map<string, VaultItem>()
let persistedNotes = new Map<string, VaultNote>()
let persistedHeaderSignature = ''

function hasSession(): boolean {
  return masterKey !== null && masterKdf !== null
}

/** Drops key material. Called on lock, auto-lock, and explicit sign-out. */
function clearSession(): void {
  masterKey = null
  masterKdf = null
  clearSyncSessionKey()
  cancelPendingClear()
  persistedItems = new Map()
  persistedNotes = new Map()
  persistedHeaderSignature = ''
}

function rememberPersistedPayload(payload: VaultPayload): void {
  persistedItems = new Map(payload.items.map((item) => [item.id, item]))
  persistedNotes = new Map((payload.notes ?? []).map((note) => [note.id, note]))
  persistedHeaderSignature = getHeaderSignature(payload)
}

function toPayload(state: VaultStore): VaultPayload {
  return {
    version: VAULT_PAYLOAD_VERSION,
    // Tombstones included so deletes propagate. See `deletedItems` above.
    items: [...state.items, ...state.deletedItems],
    notes: [...state.notes, ...state.deletedNotes],
    noteFolders: [...state.noteFolders, ...state.deletedNoteFolders],
    templates: state.templates,
    settings: state.settings,
    updatedAt: Date.now(),
    sync: { config: state.sync.config },
  }
}

export const useVaultStore = create<VaultStore>()((set, get) => {
  /**
   * Writes changed encrypted item records and a changed encrypted header.
   *
   * Writes are serialized so an older encryption cannot replace a newer edit.
   */
  async function persist(): Promise<void> {
    if (!hasSession()) return

    const sequence = ++writeSequence
    set({ saving: true })

    const operation = persistQueue.then(async () => {
      if (!hasSession()) return
      const payload = toPayload(get())
      const currentIds = new Set(payload.items.map((item) => item.id))
      const changedItems = payload.items.filter((item) => persistedItems.get(item.id) !== item)
      const deletedIds = [...persistedItems.keys()].filter((id) => !currentIds.has(id))
      const notes = payload.notes ?? []
      const currentNoteIds = new Set(notes.map((note) => note.id))
      const changedNotes = notes.filter((note) => persistedNotes.get(note.id) !== note)
      const deletedNoteIds = [...persistedNotes.keys()].filter((id) => !currentNoteIds.has(id))
      const headerChanged = getHeaderSignature(payload) !== persistedHeaderSignature

      await savePayloadChanges(
        payload,
        masterKey!,
        masterKdf!,
        changedItems,
        deletedIds,
        headerChanged,
        Date.now(),
        changedNotes,
        deletedNoteIds,
      )
      rememberPersistedPayload(payload)
    })
    persistQueue = operation.catch(() => undefined)

    try {
      await operation
      // A newer write landed while this one was in flight; drop this result.
      if (sequence === writeSequence) {
        set({ saving: false, lastSavedAt: Date.now() })
      }
    } catch (cause) {
      set({
        saving: false,
        error: cause instanceof Error ? cause.message : 'Could not save the vault',
      })
    }
  }

  function adoptPayload(payload: VaultPayload): void {
    const templates = payload.templates.length > 0 ? payload.templates : createBuiltinTemplates()
    const migratedTemplates = templates.map((template) =>
      template.id === LEGACY_NOTE_TEMPLATE_ID && !template.deleted
        ? { ...template, deleted: true, updatedAt: Math.max(Date.now(), template.updatedAt + 1) }
        : template,
    )
    set({
      items: payload.items.filter((item) => !item.deleted),
      deletedItems: payload.items.filter((item) => item.deleted),
      notes: (payload.notes ?? []).filter((note) => !note.deleted),
      deletedNotes: (payload.notes ?? []).filter((note) => note.deleted),
      noteFolders: (payload.noteFolders ?? []).filter((folder) => !folder.deleted),
      deletedNoteFolders: (payload.noteFolders ?? []).filter((folder) => folder.deleted),
      templates: migratedTemplates,
      settings: { ...DEFAULT_SETTINGS, ...payload.settings },
      sync: {
        config: { ...DEFAULT_GITHUB_SYNC_CONFIG, ...(payload.sync?.config ?? {}) },
      },
      screen: 'vault',
    })
  }

  /** Maps a thrown value to a message appropriate for the current screen. */
  function describeError(cause: unknown): string {
    if (cause instanceof WrongPasswordError) return 'Incorrect master password'
    if (cause instanceof DecryptError) {
      return cause.reason === 'corrupt-payload'
        ? 'The stored vault is damaged and cannot be decrypted on this device'
        : 'Could not decrypt the vault'
    }
    return cause instanceof Error ? cause.message : 'Something went wrong'
  }

  return {
    screen: 'loading',
    ready: false,
    items: [],
    notes: [],
    deletedNotes: [],
    noteFolders: [],
    deletedNoteFolders: [],
    deletedItems: [],
    templates: [],
    settings: { ...DEFAULT_SETTINGS },
    sync: { config: { ...DEFAULT_GITHUB_SYNC_CONFIG } },
    saving: false,
    busy: false,
    error: null,
    lastSavedAt: null,

    async initialize() {
      try {
        // Map the service's vocabulary onto the app's screens: the service
        // reports storage-level states, while `unlock` and `vault` are UI
        // concepts.
        const state = await getVaultState()
        const screen: Screen =
          state === 'uninitialized'
            ? 'onboarding'
            : state === 'unlocked'
              ? 'vault'
              : 'unlock'
        set({ screen, ready: true })
      } catch (cause) {
        set({ screen: 'onboarding', ready: true, error: describeError(cause) })
      }
    },

    async createNewVault(password, confirm, syncConfig) {
      if (password.length < 8) {
        set({ error: 'Use a master password of at least 8 characters' })
        return false
      }
      if (password !== confirm) {
        set({ error: 'The two passwords do not match' })
        return false
      }

      set({ busy: true, error: null })
      try {
        const result = await createVault(password, Date.now(), syncConfig)
        masterKey = result.key
        masterKdf = result.kdf
        adoptPayload(result.payload)
        rememberPersistedPayload(result.payload)
        set({ busy: false })
        return true
      } catch (cause) {
        set({ busy: false, error: describeError(cause) })
        return false
      }
    },

    async unlockVault(password) {
      set({ busy: true, error: null })
      try {
        const result = await unlock(password)
        masterKey = result.key
        masterKdf = result.kdf
        adoptPayload(result.payload)
        rememberPersistedPayload(result.payload)
        set({ busy: false })
        return true
      } catch (cause) {
        set({ busy: false, error: describeError(cause) })
        return false
      }
    },

    lock() {
      clearSession()
      // Wipe decrypted contents from the tree as well as the key: leaving
      // items rendered on screen after a lock would defeat the purpose.
      set({
        screen: 'unlock',
        items: [],
        notes: [],
        deletedNotes: [],
        noteFolders: [],
        deletedNoteFolders: [],
        deletedItems: [],
        sync: { config: { ...DEFAULT_GITHUB_SYNC_CONFIG } },
        error: null,
        saving: false,
      })
    },

    async addItem(item) {
      set((state) => ({ items: [...state.items, item] }))
      await persist()
    },

    async addItems(items) {
      if (items.length === 0) return
      set((state) => ({ items: [...state.items, ...items] }))
      await persist()
    },

    async updateItem(id, changes) {
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id ? touchItem({ ...item, ...changes }) : item,
        ),
      }))
      await persist()
    },

    async saveItemFromForm(
      item,
      template,
      input,
      title,
      tags,
      notes,
      customFields,
      fieldOrder,
      removedFieldIds,
    ) {
      const resolved = resolveFields(item, template)
      const removedIds = new Set(removedFieldIds)
      set((state) => ({
        items: state.items.map((existing) => {
          if (existing.id !== item.id) return existing

          // Removing a field in this item editor is an explicit request to
          // erase its value on save. Template-level edits remain non-destructive.
          const retained = removeItemFields(existing, removedFieldIds)
          const values = { ...retained.values }
          for (const field of resolved) {
            if (field.custom || removedIds.has(field.id)) continue
            const value = input[field.id]
            if (typeof value === 'string' && value.length > 0) values[field.id] = value
            else delete values[field.id]
          }
          for (const custom of customFields) delete values[custom.id]

          return touchItem({
            ...existing,
            templateId: template?.id ?? null,
            title: title.trim(),
            values,
            hiddenFieldIds: [
              ...new Set([
                ...(item.hiddenFieldIds ?? []),
                ...removedFieldIds.filter((id) => template?.fields.some((field) => field.id === id)),
              ]),
            ],
            customFields: customFields
              .filter((custom) => !removedIds.has(custom.id))
              .map((custom) => ({
                ...custom,
                value:
                  typeof input[custom.id] === 'string'
                    ? (input[custom.id] as string)
                    : custom.value,
              })),
            fieldOrder: fieldOrder.filter((id) => !removedIds.has(id)),
            tags,
            notes,
          })
        }),
      }))
      await persist()
    },

    async deleteItem(id) {
      // Soft delete: the tombstone is what lets a delete propagate through the
      // sync merge instead of being undone by a stale copy on another device.
      const now = Date.now()
      set((state) => {
        const item = state.items.find((candidate) => candidate.id === id)
        if (!item) return state
        return {
          items: state.items.filter((candidate) => candidate.id !== id),
          deletedItems: [...state.deletedItems, { ...touchItem(item, now), deleted: true }],
        }
      })
      await persist()
    },

    async restoreItem(id) {
      const now = Date.now()
      set((state) => {
        const item = state.deletedItems.find((candidate) => candidate.id === id)
        if (!item) return state
        return {
          items: [...state.items, { ...touchItem(item, now), deleted: false }],
          deletedItems: state.deletedItems.filter((candidate) => candidate.id !== id),
        }
      })
      await persist()
    },

    async addNote(title, markdown, folderId = null) {
      const now = Date.now()
      if (folderId && !get().noteFolders.some((folder) => folder.id === folderId)) {
        throw new Error('The selected folder no longer exists')
      }
      const note: VaultNote = {
        id: newId(),
        title: title.trim() || 'Untitled',
        markdown,
        folderId,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }
      set((state) => ({ notes: [...state.notes, note] }))
      await persist()
      return note
    },

    async updateNote(id, changes) {
      if (changes.folderId && !get().noteFolders.some((folder) => folder.id === changes.folderId)) {
        throw new Error('The selected folder no longer exists')
      }
      const now = Date.now()
      set((state) => ({
        notes: state.notes.map((note) =>
          note.id === id
            ? {
                ...note,
                title: changes.title.trim() || 'Untitled',
                markdown: changes.markdown,
                folderId: changes.folderId === undefined ? note.folderId ?? null : changes.folderId,
                updatedAt: now,
              }
            : note,
        ),
      }))
      await persist()
    },

    async deleteNote(id) {
      const now = Date.now()
      set((state) => {
        const note = state.notes.find((candidate) => candidate.id === id)
        if (!note) return state
        return {
          notes: state.notes.filter((candidate) => candidate.id !== id),
          deletedNotes: [...state.deletedNotes, { ...note, updatedAt: now, deleted: true }],
        }
      })
      await persist()
    },

    async restoreNote(id) {
      const now = Date.now()
      set((state) => {
        const note = state.deletedNotes.find((candidate) => candidate.id === id)
        if (!note) return state
        return {
          notes: [...state.notes, { ...note, updatedAt: now, deleted: false }],
          deletedNotes: state.deletedNotes.filter((candidate) => candidate.id !== id),
        }
      })
      await persist()
    },

    async addNoteFolder(name, parentId) {
      const now = Date.now()
      const folder: VaultNoteFolder = {
        id: newId(),
        name: name.trim(),
        parentId,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }
      if (!folder.name) throw new Error('Enter a folder name')
      validateFolderPlacement(get().noteFolders, folder.id, parentId, folder.name)
      set((state) => ({ noteFolders: [...state.noteFolders, folder] }))
      await persist()
      return folder
    },

    async updateNoteFolder(id, changes) {
      const current = get().noteFolders.find((folder) => folder.id === id)
      if (!current) return
      const name = changes.name.trim()
      if (!name) throw new Error('Enter a folder name')
      validateFolderPlacement(get().noteFolders, id, changes.parentId, name)
      const now = Date.now()
      set((state) => ({
        noteFolders: state.noteFolders.map((folder) =>
          folder.id === id ? { ...folder, name, parentId: changes.parentId, updatedAt: now } : folder,
        ),
      }))
      await persist()
    },

    async deleteNoteFolder(id) {
      const folder = get().noteFolders.find((candidate) => candidate.id === id)
      if (!folder) return null
      const parentId = folder.parentId && get().noteFolders.some((candidate) => candidate.id === folder.parentId)
        ? folder.parentId
        : null
      const now = Date.now()
      set((state) => {
        const moving = state.noteFolders.filter((candidate) => !candidate.deleted && candidate.parentId === id)
        const siblingNames = new Set(state.noteFolders
          .filter((candidate) => !candidate.deleted && candidate.parentId === parentId && candidate.id !== id && candidate.parentId !== id)
          .map((candidate) => candidate.name.trim().toLowerCase()))
        const movedNames = new Map<string, string>()
        for (const child of moving) {
          const base = child.name
          let unique = base
          let suffix = 2
          while (siblingNames.has(unique.toLowerCase())) {
            unique = `${base} (${suffix})`
            suffix += 1
          }
          siblingNames.add(unique.toLowerCase())
          movedNames.set(child.id, unique)
        }
        const noteFolders = state.noteFolders.map((candidate) =>
          candidate.id === id
            ? { ...candidate, deleted: true, updatedAt: now }
            : candidate.parentId === id
              ? { ...candidate, name: movedNames.get(candidate.id) ?? candidate.name, parentId, updatedAt: now }
              : candidate,
        )
        const activeFolders = noteFolders.filter((candidate) => !candidate.deleted)
        const deletedFolders = noteFolders.filter((candidate) => candidate.deleted)
        validateFolderTree([...activeFolders, ...state.deletedNoteFolders, ...deletedFolders])
        return {
          noteFolders: activeFolders,
          deletedNoteFolders: [...state.deletedNoteFolders, ...deletedFolders],
          notes: state.notes.map((note) => note.folderId === id
            ? { ...note, folderId: parentId, updatedAt: now }
            : note),
          deletedNotes: state.deletedNotes.map((note) => note.folderId === id
            ? { ...note, folderId: parentId, updatedAt: now }
            : note),
        }
      })
      await persist()
      return parentId
    },

    async addTemplate(definition) {
      const now = Date.now()
      const template: VaultTemplate = {
        ...definition,
        id: newId(),
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }
      set((state) => ({ templates: [...state.templates, template] }))
      await persist()
      return template
    },

    async updateTemplate(id, changes) {
      set((state) => ({
        templates: state.templates.map((template) =>
          template.id === id ? touchTemplate({ ...template, ...changes }) : template,
        ),
      }))
      await persist()
    },

    async deleteTemplate(id) {
      if (isBuiltinTemplateId(id)) return
      set((state) => ({
        // Tombstone rather than remove, so the delete propagates to other
        // devices on the next sync instead of being undone by their copy.
        templates: state.templates.map((template) =>
          template.id === id ? { ...touchTemplate(template), deleted: true } : template,
        ),
        // Items survive their template. They become template-less rather than
        // being deleted along with it.
        items: state.items.map((item) =>
          item.templateId === id ? touchItem({ ...item, templateId: null }) : item,
        ),
      }))
      await persist()
    },

    async duplicateTemplate(id) {
      const source = get().templates.find(
        (template) => template.id === id && !template.deleted,
      )
      if (!source) return null
      const now = Date.now()
      const copy: VaultTemplate = {
        ...source,
        id: newId(),
        name: `${source.name} copy`,
        builtIn: false,
        // Fresh field ids: sharing them with the original would make an edit to
        // one template's field ambiguous for items on the other.
        fields: source.fields.map((field) => ({ ...field, id: newId() })),
        createdAt: now,
        updatedAt: now,
      }
      set((state) => ({ templates: [...state.templates, copy] }))
      await persist()
      return copy
    },

    async updateSettings(changes) {
      set((state) => ({ settings: { ...state.settings, ...changes } }))
      await persist()
    },

    async updateSyncConfig(changes) {
      set((state) => ({ sync: { ...state.sync, config: { ...state.sync.config, ...changes } } }))
      await persist()
    },

    async applyMergedPayload(payload) {
      adoptPayload(payload)
      await persist()
    },

    clearError() {
      set({ error: null })
    },
  }
})

export type { VaultItem, VaultTemplate }
