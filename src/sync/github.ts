/** Browser-compatible GitHub repository file operations backed by Octokit. */
import { Octokit } from '@octokit/rest'
import { decodeBase64, encodeBase64 } from '@/crypto/base64'
import { normaliseConfig } from './githubConfig'
import type { GitHubSyncConfig } from './types'

/** The remote file plus the blob SHA GitHub requires to replace it. */
export interface RemoteFile {
  content: string
  sha: string
}

export interface RepositoryStatus {
  /** False only when GitHub reports that the token cannot push. */
  canPush: boolean
  /** False when the configured or default branch does not exist yet. */
  branchExists: boolean
  branchName?: string
}

/** The repository operations the sync engine needs. */
export interface GitHubHandle {
  /** Returns null on a 404; callers use `checkRepository` to say why. */
  getFile(): Promise<RemoteFile | null>
  /**
   * Creates the file (`sha` null) or replaces the version with that blob SHA.
   * A stale or missing SHA is rejected by GitHub, which is the concurrency
   * control: two devices cannot silently overwrite each other.
   */
  putFile(content: string, sha: string | null): Promise<void>
  checkRepository(): Promise<RepositoryStatus>
}

function statusOf(cause: unknown): number | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined
  const { status } = cause as { status?: unknown }
  return typeof status === 'number' ? status : undefined
}

function fromBase64(value: string): string {
  return new TextDecoder().decode(decodeBase64(value.replace(/\s/g, '')))
}

/**
 * Creates an Octokit-backed handle for the configured file.
 *
 * Reads bypass the browser HTTP cache: a stale response would carry an old
 * blob SHA and turn every later write into a false conflict.
 */
export function createGitHubHandle(input: GitHubSyncConfig): GitHubHandle {
  const config = normaliseConfig(input)
  const octokit = new Octokit({
    auth: config.token,
    request: {
      fetch: (url: RequestInfo | URL, init?: RequestInit) =>
        fetch(url, { ...init, cache: 'no-store' }),
    },
  })
  const target = {
    owner: config.owner,
    repo: config.repo,
    path: config.path,
    ...(config.branch ? { ref: config.branch } : {}),
  }

  return {
    async getFile() {
      let response
      try {
        response = await octokit.rest.repos.getContent(target)
      } catch (cause) {
        if (statusOf(cause) === 404) return null
        throw cause
      }

      const { data } = response
      if (Array.isArray(data) || data.type !== 'file') {
        throw new Error(`"${config.path}" is not a file in the repository`)
      }
      if (data.content) return { content: fromBase64(data.content), sha: data.sha }

      // The JSON response omits content above 1 MB; the raw media type does not.
      const raw = await octokit.rest.repos.getContent({
        ...target,
        mediaType: { format: 'raw' },
      })
      return { content: String(raw.data), sha: data.sha }
    },

    async putFile(content, sha) {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: config.owner,
        repo: config.repo,
        path: config.path,
        message: 'Update encrypted vault',
        content: encodeBase64(new TextEncoder().encode(content)),
        ...(config.branch ? { branch: config.branch } : {}),
        ...(sha ? { sha } : {}),
      })
    },

    async checkRepository() {
      const repository = await octokit.rest.repos.get({
        owner: config.owner,
        repo: config.repo,
      })
      const branchName = config.branch || repository.data.default_branch
      let branchExists = config.branch ? true : Boolean(branchName)
      if (config.branch) {
        try {
          await octokit.rest.repos.getBranch({
            owner: config.owner,
            repo: config.repo,
            branch: config.branch,
          })
        } catch (cause) {
          if (statusOf(cause) !== 404) throw cause
          branchExists = false
        }
      } else if (branchName) {
        branchExists = true
      }
      return {
        // `permissions` is absent for some token types; only a definite
        // "false" is treated as read-only.
        canPush: repository.data.permissions?.push !== false,
        branchExists,
        branchName,
      }
    },
  }
}
