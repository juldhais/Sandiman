/**
 * Azure sync engine.
 *
 * A run is always push-and-pull:
 *
 *   1. acquire a lease on the blob (optimistic concurrency)
 *   2. download and decrypt the remote envelope with the sync key
 *   3. merge remote against local by `updatedAt`
 *   4. re-encrypt the merged payload with the *local* sync key and upload
 *   5. release the lease
 *
 * The lease matters: without it, two devices syncing at the same moment would
 * each read the same remote, each merge its own local edits in, and the second
 * upload would silently discard the first device's work. A `409` here is
 * surfaced as a conflict the user can retry rather than swallowed.
 */
import { decryptVault, encryptVault, parseEnvelope } from '@/crypto/aes'
import { createKdfParams, deriveKey } from '@/crypto/kdf'
import { randomInt } from '@/crypto/secureRandom'
import type { Envelope } from '@/crypto/envelope'
import { safeParseVaultPayload } from '@/storage/schema'
import { toSyncPayload, type VaultPayload } from '@/storage/types'
import type { BlobHandle } from './azure'
import { mergePayloads } from './merge'
import { SharedKeyRequestError } from './sharedKeyTransport'
import {
  EMPTY_SYNC_OUTCOME,
  isSyncConfigured,
  missingSyncFields,
  type AzureSyncConfig,
  type SyncOutcome,
} from './types'

/** Lease duration in seconds. Azure caps it at 60; short is fine here. */
const LEASE_DURATION = 15

export type SyncFailureKind =
  | 'not-configured'
  | 'bad-credential'
  | 'network'
  | 'auth'
  | 'wrong-sync-password'
  | 'corrupt-remote'
  | 'conflict'
  | 'unknown'

export class SyncError extends Error {
  readonly kind: SyncFailureKind

  constructor(kind: SyncFailureKind, message: string) {
    super(message)
    this.name = 'SyncError'
    this.kind = kind
  }
}

/**
 * Encrypts the payload for upload.
 *
 * The sync KDF descriptor is embedded in the envelope, so a second device
 * derives the same key from its own salt-and-password pair without any
 * out-of-band setup.
 */
export async function sealForSync(
  payload: VaultPayload,
  syncPassword: string,
  email: string,
  existingKdf?: Envelope['kdf'],
): Promise<Envelope> {
  const kdf = existingKdf ?? createKdfParams()
  const { key } = await deriveKey(`${email}:${syncPassword}`, kdf)
  return encryptVault(toSyncPayload(payload), key, kdf)
}

/** Reads the remote blob, treating a missing blob as a normal first-sync case. */
async function readRemoteEnvelope(
  handle: BlobHandle,
): Promise<Envelope | null> {
  try {
    return parseEnvelope(await handle.download())
  } catch (cause) {
    if (readStatus(cause) === 404) return null
    throw classify(cause)
  }
}

/** Ensures the container exists before the lease is taken. */
async function ensureContainer(handle: BlobHandle): Promise<void> {
  try {
    if (!(await handle.containerExists())) {
      await handle.createContainer()
    }
  } catch (cause) {
    throw classify(cause)
  }
}

/**
 * Loads the Azure transport on demand.
 *
 * `@azure/storage-blob` is a large dependency and sync is optional, so it is
 * kept out of the main bundle and fetched the first time a sync is attempted.
 */
async function loadBlobHandle(config: AzureSyncConfig): Promise<BlobHandle> {
  const { createBlobHandle } = await import('./azure')
  return createBlobHandle(config).handle
}

/** A lease id must be a GUID, and a random one is as good as any here. */
function randomLeaseId(): string {
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 32; i += 1) id += hex[randomInt(16)]
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

export interface SyncRunInput {
  config: AzureSyncConfig
  syncPassword: string
  payload: VaultPayload
}

export interface SyncRunResult {
  outcome: SyncOutcome
  /** The merged payload, ready to be adopted and persisted locally. */
  mergedPayload: Omit<VaultPayload, 'sync'>
  /** The envelope uploaded, returned so callers can inspect it. */
  uploaded: Envelope
  /** True when this was the first sync, i.e. no remote blob existed. */
  initialUpload: boolean
}

/**
 * Performs one full push-and-pull cycle.
 *
 * @throws {SyncError} with a `kind` the UI maps to a message and a remedy.
 */
export async function runSync(input: SyncRunInput): Promise<SyncRunResult> {
  const { config, syncPassword, payload } = input

  if (!isSyncConfigured(config)) {
    throw new SyncError(
      'not-configured',
      `Sync is missing: ${missingSyncFields(config).join(', ')}`,
    )
  }
  if (syncPassword.length === 0) {
    throw new SyncError('not-configured', 'Enter the sync password to sync this vault')
  }

  let handle: BlobHandle
  try {
    handle = await loadBlobHandle(config)
  } catch (cause) {
    throw new SyncError(
      'bad-credential',
      cause instanceof Error ? cause.message : 'The credential could not be read',
    )
  }

  await ensureContainer(handle)

  // Optimistic concurrency: take a lease so a concurrent sync fails loudly
  // instead of silently overwriting.
  const leaseId = randomLeaseId()
  try {
    await handle.acquireLease(leaseId, LEASE_DURATION)
  } catch (cause) {
    if (readStatus(cause) === 409) {
      throw new SyncError(
        'conflict',
        'Another device is syncing right now. Try again in a moment.',
      )
    }
    throw classify(cause)
  }

  try {
    const remote = await readRemoteEnvelope(handle)

    if (!remote) {
      // First sync: upload the local payload as-is.
      const uploaded = await sealForSync(payload, syncPassword, config.email)
      await handle.upload(JSON.stringify(uploaded), leaseId)

      return {
        outcome: {
          ...EMPTY_SYNC_OUTCOME,
          direction: 'push',
          itemsSent: payload.items.filter((item) => !item.deleted).length,
          completedAt: Date.now(),
        },
        mergedPayload: toSyncPayload(payload),
        uploaded,
        initialUpload: true,
      }
    }

    // The remote KDF descriptor is authoritative for the shared sync key.
    const { key } = await deriveKey(`${config.email}:${syncPassword}`, remote.kdf)

    let remotePayload
    try {
      remotePayload = safeParseVaultPayload(await decryptVault(remote, key))
    } catch (cause) {
      throw classifyRemote(cause)
    }

    if (!remotePayload) {
      throw new SyncError(
        'corrupt-remote',
        'The remote vault could not be read. It may have been written by an incompatible version.',
      )
    }

    const merged = mergePayloads(payload, remotePayload)

    // Re-seal under the local salt. Two devices with the same sync password can
    // read each other's output regardless of which salt produced it.
    const uploaded = await sealForSync(
      { ...merged.payload, sync: payload.sync },
      syncPassword,
      config.email,
      remote.kdf,
    )

    await handle.upload(JSON.stringify(uploaded), leaseId)

    const outcome: SyncOutcome = {
      direction: merged.diverged ? 'push-and-pull' : 'none',
      itemsAfterMerge: merged.payload.items.filter((item) => !item.deleted).length,
      itemsReceived: merged.itemCounts.received,
      itemsSent: merged.itemCounts.sent,
      templatesReceived: merged.templateCounts.received,
      templatesSent: merged.templateCounts.sent,
      remoteWasNewer: merged.remoteWasNewer,
      completedAt: Date.now(),
    }

    return { outcome, mergedPayload: merged.payload, uploaded, initialUpload: false }
  } finally {
    try {
      await handle.releaseLease(leaseId)
    } catch {
      // Leases expire on their own; a failed release is harmless.
    }
  }
}

/**
 * Pull-only check used by the settings screen to validate credentials and the
 * sync password without writing anything.
 */
export async function verifySyncCredentials(
  config: AzureSyncConfig,
  syncPassword: string,
): Promise<{ ok: true; summary: string } | { ok: false; reason: SyncFailureKind; summary: string }> {
  if (!isSyncConfigured(config)) {
    return {
      ok: false,
      reason: 'not-configured',
      summary: `Missing: ${missingSyncFields(config).join(', ')}`,
    }
  }

  const noBlobYet = {
    ok: true as const,
    summary: 'Reachable. No vault blob yet; the first sync will create it.',
  }

  try {
    const handle = await loadBlobHandle(config)

    if (!(await handle.blobExists())) return noBlobYet

    const remote = await readRemoteEnvelope(handle)
    if (!remote) return noBlobYet

    const { key } = await deriveKey(`${config.email}:${syncPassword}`, remote.kdf)
    const payload = await decryptVault(remote, key)
    const parsed = safeParseVaultPayload(payload)

    return {
      ok: true,
      summary: `Reachable and decryptable. Remote vault holds ${
        parsed?.items.filter((item) => !item.deleted).length ?? 'an unknown number of'
      } entries.`,
    }
  } catch (cause) {
    if (cause instanceof SyncError) {
      return { ok: false, reason: cause.kind, summary: cause.message }
    }
    const classified = classify(cause)
    return { ok: false, reason: classified.kind, summary: classified.message }
  }
}

/** Pulls the HTTP status from an SDK or transport error, if present. */
function readStatus(cause: unknown): number | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined
  const record = cause as { statusCode?: unknown; status?: unknown }
  if (typeof record.statusCode === 'number') return record.statusCode
  if (typeof record.status === 'number') return record.status
  return undefined
}

/** Maps an SDK, transport, or network failure onto a `SyncError` kind. */
function classify(cause: unknown): SyncError {
  if (cause instanceof SyncError) return cause

  const message = cause instanceof Error ? cause.message : String(cause)

  if (cause instanceof SharedKeyRequestError) {
    const status = cause.status
    if (status === 401 || status === 403) {
      return new SyncError(
        'auth',
        'Azure rejected the credential. Check that the account name and key are correct.',
      )
    }
    if (status === 404) {
      return new SyncError('not-configured', 'The container or blob could not be found.')
    }
    if (status === 409) {
      return new SyncError('conflict', 'The blob is locked by another device. Try again shortly.')
    }
    if (/network|failed to fetch|ENOTFOUND|ECONNREFUSED|timeout/i.test(message)) {
      return new SyncError('network', 'Could not reach Azure Storage. Check your connection.')
    }
    return new SyncError('unknown', message)
  }

  const status = readStatus(cause)
  if (status === 401 || status === 403) {
    return new SyncError(
      'auth',
      'Azure rejected the credential. Check that the SAS token is unexpired and has write access.',
    )
  }
  if (status === 404) {
    return new SyncError('not-configured', 'The container or blob could not be found.')
  }
  if (status === 409) {
    return new SyncError('conflict', 'The blob is locked by another device. Try again shortly.')
  }
  if (/network|failed to fetch|ENOTFOUND|ECONNREFUSED|timeout/i.test(message)) {
    return new SyncError('network', 'Could not reach Azure Storage. Check your connection.')
  }
  return new SyncError('unknown', message)
}

/** Distinguishes a bad sync password from a damaged remote blob. */
function classifyRemote(cause: unknown): SyncError {
  if (cause instanceof SyncError) return cause
  if (cause instanceof Error && cause.name === 'DecryptError') {
    const reason = (cause as { reason?: string }).reason
    if (reason === 'wrong-password') {
      return new SyncError(
        'wrong-sync-password',
        'The sync password is wrong, or the remote vault belongs to a different account.',
      )
    }
    return new SyncError('corrupt-remote', 'The remote vault is damaged and cannot be decrypted.')
  }
  return classify(cause)
}