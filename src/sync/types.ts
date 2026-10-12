/**
 * GitHub repository sync configuration.
 *
 * The personal access token lives only inside the master-key-encrypted local
 * vault and is stripped before anything is uploaded. Remote data is encrypted
 * with a key derived from the vault master password.
 */
export interface GitHubSyncConfig {
  /** Account or organisation that owns the repository. */
  owner: string
  repo: string
  /** Blank means the repository's default branch. */
  branch: string
  /** Path of the encrypted vault file inside the repository. */
  path: string
  /** Personal access token with Contents read/write access to the repository. */
  token: string
  /** Enable background sync on an interval. */
  autoSync: boolean
  autoSyncMinutes: number
}

export const DEFAULT_VAULT_PATH = 'vault-encrypted.json'

export const DEFAULT_GITHUB_SYNC_CONFIG: GitHubSyncConfig = {
  owner: '',
  repo: '',
  branch: '',
  path: DEFAULT_VAULT_PATH,
  token: '',
  autoSync: false,
  autoSyncMinutes: 15,
}

/** Sync is incomplete if any required GitHub destination field is blank. */
export function missingSyncFields(config: GitHubSyncConfig): string[] {
  const missing: string[] = []
  if (!config.token.trim()) missing.push('Personal access token')
  if (!config.owner.trim()) missing.push('Repository owner')
  if (!config.repo.trim()) missing.push('Repository name')
  if (!config.path.trim()) missing.push('File path')
  return missing
}

export function isSyncConfigured(config: GitHubSyncConfig): boolean {
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
  /** True when the remote file was newer than anything held locally. */
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
