/** Lightweight GitHub destination validation for settings, with no SDK import. */
import type { GitHubSyncConfig } from './types'

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Validates the destination and returns a normalised copy.
 *
 * Whitespace is trimmed because tokens and names are usually pasted. The path
 * is rejected if it could escape the repository root or name a directory.
 */
export function normaliseConfig(config: GitHubSyncConfig): GitHubSyncConfig {
  const owner = config.owner.trim()
  const repo = config.repo.trim().replace(/\.git$/i, '')
  const branch = config.branch.trim()
  const path = config.path.trim().replace(/^\/+/, '')
  const token = config.token.trim()

  if (!token) throw new ConfigError('The personal access token is empty')
  if (/\s/.test(token)) throw new ConfigError('The personal access token must not contain spaces')
  if (!OWNER_PATTERN.test(owner)) throw new ConfigError('The repository owner is not a valid GitHub name')
  if (!REPO_PATTERN.test(repo) || repo === '.' || repo === '..') {
    throw new ConfigError('The repository name is not valid')
  }
  if (!path || path.endsWith('/')) throw new ConfigError('The file path must name a file')
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ConfigError('The file path must not contain empty, "." or ".." segments')
  }
  if (/[\\\0]/.test(path)) throw new ConfigError('The file path contains an invalid character')
  if (/\s/.test(branch)) throw new ConfigError('The branch name must not contain spaces')

  return { ...config, owner, repo, branch, path, token }
}

/** Summarises the destination without ever echoing the token. */
export function describeDestination(
  config: GitHubSyncConfig,
): { ok: boolean; summary: string } {
  try {
    const normalised = normaliseConfig(config)
    const branch = normalised.branch || 'the default branch'
    const kind = normalised.token.startsWith('github_pat_')
      ? 'fine-grained token'
      : normalised.token.startsWith('ghp_')
        ? 'classic token'
        : 'token'
    return {
      ok: true,
      summary: `${normalised.owner}/${normalised.repo}, ${normalised.path} on ${branch}, using a ${kind}`,
    }
  } catch (cause) {
    return { ok: false, summary: cause instanceof Error ? cause.message : 'Unreadable settings' }
  }
}
