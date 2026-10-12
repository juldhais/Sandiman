import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeBase64 } from '@/crypto/base64'
import { createGitHubHandle } from '@/sync/github'
import { DEFAULT_GITHUB_SYNC_CONFIG } from '@/sync/types'

const repos = vi.hoisted(() => ({
  getContent: vi.fn(),
  createOrUpdateFileContents: vi.fn(),
  get: vi.fn(),
  getBranch: vi.fn(),
}))

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(function MockOctokit() {
    return { rest: { repos } }
  }),
}))

const config = {
  ...DEFAULT_GITHUB_SYNC_CONFIG,
  owner: 'octo-org',
  repo: 'private-vault',
  branch: 'main',
  path: 'vault.json',
  token: 'github_pat_test-secret',
}

beforeEach(() => {
  vi.clearAllMocks()
  repos.getContent.mockResolvedValue({
    data: {
      type: 'file',
      sha: 'file-sha',
      content: btoa('encrypted-json'),
    },
  })
  repos.createOrUpdateFileContents.mockResolvedValue({ data: {} })
  repos.get.mockResolvedValue({ data: { default_branch: 'main', permissions: { push: true } } })
  repos.getBranch.mockResolvedValue({ data: { name: 'main' } })
})

describe('GitHub file transport', () => {
  it('reads and UTF-8 decodes the encrypted file, returning its blob SHA', async () => {
    const handle = createGitHubHandle(config)
    await expect(handle.getFile()).resolves.toEqual({ content: 'encrypted-json', sha: 'file-sha' })
    expect(repos.getContent).toHaveBeenCalledWith({
      owner: 'octo-org',
      repo: 'private-vault',
      path: 'vault.json',
      ref: 'main',
    })
  })

  it('returns null only when the encrypted file is missing', async () => {
    repos.getContent.mockRejectedValue({ status: 404 })
    await expect(createGitHubHandle(config).getFile()).resolves.toBeNull()
  })

  it('uses raw media type for content omitted by the JSON API', async () => {
    repos.getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'large-sha', content: '' } })
      .mockResolvedValueOnce({ data: 'raw-encrypted-content' })
    await expect(createGitHubHandle(config).getFile()).resolves.toEqual({
      content: 'raw-encrypted-content',
      sha: 'large-sha',
    })
    expect(repos.getContent).toHaveBeenLastCalledWith({
      owner: 'octo-org',
      repo: 'private-vault',
      path: 'vault.json',
      ref: 'main',
      mediaType: { format: 'raw' },
    })
  })

  it('base64-encodes file contents and supplies SHA for conditional updates', async () => {
    const handle = createGitHubHandle(config)
    await handle.putFile('encrypted-json', 'existing-sha')
    const request = repos.createOrUpdateFileContents.mock.calls[0]![0]
    expect(request).toMatchObject({
      owner: 'octo-org',
      repo: 'private-vault',
      path: 'vault.json',
      branch: 'main',
      sha: 'existing-sha',
      message: 'Update encrypted vault',
    })
    expect(new TextDecoder().decode(decodeBase64(request.content))).toBe('encrypted-json')
    expect(JSON.stringify(request)).not.toContain(config.token)
  })

  it('checks repository and explicitly requested branch availability', async () => {
    await expect(createGitHubHandle(config).checkRepository()).resolves.toEqual({
      canPush: true,
      branchExists: true,
      branchName: 'main',
    })
    expect(repos.get).toHaveBeenCalledWith({ owner: 'octo-org', repo: 'private-vault' })
    expect(repos.getBranch).toHaveBeenCalledWith({
      owner: 'octo-org', repo: 'private-vault', branch: 'main',
    })
  })
})
