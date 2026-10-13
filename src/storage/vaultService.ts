/**
 * Vault lifecycle: create, unlock, persist, change master password.
 *
 * This module owns the one invariant that matters most: the derived master key
 * lives only as a local variable or in the store's memory, and is never
 * written to storage. Local item and note records and their header are encrypted
 * independently; GitHub sync keeps notes in per-note encrypted files.
 */
import { DecryptError, decryptRecord, decryptVault, encryptRecord, encryptVault } from '@/crypto/aes'
import { createKdfParams, deriveKey } from '@/crypto/kdf'
import type { Envelope, KdfParams } from '@/crypto/envelope'
import { createBuiltinTemplates } from './builtins'
import { validateFolderTree } from './noteFolders'
import {
  isInitialized,
  readEnvelope,
  readItemRecords,
  readNoteRecords,
  replaceLocalVault,
  writeLocalChanges,
  type StoredItemRecord,
  type StoredNoteRecord,
} from './db'
import { itemSchema, noteSchema, parseVaultPayload } from './schema'
import {
  DEFAULT_SETTINGS,
  VAULT_PAYLOAD_VERSION,
  type VaultPayload,
  type VaultNote,
} from './types'
import { DEFAULT_GITHUB_SYNC_CONFIG, type GitHubSyncConfig } from '@/sync/types'

export type VaultState = 'uninitialized' | 'locked' | 'unlocked'

export interface UnlockSuccess {
  payload: VaultPayload
  /** Non-extractable master key, for subsequent writes. */
  key: CryptoKey
  kdf: KdfParams
  elapsedMs: number
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Incorrect master password')
    this.name = 'WrongPasswordError'
  }
}

/**
 * Reports which screen to show.
 *
 * IndexedDB is the source of truth here, not any in-memory flag, so a reload
 * after locking lands on the correct screen.
 */
export async function getVaultState(): Promise<VaultState> {
  if (!(await isInitialized())) return 'uninitialized'
  // A present envelope means there is ciphertext to unlock against. An
  // initialised vault without one is still 'locked', since the unlock screen
  // is where the missing-ciphertext case gets diagnosed.
  return 'locked'
}

/** Builds the payload a brand-new vault starts with. */
export function emptyPayload(
  now: number = Date.now(),
  syncConfig: GitHubSyncConfig = DEFAULT_GITHUB_SYNC_CONFIG,
): VaultPayload {
  return {
    version: VAULT_PAYLOAD_VERSION,
    items: [],
    notes: [],
    noteFolders: [],
    templates: createBuiltinTemplates(now),
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: now,
    sync: {
      config: { ...syncConfig },
    },
  }
}

function localHeader(payload: VaultPayload): VaultPayload {
  return {
    ...payload,
    items: [],
    notes: [],
    noteFolders: payload.noteFolders ?? [],
    localItemCount: payload.items.length,
    localNoteCount: payload.notes?.length ?? 0,
  }
}

export function getHeaderSignature(payload: VaultPayload): string {
  return JSON.stringify({
    version: payload.version,
    templates: payload.templates,
    settings: payload.settings,
    sync: payload.sync,
    itemCount: payload.items.length,
    noteCount: payload.notes?.length ?? 0,
    noteFolders: payload.noteFolders ?? [],
  })
}

async function encryptItems(items: VaultPayload['items'], key: CryptoKey): Promise<StoredItemRecord[]> {
  return Promise.all(items.map(async (item) => ({
    id: item.id,
    ciphertext: await encryptRecord(item, key, `item:${item.id}`),
  })))
}

async function encryptNotes(notes: readonly VaultNote[], key: CryptoKey): Promise<StoredNoteRecord[]> {
  return Promise.all(notes.map(async (note) => ({
    id: note.id,
    ciphertext: await encryptRecord(note, key, `note:${note.id}`),
  })))
}

async function decodeVault(envelope: Envelope, key: CryptoKey): Promise<VaultPayload> {
  const decoded = parseVaultPayload(await decryptVault(envelope, key))
  try {
    validateFolderTree(decoded.noteFolders ?? [])
  } catch {
    throw new DecryptError('corrupt-payload', 'The local note-folder hierarchy is invalid')
  }
  const records = await readItemRecords()
  const noteRecords = await readNoteRecords()
  if (decoded.localItemCount !== records.length) {
    throw new DecryptError('corrupt-payload', 'The local item records are incomplete')
  }
  if ((decoded.localNoteCount ?? 0) !== noteRecords.length) {
    throw new DecryptError('corrupt-payload', 'The local note records are incomplete')
  }
  const items = await Promise.all(records.map(async (record) => {
    try {
      const item = itemSchema.parse(
        await decryptRecord<unknown>(record.ciphertext, key, `item:${record.id}`),
      )
      if (item.id !== record.id) {
        throw new DecryptError('corrupt-payload', 'Item ID does not match its encrypted record')
      }
      return item
    } catch (cause) {
      if (cause instanceof DecryptError) throw cause
      throw new DecryptError('corrupt-payload', 'A local item does not match the vault schema')
    }
  }))
  const notes = await Promise.all(noteRecords.map(async (record) => {
    try {
      const note = noteSchema.parse(
        await decryptRecord<unknown>(record.ciphertext, key, `note:${record.id}`),
      )
      if (note.id !== record.id) {
        throw new DecryptError('corrupt-payload', 'Note ID does not match its encrypted record')
      }
      return note
    } catch (cause) {
      if (cause instanceof DecryptError) throw cause
      throw new DecryptError('corrupt-payload', 'A local note does not match the vault schema')
    }
  }))
  const activeFolderIds = new Set((decoded.noteFolders ?? []).filter((folder) => !folder.deleted).map((folder) => folder.id))
  if (notes.some((note) => note.folderId && !activeFolderIds.has(note.folderId))) {
    throw new DecryptError('corrupt-payload', 'A local note refers to a missing folder')
  }
  return { ...decoded, items, notes }
}

async function installVault(payload: VaultPayload, key: CryptoKey, kdf: KdfParams, now: number) {
  const header = await encryptVault(localHeader(payload), key, kdf)
  const records = await encryptItems(payload.items, key)
  const noteRecords = await encryptNotes(payload.notes ?? [], key)
  await replaceLocalVault({ header, records, noteRecords, kdf, now })
  return header
}

/**
 * Creates the vault: derives a fresh key, seeds built-in templates, and
 * writes an encrypted header and encrypted item/note records.
 */
export async function createVault(
  password: string,
  now: number = Date.now(),
  syncConfig: GitHubSyncConfig = DEFAULT_GITHUB_SYNC_CONFIG,
): Promise<UnlockSuccess> {
  if (await isInitialized()) {
    throw new Error('A vault already exists on this device')
  }

  const kdf = createKdfParams()
  const { key, elapsedMs } = await deriveKey(password, kdf)
  const payload = emptyPayload(now, syncConfig)

  const header = await encryptVault(localHeader(payload), key, kdf)
  await replaceLocalVault({ header, records: [], noteRecords: [], kdf, now, createdAt: now })

  return { payload, key, kdf, elapsedMs }
}

/**
 * Derives the master key from a password and the stored KDF descriptor.
 *
 * Exposed separately from `unlock` so the settings screen can verify a
 * password change without decrypting the whole vault.
 */
export async function deriveMasterKey(
  password: string,
): Promise<{ key: CryptoKey; kdf: KdfParams; elapsedMs: number } | null> {
  const envelope = await readEnvelope()
  if (!envelope) return null
  const derived = await deriveKey(password, envelope.kdf)
  return { key: derived.key, kdf: envelope.kdf, elapsedMs: derived.elapsedMs }
}

/** Verifies a freshly entered password without changing the unlocked session. */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  const envelope = await readEnvelope()
  if (!envelope) return false

  const { key } = await deriveKey(password, envelope.kdf)
  try {
    await decryptVault(envelope, key)
    return true
  } catch (cause) {
    if (cause instanceof DecryptError && cause.reason === 'wrong-password') return false
    throw cause
  }
}

/**
 * Unlocks the vault.
 *
 * @throws {WrongPasswordError} on a bad password.
 * @throws {DecryptError} with `reason: 'corrupt-payload'` when the stored
 * envelope is damaged. These are kept distinct because only one is the user's
 * fault.
 */
export async function unlock(password: string): Promise<UnlockSuccess> {
  const envelope = await readEnvelope()
  if (!envelope) {
    throw new Error('No vault exists on this device yet')
  }

  const { key, elapsedMs } = await deriveKey(password, envelope.kdf)

  let payload: VaultPayload
  try {
    payload = await decodeVault(envelope, key)
  } catch (cause) {
    if (cause instanceof DecryptError && cause.reason === 'wrong-password') {
      throw new WrongPasswordError()
    }
    throw cause
  }

  return { payload, key, kdf: envelope.kdf, elapsedMs }
}

/**
 * Encrypts and persists a payload.
 *
 * Callers pass the in-memory key so the master password is never needed again
 * while the vault is unlocked.
 */
export async function savePayload(
  payload: VaultPayload,
  key: CryptoKey,
  kdf: KdfParams,
  now: number = Date.now(),
): Promise<Envelope> {
  return installVault(payload, key, kdf, now)
}

/** Encrypts only changed items; the small encrypted header is replaced only when its content changes. */
export async function savePayloadChanges(
  payload: VaultPayload,
  key: CryptoKey,
  kdf: KdfParams,
  changedItems: VaultPayload['items'],
  deletedItemIds: string[],
  headerChanged: boolean,
  now: number = Date.now(),
  changedNotes: readonly VaultNote[] = [],
  deletedNoteIds: string[] = [],
): Promise<void> {
  const header = headerChanged ? await encryptVault(localHeader(payload), key, kdf) : undefined
  const upserts = await encryptItems(changedItems, key)
  const noteUpserts = await encryptNotes(changedNotes, key)
  await writeLocalChanges({
    header,
    upserts,
    deletes: deletedItemIds,
    noteUpserts,
    noteDeletes: deletedNoteIds,
    kdf,
    now,
  })
}

/**
 * Re-encrypts the vault under a new master password.
 *
 * The old password is verified first, because a typo in the current password
 * should not be able to make the vault unopenable. A *new* salt is generated,
 * so the new envelope is unrelated to the old one at the key-derivation level.
 */
export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string,
): Promise<UnlockSuccess> {
  const envelope = await readEnvelope()
  if (!envelope) throw new Error('No vault exists on this device yet')

  const { key: currentKey } = await deriveKey(currentPassword, envelope.kdf)
  let payload: VaultPayload
  try {
    payload = await decodeVault(envelope, currentKey)
  } catch (cause) {
    if (cause instanceof DecryptError && cause.reason === 'wrong-password') {
      throw new WrongPasswordError()
    }
    throw cause
  }

  const kdf = createKdfParams()
  const { key, elapsedMs } = await deriveKey(newPassword, kdf)
  const now = Date.now()

  // All records must be re-encrypted because the new password derives a new key.
  await installVault(payload, key, kdf, now)

  return { payload, key, kdf, elapsedMs }
}
