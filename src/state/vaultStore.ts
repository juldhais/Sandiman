/**
 * Unlocked vault state.
 *
 * The master key is held here for the lifetime of an unlocked session and
 * cleared on lock. That is the entire security model of the unlocked state:
 * whoever can read this store can read the vault, so it lives in memory only
 * and never touches storage.
 *
 * Every mutation goes through `persist`, which re-encrypts the whole payload.
 * That is deliberate. Encrypting the vault as one AES-GCM blob means there is
 * no per-item ciphertext to leak through index or timing side channels, and
 * the write cost is negligible at the scale of a personal vault.
 */
import { create } from 'zustand'
import type { KdfParams } from '@/crypto/envelope'
import { DecryptError } from '@/crypto/aes'
import { cancelPendingClear } from '@/lib/clipboard'
import { newId } from '@/lib/id'
import { createBuiltinTemplates, isBuiltinTemplateId } from '@/storage/builtins'
import {
  collectValues,
  resolveFields,
  suggestTitle,
  touchItem,
  touchTemplate,
} from '@/storage/templateEngine'
import {
  DEFAULT_SETTINGS,
  VAULT_PAYLOAD_VERSION,
  type VaultItem,
  type VaultPayload,
  type VaultSettings,
  type VaultTemplate,
} from '@/storage/types'
import {
  WrongPasswordError,
  createVault,
  getVaultState,
  savePayload,
  unlock,
} from '@/storage/vaultService'
import { DEFAULT_AZURE_SYNC_CONFIG, type AzureSyncConfig } from '@/sync/types'

/** Which screen the app is showing. */
export type Screen = 'loading' | 'onboarding' | 'unlock' | 'vault'

export interface VaultStore {
  screen: Screen
  /** True once the first state probe has finished. */
  ready: boolean

  items: VaultItem[]
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
  sync: { config: AzureSyncConfig; password: string }

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
  createNewVault: (password: string, confirm: string) => Promise<boolean>
  unlockVault: (password: string) => Promise<boolean>
  lock: () => void
  addItem: (item: VaultItem) => Promise<void>
  updateItem: (id: string, changes: Partial<VaultItem>) => Promise<void>
  saveItemFromForm: (
    item: VaultItem,
    template: VaultTemplate | null,
    input: Record<string, unknown>,
    title: string,
    tags: string[],
    notes: string,
  ) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  restoreItem: (id: string) => Promise<void>

  addTemplate: (
    template: Omit<VaultTemplate, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>,
  ) => Promise<VaultTemplate | null>
  updateTemplate: (id: string, changes: Partial<VaultTemplate>) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  duplicateTemplate: (id: string) => Promise<VaultTemplate | null>

  updateSettings: (changes: Partial<VaultSettings>) => Promise<void>
  updateSyncConfig: (changes: Partial<AzureSyncConfig>) => Promise<void>
  setSyncPassword: (password: string) => Promise<void>

  /** Replaces the whole payload, used by the sync merge. */
  applyMergedPayload: (payload: VaultPayload) => Promise<void>
  clearError: () => void
}

// --- Session material, deliberately outside the store ------------------------

let masterKey: CryptoKey | null = null
let masterKdf: KdfParams | null = null
/** Monotonic guard so a slow persist cannot overwrite a newer one. */
let writeSequence = 0

function hasSession(): boolean {
  return masterKey !== null && masterKdf !== null
}

/** Drops key material. Called on lock, auto-lock, and explicit sign-out. */
function clearSession(): void {
  masterKey = null
  masterKdf = null
  cancelPendingClear()
}

function toPayload(state: VaultStore): VaultPayload {
  return {
    version: VAULT_PAYLOAD_VERSION,
    // Tombstones included so deletes propagate. See `deletedItems` above.
    items: [...state.items, ...state.deletedItems],
    templates: state.templates,
    settings: state.settings,
    updatedAt: Date.now(),
    sync: { config: state.sync.config, password: state.sync.password },
  }
}

export const useVaultStore = create<VaultStore>()((set, get) => {
  /**
   * Encrypts the current state and writes it to IndexedDB.
   *
   * Guarded on a live session: after a lock, a late-resolving promise must
   * not resurrect the key material.
   */
  async function persist(): Promise<void> {
    if (!hasSession()) return

    const sequence = ++writeSequence
    set({ saving: true })

    try {
      const payload = toPayload(get())
      await savePayload(payload, masterKey!, masterKdf!)
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
    set({
      items: payload.items.filter((item) => !item.deleted),
      deletedItems: payload.items.filter((item) => item.deleted),
      templates: payload.templates.length > 0 ? payload.templates : createBuiltinTemplates(),
      settings: { ...DEFAULT_SETTINGS, ...payload.settings },
      sync: {
        config: { ...DEFAULT_AZURE_SYNC_CONFIG, ...(payload.sync?.config ?? {}) },
        password: payload.sync?.password ?? '',
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
    deletedItems: [],
    templates: [],
    settings: { ...DEFAULT_SETTINGS },
    sync: { config: { ...DEFAULT_AZURE_SYNC_CONFIG }, password: '' },
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

    async createNewVault(password, confirm) {
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
        const result = await createVault(password)
        masterKey = result.key
        masterKdf = result.kdf
        adoptPayload(result.payload)
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
        sync: { config: { ...DEFAULT_AZURE_SYNC_CONFIG }, password: '' },
        error: null,
        saving: false,
      })
    },

    async addItem(item) {
      set((state) => ({ items: [...state.items, item] }))
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

    async saveItemFromForm(item, template, input, title, tags, notes) {
      const resolved = resolveFields(item, template)
      set((state) => ({
        items: state.items.map((existing) =>
          existing.id === item.id
            ? touchItem({
                ...existing,
                title: title.trim() || suggestTitle(resolved),
                values: collectValues(resolved, input),
                customFields: existing.customFields.map((custom) => ({
                  ...custom,
                  value: typeof input[custom.id] === 'string' ? (input[custom.id] as string) : '',
                })),
                tags,
                notes,
              })
            : existing,
        ),
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

    async setSyncPassword(password) {
      set((state) => ({ sync: { ...state.sync, password } }))
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