import { describe, expect, it } from 'vitest'
import { describeDestination, normaliseConfig } from '@/sync/githubConfig'
import { DEFAULT_GITHUB_SYNC_CONFIG } from '@/sync/types'

const base = {
  ...DEFAULT_GITHUB_SYNC_CONFIG,
  owner: 'octo-org',
  repo: 'password-vault',
  token: 'github_pat_secret',
}

describe('GitHub sync config', () => {
  it('trims settings, strips a .git suffix, and always uses the fixed vault filename', () => {
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
      path: 'vault.json',
      token: 'github_pat_secret',
    })
  })

  it('ignores a previously configured path', () => {
    expect(normaliseConfig({ ...base, path: '../custom.json' }).path).toBe('vault.json')
  })

  it('does not show a PAT in the destination summary', () => {
    const result = describeDestination(base)
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('octo-org/password-vault')
    expect(result.summary).not.toContain(base.token)
  })
})
