/**
 * Azure Blob Storage sync configuration.
 *
 * Note what is *not* here: the sync password is deliberately absent. It is
 * kept inside the master-key-encrypted vault payload instead, so it is never
 * part of the blob uploaded to Azure and never sits in plaintext storage.
 */
export type SyncCredentialKind = 'sas' | 'connection-string'

export interface AzureSyncConfig {
  kind: SyncCredentialKind
  /** Container to read and write. Created on demand if absent. */
  containerName: string
  /** Blob holding the encrypted envelope. */
  blobName: string
  /** SAS token or URL. Present when `kind === 'sas'`. */
  sasToken: string
  /** Storage account connection string. Present when `kind === 'connection-string'`. */
  connectionString: string
  /** Account key parsed out of the connection string, for the settings UI. */
  accountName: string
  /** Identifies the sync key derivation; stored in the blob's KDF descriptor. */
  email: string
  /** Enable background sync on an interval. */
  autoSync: boolean
  autoSyncMinutes: number
}

export const DEFAULT_BLOB_NAME = 'vault-encrypted.json'
export const DEFAULT_CONTAINER_NAME = 'sandiman-vault'

export const DEFAULT_AZURE_SYNC_CONFIG: AzureSyncConfig = {
  kind: 'sas',
  containerName: DEFAULT_CONTAINER_NAME,
  blobName: DEFAULT_BLOB_NAME,
  sasToken: '',
  connectionString: '',
  accountName: '',
  email: '',
  autoSync: false,
  autoSyncMinutes: 5,
}

/** A sync credential is incomplete if any of these are blank. */
export function missingSyncFields(config: AzureSyncConfig): string[] {
  const missing: string[] = []
  if (!config.email.trim()) missing.push('Sync email')
  if (config.kind === 'sas') {
    if (!config.sasToken.trim()) missing.push('SAS token')
  } else if (!config.connectionString.trim()) {
    missing.push('Connection string')
  }
  if (!config.containerName.trim()) missing.push('Container name')
  if (!config.blobName.trim()) missing.push('Blob name')
  return missing
}

export function isSyncConfigured(config: AzureSyncConfig): boolean {
  return missingSyncFields(config).length === 0
}

/**
 * Tracks what a sync run did, for the settings panel's status line.
 */
export type SyncDirection = 'push' | 'pull' | 'push-and-pull' | 'none'

export interface SyncOutcome {
  direction: SyncDirection
  /** Items present locally after the merge. */
  itemsAfterMerge: number
  /** How many items the remote contributed. */
  itemsReceived: number
  /** How many items the local copy contributed. */
  itemsSent: number
  templatesReceived: number
  templatesSent: number
  /** True when the remote blob was newer than anything held locally. */
  remoteWasNewer: boolean
  completedAt: number
}

export const EMPTY_SYNC_OUTCOME: SyncOutcome = {
  direction: 'none',
  itemsAfterMerge: 0,
  itemsReceived: 0,
  itemsSent: 0,
  templatesReceived: 0,
  templatesSent: 0,
  remoteWasNewer: false,
  completedAt: 0,
}