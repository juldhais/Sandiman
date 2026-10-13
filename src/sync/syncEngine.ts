/**
 * GitHub sync engine. The repository stores one encrypted vault payload plus
 * independent encrypted note files; the PAT never participates in encryption.
 *
 * Updates use the file's Git blob SHA as an optimistic concurrency condition.
 * If another device commits between our read and write, GitHub rejects the
 * stale SHA and the user can retry to merge the new remote version.
 */
import { decryptRecord, decryptVault, encryptRecord, encryptVault, parseEnvelope } from '@/crypto/aes'
import { createKdfParams, deriveKey } from '@/crypto/kdf'
import type { Envelope } from '@/crypto/envelope'
import { noteFoldersSchema, noteSchema, safeParseVaultPayload } from '@/storage/schema'
import { toSyncPayload, type VaultNote, type VaultNoteFolder, type VaultPayload } from '@/storage/types'
import { createGitHubHandle, type GitHubHandle, type RemoteFile } from './github'
import { ConfigError, normaliseConfig } from './githubConfig'
import { mergeNoteFolders, mergeNotes, mergePayloads } from './merge'
import { recoverNoteFolderId, validateFolderTree } from '@/storage/noteFolders'
import {
  EMPTY_SYNC_OUTCOME,
  isSyncConfigured,
  missingSyncFields,
  type GitHubSyncConfig,
  type SyncOutcome,
} from './types'

const MAX_SYNC_FILE_BYTES = 70 * 1024 * 1024

export type SyncFailureKind =
  | 'not-configured'
  | 'bad-credential'
  | 'network'
  | 'auth'
  | 'master-password-required'
  | 'wrong-master-password'
  | 'corrupt-remote'
  | 'conflict'
  | 'branch-not-found'
  | 'file-too-large'
  | 'unknown'

export class SyncError extends Error {
  readonly kind: SyncFailureKind

  constructor(kind: SyncFailureKind, message: string) {
    super(message)
    this.name = 'SyncError'
    this.kind = kind
  }
}

/** Encrypts a payload for GitHub using the same password-derived sync key. */
export async function sealForSync(
  payload: VaultPayload,
  masterPassword: string,
  existingKdf?: Envelope['kdf'],
): Promise<Envelope> {
  const kdf = existingKdf ?? createKdfParams()
  const key = await deriveSyncKey(masterPassword, kdf)
  return encryptVault(toSyncPayload(payload), key, kdf)
}

/** Re-encrypts an existing GitHub vault when the local master password changes. */
export async function rotateSyncPassword(
  configInput: GitHubSyncConfig,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  if (!isSyncConfigured(configInput)) return false

  let config: GitHubSyncConfig
  let handle: GitHubHandle
  try {
    config = normaliseConfig(configInput)
    handle = await makeHandle(config)
  } catch (cause) {
    throw classify(cause)
  }

  let status
  try {
    status = await handle.checkRepository()
  } catch (cause) {
    throw classify(cause)
  }
  if (!status.branchExists) {
    throw new SyncError('branch-not-found', 'The configured GitHub branch does not exist.')
  }
  if (!status.canPush) {
    throw new SyncError('auth', 'This token can read the repository but cannot write its contents.')
  }

  let file: RemoteFile | null
  let remotePayload: VaultPayload
  try {
    file = await handle.getFile()
    if (!file) return false
    const envelope = parseEnvelope(file.content)
    const oldKey = await deriveSyncKey(currentPassword, envelope.kdf)
    const parsed = safeParseVaultPayload(await decryptVault(envelope, oldKey))
    if (!parsed) throw new SyncError('corrupt-remote', 'The GitHub vault file is not a valid encrypted payload.')
    remotePayload = parsed
  } catch (cause) {
    throw classifyRemote(cause)
  }

  // Keep the remote payload intact: local edits made since the last sync will
  // still merge normally, while every copy in this file becomes readable by
  // the new password.
  const rotated = await sealForSync(remotePayload, newPassword)
  const content = JSON.stringify(rotated)
  ensureSize(content)
  try {
    await rotateRemoteNotes(handle, currentPassword, newPassword, rotated.kdf)
    await rotateRemoteFolders(handle, currentPassword, newPassword, rotated.kdf)
    // Write the main vault last: it is the password-rotation commit point. If
    // a note/folder write fails, the main file still authenticates with the
    // old password and a retry can use the new password as the fallback.
    await handle.putFile(content, file.sha)
  } catch (cause) {
    throw classifyRemote(cause)
  }
  clearSyncSessionKey()
  return true
}

let sessionSyncKey: { kdf: Envelope['kdf']; key: CryptoKey } | null = null

/** Drops the non-extractable sync key whenever the local vault is locked. */
export function clearSyncSessionKey(): void {
  sessionSyncKey = null
}

/** Whether this unlocked session can run background sync without a password. */
export function hasSyncSessionKey(): boolean {
  return sessionSyncKey !== null
}

async function deriveSyncKey(masterPassword: string, kdf: Envelope['kdf']): Promise<CryptoKey> {
  const { key } = await deriveKey(masterPassword, kdf)
  return key
}

async function getSyncKey(
  kdf: Envelope['kdf'],
  masterPassword?: string,
): Promise<CryptoKey> {
  if (masterPassword) return deriveSyncKey(masterPassword, kdf)
  if (sessionSyncKey && sameKdf(sessionSyncKey.kdf, kdf)) return sessionSyncKey.key
  throw new SyncError(
    'master-password-required',
    'Enter your vault master password to sync on this device.',
  )
}

function cacheSyncKey(kdf: Envelope['kdf'], key: CryptoKey): void {
  sessionSyncKey = { kdf, key }
}

function sameKdf(left: Envelope['kdf'], right: Envelope['kdf']): boolean {
  return left.name === right.name && left.iterations === right.iterations && left.salt === right.salt
}

async function makeHandle(config: GitHubSyncConfig): Promise<GitHubHandle> {
  try {
    return createGitHubHandle(config)
  } catch (cause) {
    if (cause instanceof ConfigError) throw new SyncError('not-configured', cause.message)
    throw cause
  }
}

function noteFilePath(id: string): string {
  return `notes/${id}.json`
}

function noteIdFromPath(path: string): string {
  const match = /^notes\/([0-9a-f-]{36})\.json$/i.exec(path)
  if (!match) throw new SyncError('corrupt-remote', 'GitHub contains an invalid note filename.')
  return match[1]!
}

async function noteEnvelope(
  note: VaultNote,
  key: CryptoKey,
  kdf: Envelope['kdf'],
): Promise<Envelope> {
  const ciphertext = await encryptRecord(note, key, `note:${note.id}`)
  return { v: ciphertext.v, kdf, iv: ciphertext.iv, data: ciphertext.data }
}

async function foldersEnvelope(
  folders: readonly VaultNoteFolder[],
  key: CryptoKey,
  kdf: Envelope['kdf'],
): Promise<Envelope> {
  const ciphertext = await encryptRecord(folders, key, 'note-folders')
  return { v: ciphertext.v, kdf, iv: ciphertext.iv, data: ciphertext.data }
}

interface RemoteFoldersRecord {
  file: RemoteFile
  folders: VaultNoteFolder[]
  kdf: Envelope['kdf']
  needsRekey: boolean
}

async function readRemoteFolders(
  handle: GitHubHandle,
  masterPassword?: string,
  previousMasterPassword?: string,
): Promise<RemoteFoldersRecord | null> {
  const file = await handle.getNoteFoldersFile()
  if (!file) return null
  const envelope = parseEnvelope(file.content)
  let key = await getSyncKey(envelope.kdf, masterPassword)
  let needsRekey = false
  let value: unknown
  try {
    value = await decryptRecord(
      { v: envelope.v, iv: envelope.iv, data: envelope.data },
      key,
      'note-folders',
    )
  } catch (cause) {
    const reason = cause instanceof Error && 'reason' in cause
      ? (cause as Error & { reason?: string }).reason
      : undefined
    if (reason !== 'wrong-password' || !previousMasterPassword) throw cause
    key = await deriveSyncKey(previousMasterPassword, envelope.kdf)
    value = await decryptRecord(
      { v: envelope.v, iv: envelope.iv, data: envelope.data },
      key,
      'note-folders',
    )
    needsRekey = true
  }
  const parsed = noteFoldersSchema.safeParse(value)
  if (!parsed.success) throw new SyncError('corrupt-remote', 'The encrypted GitHub note-folder manifest is invalid.')
  try {
    validateFolderTree(parsed.data)
  } catch {
    throw new SyncError('corrupt-remote', 'The GitHub note-folder manifest has an invalid hierarchy.')
  }
  return { file, folders: parsed.data, kdf: envelope.kdf, needsRekey }
}

async function syncRemoteFolders(
  handle: GitHubHandle,
  localFolders: readonly VaultNoteFolder[],
  masterPassword: string | undefined,
  previousMasterPassword: string | undefined,
  targetKdf: Envelope['kdf'],
  targetKey: CryptoKey,
): Promise<{ folders: VaultNoteFolder[]; counts: { sent: number; received: number } }> {
  try {
    validateFolderTree(localFolders)
  } catch (cause) {
    throw new SyncError('conflict', cause instanceof Error ? cause.message : 'The local folder tree is invalid.')
  }
  const remote = await readRemoteFolders(handle, masterPassword, previousMasterPassword)
  const merged = mergeNoteFolders(localFolders, remote?.folders ?? [])
  try {
    validateFolderTree(merged.value)
  } catch {
    throw new SyncError('conflict', 'Folder changes from another device conflict with this folder tree. Review the folders and retry sync.')
  }

  const changed = remote
    ? remote.needsRekey || !sameKdf(remote.kdf, targetKdf) ||
      JSON.stringify(remote.folders) !== JSON.stringify(merged.value)
    : merged.value.length > 0
  if (changed) {
    const envelope = await foldersEnvelope(merged.value, targetKey, targetKdf)
    const content = JSON.stringify(envelope)
    ensureSize(content)
    await handle.putNoteFoldersFile(content, remote?.file.sha ?? null)
  }

  return {
    folders: merged.value,
    counts: { sent: merged.counts.sent, received: merged.counts.received },
  }
}

async function syncRemoteFoldersSafely(
  ...args: Parameters<typeof syncRemoteFolders>
): ReturnType<typeof syncRemoteFolders> {
  try {
    return await syncRemoteFolders(...args)
  } catch (cause) {
    throw classifyRemote(cause)
  }
}

async function rotateRemoteFolders(
  handle: GitHubHandle,
  currentPassword: string,
  newPassword: string,
  newKdf: Envelope['kdf'],
): Promise<void> {
  const remote = await readRemoteFolders(handle, currentPassword, newPassword)
  if (!remote) return
  const newKey = await deriveSyncKey(newPassword, newKdf)
  const envelope = await foldersEnvelope(remote.folders, newKey, newKdf)
  await handle.putNoteFoldersFile(JSON.stringify(envelope), remote.file.sha)
}

interface RemoteNoteRecord {
  note: VaultNote
  path: string
  sha: string
  kdf: Envelope['kdf']
  needsRekey: boolean
}

async function readRemoteNotes(
  handle: GitHubHandle,
  masterPassword?: string,
  previousMasterPassword?: string,
): Promise<RemoteNoteRecord[]> {
  const files = await handle.listNoteFiles()
  const notes = await Promise.all(files.map(async ({ path }) => {
    const id = noteIdFromPath(path)
    const file = await handle.getNoteFile(path)
    if (!file) return null
    const envelope = parseEnvelope(file.content)
    let key = await getSyncKey(envelope.kdf, masterPassword)
    let needsRekey = false
    let value: unknown
    try {
      value = await decryptRecord(
        { v: envelope.v, iv: envelope.iv, data: envelope.data },
        key,
        `note:${id}`,
      )
    } catch (cause) {
      const reason = cause instanceof Error && 'reason' in cause
        ? (cause as Error & { reason?: string }).reason
        : undefined
      if (reason !== 'wrong-password' || !previousMasterPassword) throw cause
      key = await deriveSyncKey(previousMasterPassword, envelope.kdf)
      value = await decryptRecord(
        { v: envelope.v, iv: envelope.iv, data: envelope.data },
        key,
        `note:${id}`,
      )
      needsRekey = true
    }
    const parsed = noteSchema.safeParse(value)
    if (!parsed.success || parsed.data.id !== id) {
      throw new SyncError('corrupt-remote', `The encrypted note at "${path}" is invalid.`)
    }
    return { note: parsed.data as VaultNote, path, sha: file.sha, kdf: envelope.kdf, needsRekey }
  }))
  return notes.filter((record): record is RemoteNoteRecord => record !== null)
}

async function syncRemoteNotes(
  handle: GitHubHandle,
  localNotes: readonly VaultNote[],
  folders: readonly VaultNoteFolder[],
  masterPassword: string | undefined,
  previousMasterPassword: string | undefined,
  targetKdf: Envelope['kdf'],
  targetKey: CryptoKey,
): Promise<{ notes: VaultNote[]; counts: { sent: number; received: number } }> {
  const remoteRecords = await readRemoteNotes(handle, masterPassword, previousMasterPassword)
  const normalizeNote = (note: VaultNote): VaultNote => {
    const folderId = recoverNoteFolderId(note.folderId, folders)
    return folderId === (note.folderId ?? null)
      ? note
      : { ...note, folderId, updatedAt: Math.max(Date.now(), note.updatedAt + 1) }
  }
  const normalizedLocalNotes = localNotes.map(normalizeNote)
  const normalizedRemoteNotes = remoteRecords.map((record) => normalizeNote(record.note))
  const merged = mergeNotes(normalizedLocalNotes, normalizedRemoteNotes)
  const remoteById = new Map(remoteRecords.map((record) => [record.note.id, record]))
  const mergedById = new Map(merged.value.map((note) => [note.id, note]))

  for (const remote of remoteRecords) {
    if (mergedById.has(remote.note.id)) continue
    // Both devices have observed the tombstone, so it can be removed remotely.
    await handle.deleteNoteFile(remote.path, remote.sha)
  }

  for (const note of merged.value) {
    const remote = remoteById.get(note.id)
    if (
      remote && !remote.needsRekey && sameKdf(remote.kdf, targetKdf) &&
      JSON.stringify(remote.note) === JSON.stringify(note)
    ) continue

    const envelope = await noteEnvelope(note, targetKey, targetKdf)
    const content = JSON.stringify(envelope)
    ensureSize(content)
    await handle.putNoteFile(noteFilePath(note.id), content, remote?.sha ?? null)
  }

  return {
    notes: merged.value,
    counts: { sent: merged.counts.sent, received: merged.counts.received },
  }
}

async function syncRemoteNotesSafely(
  ...args: Parameters<typeof syncRemoteNotes>
): ReturnType<typeof syncRemoteNotes> {
  try {
    return await syncRemoteNotes(...args)
  } catch (cause) {
    throw classifyRemote(cause)
  }
}

async function rotateRemoteNotes(
  handle: GitHubHandle,
  currentPassword: string,
  newPassword: string,
  newKdf: Envelope['kdf'],
): Promise<void> {
  const newKey = await deriveSyncKey(newPassword, newKdf)
  const records = await readRemoteNotes(handle, currentPassword, newPassword)
  for (const record of records) {
    const envelope = await noteEnvelope(record.note, newKey, newKdf)
    await handle.putNoteFile(record.path, JSON.stringify(envelope), record.sha)
  }
  cacheSyncKey(newKdf, newKey)
}

function errorStatus(cause: unknown): number | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined
  const record = cause as { status?: unknown; statusCode?: unknown }
  if (typeof record.status === 'number') return record.status
  if (typeof record.statusCode === 'number') return record.statusCode
  return undefined
}

function classify(cause: unknown): SyncError {
  if (cause instanceof SyncError) return cause
  const status = errorStatus(cause)
  if (status === 401) {
    return new SyncError('auth', 'GitHub rejected the personal access token. Check that it is valid and not expired.')
  }
  if (status === 403) {
    return new SyncError(
      'auth',
      'GitHub denied access. Check the token’s repository selection and Contents read/write permission, and any rate limit.',
    )
  }
  if (status === 404) {
    return new SyncError(
      'bad-credential',
      'GitHub could not find this repository or branch, or the token cannot access it.',
    )
  }
  if (status === 409 || status === 422) {
    return new SyncError('conflict', 'The GitHub file changed during sync. Retry to merge the latest version.')
  }
  if (status === 413 || status === 415) {
    return new SyncError('file-too-large', 'GitHub rejected the encrypted vault file because it is too large.')
  }
  if (/network|failed to fetch|ENOTFOUND|ECONNREFUSED|timeout/i.test(
    cause instanceof Error ? cause.message : String(cause),
  )) {
    return new SyncError('network', 'Could not reach GitHub. Check your connection.')
  }
  return new SyncError('unknown', 'GitHub sync failed. Check the repository settings and try again.')
}

function classifyRemote(cause: unknown): SyncError {
  if (cause instanceof SyncError) return cause
  if (cause instanceof Error && cause.name === 'DecryptError') {
    const reason = (cause as Error & { reason?: string }).reason
    if (reason === 'wrong-password') {
      return new SyncError(
        'wrong-master-password',
        'The master password is incorrect, or this repository belongs to a different vault.',
      )
    }
    return new SyncError('corrupt-remote', 'Encrypted data in GitHub is damaged or unsupported.')
  }
  return classify(cause)
}

function ensureSize(content: string): void {
  const bytes = new TextEncoder().encode(content).byteLength
  if (bytes > MAX_SYNC_FILE_BYTES) {
    throw new SyncError(
      'file-too-large',
      'An encrypted GitHub sync file exceeds the 70 MiB safety limit. Reduce its size or use another sync provider.',
    )
  }
}

function sameShareablePayload(left: VaultPayload, right: VaultPayload): boolean {
  // updatedAt is local sync bookkeeping, not a content change. Ignoring it
  // prevents an otherwise identical periodic sync from creating empty commits.
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
  }
  return stable({
    version: left.version,
    items: left.items,
    templates: left.templates,
    settings: left.settings,
  }) === stable({
    version: right.version,
    items: right.items,
    templates: right.templates,
    settings: right.settings,
  })
}

export interface SyncRunInput {
  config: GitHubSyncConfig
  /** Supplied for a manual sync; automatic sync reuses the in-memory key. */
  masterPassword?: string
  /** Prior password used only to migrate a remote file left behind by a password change. */
  previousMasterPassword?: string
  payload: VaultPayload
}

interface ReadRemoteResult {
  file: RemoteFile
  envelope: Envelope
  payload: VaultPayload
}

export interface SyncRunResult {
  outcome: SyncOutcome
  /** The merged payload, ready to be adopted and persisted locally. */
  mergedPayload: ReturnType<typeof toSyncPayload>
  /** Notes merged from the independent `notes/` GitHub files. */
  mergedNotes: VaultNote[]
  /** Folder tree merged from the encrypted folder manifest. */
  mergedFolders: VaultNoteFolder[]
  /** The encrypted envelope uploaded or already present remotely. */
  uploaded: Envelope
  /** True when this was the first sync and created the remote file. */
  initialUpload: boolean
}

function prepareOutcome(
  payload: VaultPayload,
  itemCounts: { sent: number; received: number },
  templateCounts: { sent: number; received: number },
  noteCounts: { sent: number; received: number },
  folderCounts: { sent: number; received: number },
  remoteWasNewer: boolean,
): SyncOutcome {
  const sent = itemCounts.sent > 0 || templateCounts.sent > 0 || noteCounts.sent > 0 || folderCounts.sent > 0
  const received = itemCounts.received > 0 || templateCounts.received > 0 || noteCounts.received > 0 || folderCounts.received > 0 || remoteWasNewer
  return {
    ...EMPTY_SYNC_OUTCOME,
    direction: sent && received ? 'push-and-pull' : sent ? 'push' : received ? 'pull' : 'none',
    itemsAfterMerge: payload.items.filter((item) => !item.deleted).length,
    itemsReceived: itemCounts.received,
    itemsSent: itemCounts.sent,
    templatesReceived: templateCounts.received,
    templatesSent: templateCounts.sent,
    notesReceived: noteCounts.received,
    notesSent: noteCounts.sent,
    foldersReceived: folderCounts.received,
    foldersSent: folderCounts.sent,
    remoteWasNewer,
    completedAt: Date.now(),
  }
}

/** Performs a merge then creates a GitHub commit only when shared data changed. */
export async function runSync(input: SyncRunInput): Promise<SyncRunResult> {
  const { masterPassword, previousMasterPassword, payload } = input
  if (!isSyncConfigured(input.config)) {
    throw new SyncError('not-configured', `Sync is missing: ${missingSyncFields(input.config).join(', ')}`)
  }

  let config: GitHubSyncConfig
  let handle: GitHubHandle
  try {
    config = normaliseConfig(input.config)
    handle = await makeHandle(config)
  } catch (cause) {
    throw classify(cause)
  }

  let status
  try {
    status = await handle.checkRepository()
  } catch (cause) {
    throw classify(cause)
  }
  if (!status.branchExists) {
    throw new SyncError(
      'branch-not-found',
      config.branch
        ? `The branch “${config.branch}” does not exist in this repository.`
        : 'This repository has no default branch yet. Add an initial commit before syncing.',
    )
  }
  if (!status.canPush) {
    throw new SyncError('auth', 'This token can read the repository but cannot write its contents.')
  }

  let remote: ReadRemoteResult | null
  let rekeyRemote = false
  try {
    const file = await handle.getFile()
    if (!file) {
      remote = null
    } else {
      const envelope = parseEnvelope(file.content)
      let key = await getSyncKey(envelope.kdf, masterPassword)
      let decrypted: unknown
      try {
        decrypted = await decryptVault(envelope, key)
      } catch (cause) {
        if (!(cause instanceof Error && cause.name === 'DecryptError' &&
          (cause as Error & { reason?: string }).reason === 'wrong-password') || !previousMasterPassword) {
          throw cause
        }
        key = await deriveSyncKey(previousMasterPassword, envelope.kdf)
        decrypted = await decryptVault(envelope, key)
        rekeyRemote = true
      }
      const parsed = safeParseVaultPayload(decrypted)
      if (!parsed) throw new SyncError('corrupt-remote', 'The GitHub vault file is not a valid encrypted payload.')
      if (!rekeyRemote) cacheSyncKey(envelope.kdf, key)
      remote = { file, envelope, payload: parsed }
    }
  } catch (cause) {
    throw classifyRemote(cause)
  }

  if (!remote) {
    const kdf = sessionSyncKey?.kdf ?? createKdfParams()
    const key = await getSyncKey(kdf, masterPassword)
    const uploaded = await encryptVault(toSyncPayload(payload), key, kdf)
    const content = JSON.stringify(uploaded)
    ensureSize(content)
    try {
      await handle.putFile(content, null)
    } catch (cause) {
      throw classify(cause)
    }
    cacheSyncKey(kdf, key)
    const folderSync = await syncRemoteFoldersSafely(
      handle,
      payload.noteFolders ?? [],
      masterPassword,
      previousMasterPassword,
      kdf,
      key,
    )
    const noteSync = await syncRemoteNotesSafely(
      handle,
      payload.notes ?? [],
      folderSync.folders,
      masterPassword,
      previousMasterPassword,
      kdf,
      key,
    )
    return {
      outcome: {
        ...EMPTY_SYNC_OUTCOME,
        direction: noteSync.counts.received > 0 || folderSync.counts.received > 0 ? 'push-and-pull' : 'push',
        itemsSent: payload.items.filter((item) => !item.deleted).length,
        templatesSent: payload.templates.filter((template) => !template.deleted).length,
        notesSent: noteSync.counts.sent,
        notesReceived: noteSync.counts.received,
        foldersSent: folderSync.counts.sent,
        foldersReceived: folderSync.counts.received,
        completedAt: Date.now(),
      },
      mergedPayload: toSyncPayload(payload),
      mergedNotes: noteSync.notes,
      mergedFolders: folderSync.folders,
      uploaded,
      initialUpload: true,
    }
  }

  const merged = mergePayloads(toSyncPayload(payload) as VaultPayload, remote.payload)
  const changed = rekeyRemote || !sameShareablePayload(merged.payload as VaultPayload, remote.payload)
  let uploaded = remote.envelope
  if (changed) {
    const key = await getSyncKey(remote.envelope.kdf, masterPassword)
    uploaded = await encryptVault(toSyncPayload({ ...merged.payload, sync: payload.sync }), key, remote.envelope.kdf)
    const content = JSON.stringify(uploaded)
    ensureSize(content)
    try {
      await handle.putFile(content, remote.file.sha)
    } catch (cause) {
      throw classify(cause)
    }
    cacheSyncKey(remote.envelope.kdf, key)
  }

  const syncKdf = uploaded.kdf
  const syncKey = await getSyncKey(syncKdf, masterPassword)
  const folderSync = await syncRemoteFoldersSafely(
    handle,
    payload.noteFolders ?? [],
    masterPassword,
    previousMasterPassword,
    syncKdf,
    syncKey,
  )
  const noteSync = await syncRemoteNotesSafely(
    handle,
    payload.notes ?? [],
    folderSync.folders,
    masterPassword,
    previousMasterPassword,
    syncKdf,
    syncKey,
  )
  cacheSyncKey(syncKdf, syncKey)

  return {
    outcome: prepareOutcome(
      merged.payload as VaultPayload,
      merged.itemCounts,
      merged.templateCounts,
      noteSync.counts,
      folderSync.counts,
      merged.remoteWasNewer,
    ),
    mergedPayload: merged.payload,
    mergedNotes: noteSync.notes,
    mergedFolders: folderSync.folders,
    uploaded,
    initialUpload: false,
  }
}

/** Checks token and repository access without requiring the vault password. */
export async function verifySyncCredentials(
  input: GitHubSyncConfig,
): Promise<{ ok: true; summary: string } | { ok: false; reason: SyncFailureKind; summary: string }> {
  if (!isSyncConfigured(input)) {
    return {
      ok: false,
      reason: 'not-configured',
      summary: `Missing: ${missingSyncFields(input).join(', ')}`,
    }
  }
  try {
    const config = normaliseConfig(input)
    const handle = await makeHandle(config)
    const status = await handle.checkRepository()
    if (!status.branchExists) {
      return {
        ok: false,
        reason: 'branch-not-found',
        summary: `Branch “${config.branch}” was not found in ${config.owner}/${config.repo}.`,
      }
    }
    if (!status.canPush) {
      return {
        ok: false,
        reason: 'auth',
        summary: 'This token can read the repository but cannot write its contents.',
      }
    }
    const file = await handle.getFile()
    if (!file) {
      return {
        ok: true,
        summary: `Connected to ${config.owner}/${config.repo}; the first sync will create ${config.path}.`,
      }
    }
    parseEnvelope(file.content)
    return {
      ok: true,
      summary: `Connected to ${config.owner}/${config.repo}; the encrypted vault file exists.`,
    }
  } catch (cause) {
    const error = classify(cause)
    return { ok: false, reason: error.kind, summary: error.message }
  }
}
