import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptVault } from '@/crypto/aes'
import type { VaultPayload } from '@/storage/types'
import type { GitHubHandle } from '@/sync/github'
import { runSync, sealForSync, clearSyncSessionKey, rotateSyncPassword, SyncError } from '@/sync/syncEngine'
import type { GitHubSyncConfig } from '@/sync/types'

const github = vi.hoisted(() => ({ handle: null as unknown }))

vi.mock('@/sync/github', () => ({
  createGitHubHandle: vi.fn(() => github.handle),
}))

vi.mock('@/crypto/kdf', () => ({
  createKdfParams: () => ({
    name: 'PBKDF2-SHA256',
    iterations: 10,
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  }),
  deriveKey: async (password: string, kdf: { iterations: number; salt: string }) => {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: kdf.iterations,
        salt: Uint8Array.from(atob(kdf.salt), (character) => character.charCodeAt(0)),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    return { key, elapsedMs: 0 }
  },
}))

const token = 'github_pat_test-token'
const config: GitHubSyncConfig = {
  owner: 'example-owner',
  repo: 'private-vault',
  branch: 'main',
  path: 'vault.json',
  token,
  autoSync: false,
  autoSyncMinutes: 15,
}

const payload: VaultPayload = {
  version: 1,
  items: [],
  templates: [],
  settings: {
    clipboardClearSeconds: 30,
    autoLockMinutes: 5,
    lockOnBlur: false,
    expiryWarningDays: 30,
    lastSyncAt: null,
  },
  updatedAt: 1,
  sync: { config },
}

let handle: GitHubHandle
let getFile: ReturnType<typeof vi.fn<GitHubHandle['getFile']>>
let putFile: ReturnType<typeof vi.fn<GitHubHandle['putFile']>>
let checkRepository: ReturnType<typeof vi.fn<GitHubHandle['checkRepository']>>

async function remoteFile(value: VaultPayload): Promise<RemoteFileEnvelope> {
  const envelope = await sealForSync(value, 'master-password', {
    name: 'PBKDF2-SHA256',
    iterations: 10,
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  })
  return { content: JSON.stringify(envelope), sha: 'remote-sha' }
}

interface RemoteFileEnvelope {
  content: string
  sha: string
}

beforeEach(() => {
  clearSyncSessionKey()
  getFile = vi.fn<GitHubHandle['getFile']>().mockResolvedValue(null)
  putFile = vi.fn<GitHubHandle['putFile']>().mockResolvedValue(undefined)
  checkRepository = vi.fn<GitHubHandle['checkRepository']>().mockResolvedValue({
    canPush: true,
    branchExists: true,
  })
  handle = { getFile, putFile, checkRepository }
  github.handle = handle
})

describe('GitHub sync encryption and merge', () => {
  it('encrypts shareable data and strips local PAT settings', async () => {
    const envelope = await sealForSync(payload, 'master-password')
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', envelope.kdf)
    const decrypted = await decryptVault(envelope, key)

    expect(decrypted).not.toHaveProperty('sync')
    expect(decrypted.items).toEqual([])
    expect(JSON.stringify(envelope)).not.toContain(token)
  })

  it('rejects a different master password for the repository ciphertext', async () => {
    const envelope = await sealForSync(payload, 'master-password')
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('different-password', envelope.kdf)

    await expect(decryptVault(envelope, key)).rejects.toThrow()
  })

  it('creates the encrypted file on the first sync', async () => {
    const result = await runSync({ config, masterPassword: 'master-password', payload })

    expect(putFile).toHaveBeenCalledOnce()
    expect(putFile).toHaveBeenCalledWith(expect.any(String), null)
    const [body] = putFile.mock.calls[0]!
    expect(body).not.toContain(token)
    expect(result.initialUpload).toBe(true)
    expect(result.outcome.direction).toBe('push')
  })

  it('re-encrypts the GitHub copy when the master password changes', async () => {
    const encrypted = await remoteFile(payload)
    getFile.mockResolvedValue(encrypted)

    await expect(rotateSyncPassword(config, 'master-password', 'new-password')).resolves.toBe(true)

    expect(putFile).toHaveBeenCalledOnce()
    expect(putFile).toHaveBeenCalledWith(expect.any(String), 'remote-sha')
    const [content] = putFile.mock.calls[0]!
    const rotated = JSON.parse(content) as Awaited<ReturnType<typeof sealForSync>>
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('new-password', rotated.kdf)
    await expect(decryptVault(rotated, key)).resolves.toMatchObject({ version: payload.version })
  })

  it('migrates an existing remote file encrypted with the previous password during sync', async () => {
    getFile.mockResolvedValue(await remoteFile(payload))

    const result = await runSync({
      config,
      masterPassword: 'new-password',
      previousMasterPassword: 'master-password',
      payload,
    })

    expect(putFile).toHaveBeenCalledOnce()
    expect(result.outcome.direction).toBe('none')
    const [content] = putFile.mock.calls[0]!
    const migrated = JSON.parse(content) as Awaited<ReturnType<typeof sealForSync>>
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('new-password', migrated.kdf)
    await expect(decryptVault(migrated, key)).resolves.toMatchObject({ version: payload.version })
  })

  it('passes the read file SHA when committing merged changes', async () => {
    const encrypted = await remoteFile(payload)
    getFile.mockResolvedValue(encrypted)
    const localItem = {
      id: 'item-1',
      templateId: null,
      title: 'Local item',
      values: { password: 'local-secret' },
      customFields: [],
      tags: [],
      notes: '',
      createdAt: 1,
      updatedAt: 10,
      deleted: false,
    }

    await runSync({
      config,
      masterPassword: 'master-password',
      payload: { ...payload, items: [localItem], updatedAt: 10 },
    })

    expect(putFile).toHaveBeenCalledOnce()
    expect(putFile).toHaveBeenCalledWith(expect.any(String), 'remote-sha')
  })

  it('does not create an empty commit when the remote already matches', async () => {
    getFile.mockResolvedValue(await remoteFile(payload))

    const result = await runSync({
      config,
      masterPassword: 'master-password',
      payload: { ...payload, updatedAt: 99, settings: { ...payload.settings, lastSyncAt: 55 } },
    })

    expect(putFile).not.toHaveBeenCalled()
    expect(result.outcome.direction).toBe('none')
  })

  it('reports a stale-SHA update as a retryable conflict', async () => {
    getFile.mockResolvedValue(await remoteFile(payload))
    putFile.mockRejectedValue({ status: 409 })
    const item = {
      id: 'item-1', templateId: null, title: 'Example', values: {}, customFields: [], tags: [],
      notes: '', createdAt: 0, updatedAt: 3, deleted: false,
    }

    await expect(runSync({
      config,
      masterPassword: 'master-password',
      payload: { ...payload, items: [item] },
    })).rejects.toMatchObject<Partial<SyncError>>({ kind: 'conflict' })
  })

  it('classifies a repository without write permission', async () => {
    checkRepository.mockResolvedValue({ canPush: false, branchExists: true })
    await expect(runSync({ config, masterPassword: 'master-password', payload }))
      .rejects.toMatchObject({ kind: 'auth' })
  })
})
