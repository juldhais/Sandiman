import { describe, expect, it } from 'vitest'
import { ConfigError, describeDestination, normaliseConfig } from '@/sync/githubConfig'
import { DEFAULT_GITHUB_SYNC_CONFIG } from '@/sync/types'

const base = {
  ...DEFAULT_GITHUB_SYNC_CONFIG,
  owner: 'octo-org',
  repo: 'password-vault',
  token: 'github_pat_secret',
}

describe('GitHub sync config', () => {
  it('trims settings, strips a .git suffix, and removes leading path slashes', () => {
    expect(normaliseConfig({
      ...base,
      owner: ' octo-org ',
      repo: ' password-vault.git ',
      branch: ' main ',
      path: '/private/vault.json',
      token: ' github_pat_secret ',
    })).toMatchObject({
      owner: 'octo-org',
      repo: 'password-vault',
      branch: 'main',
      path: 'private/vault.json',
      token: 'github_pat_secret',
    })
  })

  it.each(['', '../vault.json', 'folder/../vault.json', 'folder//vault.json', 'folder/']) (
    'rejects unsafe or empty file paths: %s',
    (path) => expect(() => normaliseConfig({ ...base, path })).toThrow(ConfigError),
  )

  it('does not show a PAT in the destination summary', () => {
    const result = describeDestination(base)
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('octo-org/password-vault')
    expect(result.summary).not.toContain(base.token)
  })
})
