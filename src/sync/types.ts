/**
 * Azure Blob Storage sync configuration.
 *
 * Only the Azure destination and SAS URL are stored. Remote data is
 * encrypted with a key derived from the vault master password.
 */
export interface AzureSyncConfig {
  /** Container to read and write. Service-scoped SAS URLs can create it if absent. */
  containerName: string
  /** Blob holding the encrypted envelope. */
  blobName: string
  /** Full Azure Blob SAS URL, encrypted with the local vault. */
  sasUrl: string
  /** Enable background sync on an interval. */
  autoSync: boolean
  autoSyncMinutes: number
}

export const DEFAULT_BLOB_NAME = 'vault-encrypted.json'
export const DEFAULT_CONTAINER_NAME = 'sandiman-vault'

export const DEFAULT_AZURE_SYNC_CONFIG: AzureSyncConfig = {
  containerName: DEFAULT_CONTAINER_NAME,
  blobName: DEFAULT_BLOB_NAME,
  sasUrl: '',
  autoSync: false,
  autoSyncMinutes: 5,
}

/** Sync is incomplete if any Azure destination credential is blank. */
export function missingSyncFields(config: AzureSyncConfig): string[] {
  const missing: string[] = []
  if (!config.sasUrl.trim()) missing.push('Blob SAS URL')
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
