import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptRecord, decryptVault, encryptRecord } from '@/crypto/aes'
import type { VaultNote, VaultNoteFolder, VaultPayload } from '@/storage/types'
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
let listNoteFiles: ReturnType<typeof vi.fn<GitHubHandle['listNoteFiles']>>
let getNoteFile: ReturnType<typeof vi.fn<GitHubHandle['getNoteFile']>>
let putNoteFile: ReturnType<typeof vi.fn<GitHubHandle['putNoteFile']>>
let deleteNoteFile: ReturnType<typeof vi.fn<GitHubHandle['deleteNoteFile']>>
let getNoteFoldersFile: ReturnType<typeof vi.fn<GitHubHandle['getNoteFoldersFile']>>
let putNoteFoldersFile: ReturnType<typeof vi.fn<GitHubHandle['putNoteFoldersFile']>>
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
  listNoteFiles = vi.fn<GitHubHandle['listNoteFiles']>().mockResolvedValue([])
  getNoteFile = vi.fn<GitHubHandle['getNoteFile']>().mockResolvedValue(null)
  putNoteFile = vi.fn<GitHubHandle['putNoteFile']>().mockResolvedValue(undefined)
  deleteNoteFile = vi.fn<GitHubHandle['deleteNoteFile']>().mockResolvedValue(undefined)
  getNoteFoldersFile = vi.fn<GitHubHandle['getNoteFoldersFile']>().mockResolvedValue(null)
  putNoteFoldersFile = vi.fn<GitHubHandle['putNoteFoldersFile']>().mockResolvedValue(undefined)
  checkRepository = vi.fn<GitHubHandle['checkRepository']>().mockResolvedValue({
    canPush: true,
    branchExists: true,
  })
  handle = {
    getFile,
    putFile,
    listNoteFiles,
    getNoteFile,
    putNoteFile,
    deleteNoteFile,
    getNoteFoldersFile,
    putNoteFoldersFile,
    checkRepository,
  }
  github.handle = handle
})

describe('GitHub sync encryption and merge', () => {
  it('encrypts shareable data and strips local PAT settings', async () => {
    const envelope = await sealForSync({
      ...payload,
      notes: [{
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'private title',
        markdown: 'private markdown',
        createdAt: 1,
        updatedAt: 1,
        deleted: false,
      }],
      noteFolders: [{
        id: '123e4567-e89b-12d3-a456-426614174001',
        name: 'private folder name',
        parentId: null,
        createdAt: 1,
        updatedAt: 1,
        deleted: false,
      }],
    }, 'master-password')
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', envelope.kdf)
    const decrypted = await decryptVault(envelope, key)

    expect(decrypted).not.toHaveProperty('sync')
    expect(decrypted).not.toHaveProperty('notes')
    expect(decrypted).not.toHaveProperty('noteFolders')
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

  it('syncs each standalone note as an encrypted notes/<id>.json file', async () => {
    const note: VaultNote = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Private title',
      markdown: '# Private markdown',
      createdAt: 1,
      updatedAt: 2,
      deleted: false,
    }
    const result = await runSync({
      config,
      masterPassword: 'master-password',
      payload: { ...payload, notes: [note] },
    })

    expect(result.mergedNotes).toEqual([note])
    expect(putNoteFile).toHaveBeenCalledOnce()
    const [path, content, sha] = putNoteFile.mock.calls[0]!
    expect(path).toBe(`notes/${note.id}.json`)
    expect(sha).toBeNull()
    expect(content).not.toContain(note.title)
    expect(content).not.toContain(note.markdown)
    const envelope = JSON.parse(content) as {
      v: number
      iv: string
      data: string
      kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string }
    }
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', envelope.kdf)
    await expect(decryptRecord(
      { v: envelope.v, iv: envelope.iv, data: envelope.data },
      key,
      `note:${note.id}`,
    )).resolves.toEqual(note)
  })

  it('syncs folder trees in one encrypted manifest without exposing folder names', async () => {
    const folder: VaultNoteFolder = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'Private Folder Name',
      parentId: null,
      createdAt: 1,
      updatedAt: 2,
      deleted: false,
    }
    const result = await runSync({
      config,
      masterPassword: 'master-password',
      payload: { ...payload, noteFolders: [folder] },
    })

    expect(result.mergedFolders).toEqual([folder])
    expect(putNoteFoldersFile).toHaveBeenCalledOnce()
    const [content, sha] = putNoteFoldersFile.mock.calls[0]!
    expect(sha).toBeNull()
    expect(content).not.toContain(folder.name)
    const envelope = JSON.parse(content) as {
      v: number
      iv: string
      data: string
      kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string }
    }
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', envelope.kdf)
    await expect(decryptRecord(
      { v: envelope.v, iv: envelope.iv, data: envelope.data },
      key,
      'note-folders',
    )).resolves.toEqual([folder])
  })

  it('pulls encrypted folders before merging notes assigned to them', async () => {
    const folder: VaultNoteFolder = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'Remote folder',
      parentId: null,
      createdAt: 1,
      updatedAt: 2,
      deleted: false,
    }
    const note: VaultNote = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Remote note',
      markdown: 'Body',
      folderId: folder.id,
      createdAt: 1,
      updatedAt: 2,
      deleted: false,
    }
    const kdf = {
      name: 'PBKDF2-SHA256' as const,
      iterations: 10,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    }
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', kdf)
    const encryptedFolderManifest = await encryptRecord([folder], key, 'note-folders')
    const encryptedNote = await encryptRecord(note, key, `note:${note.id}`)
    getNoteFoldersFile.mockResolvedValue({
      content: JSON.stringify({ ...encryptedFolderManifest, kdf }),
      sha: 'folders-sha',
    })
    getFile.mockResolvedValue(await remoteFile(payload))
    listNoteFiles.mockResolvedValue([{ path: `notes/${note.id}.json`, sha: 'note-sha' }])
    getNoteFile.mockResolvedValue({ content: JSON.stringify({ ...encryptedNote, kdf }), sha: 'note-sha' })

    const result = await runSync({ config, masterPassword: 'master-password', payload })

    expect(result.mergedFolders).toEqual([folder])
    expect(result.mergedNotes).toEqual([note])
    expect(result.outcome.foldersReceived).toBe(1)
    expect(putNoteFoldersFile).not.toHaveBeenCalled()
  })

  it('pulls remote note files and merges them with the local note collection', async () => {
    const note: VaultNote = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Remote note',
      markdown: 'From GitHub',
      folderId: null,
      createdAt: 1,
      updatedAt: 2,
      deleted: false,
    }
    const kdf = {
      name: 'PBKDF2-SHA256' as const,
      iterations: 10,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    }
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', kdf)
    const encrypted = await encryptRecord(note, key, `note:${note.id}`)
    listNoteFiles.mockResolvedValue([{ path: `notes/${note.id}.json`, sha: 'note-sha' }])
    getNoteFile.mockResolvedValue({ content: JSON.stringify({ ...encrypted, kdf }), sha: 'note-sha' })
    getFile.mockResolvedValue(await remoteFile(payload))

    const result = await runSync({ config, masterPassword: 'master-password', payload })

    expect(result.mergedNotes).toEqual([note])
    expect(result.outcome.notesReceived).toBe(1)
    expect(putNoteFile).not.toHaveBeenCalled()
  })

  it('deletes a remote note file only after both sides have its tombstone', async () => {
    const deletedNote: VaultNote = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Deleted note',
      markdown: 'Deleted body',
      createdAt: 1,
      updatedAt: 2,
      deleted: true,
    }
    const kdf = {
      name: 'PBKDF2-SHA256' as const,
      iterations: 10,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    }
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', kdf)
    const encrypted = await encryptRecord(deletedNote, key, `note:${deletedNote.id}`)
    listNoteFiles.mockResolvedValue([{ path: `notes/${deletedNote.id}.json`, sha: 'deleted-sha' }])
    getNoteFile.mockResolvedValue({ content: JSON.stringify({ ...encrypted, kdf }), sha: 'deleted-sha' })
    getFile.mockResolvedValue(await remoteFile(payload))

    const result = await runSync({
      config,
      masterPassword: 'master-password',
      payload: { ...payload, notes: [deletedNote] },
    })

    expect(result.mergedNotes).toEqual([])
    expect(deleteNoteFile).toHaveBeenCalledWith(`notes/${deletedNote.id}.json`, 'deleted-sha')
  })

  it('re-encrypts individual note files when the GitHub password changes', async () => {
    const note: VaultNote = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Rotated note',
      markdown: 'Still private',
      folderId: null,
      createdAt: 1,
      updatedAt: 2,
      deleted: false,
    }
    const kdf = {
      name: 'PBKDF2-SHA256' as const,
      iterations: 10,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    }
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', kdf)
    const encrypted = await encryptRecord(note, key, `note:${note.id}`)
    listNoteFiles.mockResolvedValue([{ path: `notes/${note.id}.json`, sha: 'note-sha' }])
    getNoteFile.mockResolvedValue({ content: JSON.stringify({ ...encrypted, kdf }), sha: 'note-sha' })
    getFile.mockResolvedValue(await remoteFile(payload))

    await expect(rotateSyncPassword(config, 'master-password', 'new-password')).resolves.toBe(true)

    expect(putNoteFile).toHaveBeenCalledWith(`notes/${note.id}.json`, expect.any(String), 'note-sha')
    const [, content] = putNoteFile.mock.calls[0]!
    const rotatedNote = JSON.parse(content) as { v: number; iv: string; data: string; kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string } }
    const { key: newKey } = await deriveKey('new-password', rotatedNote.kdf)
    await expect(decryptRecord(
      { v: rotatedNote.v, iv: rotatedNote.iv, data: rotatedNote.data },
      newKey,
      `note:${note.id}`,
    )).resolves.toEqual(note)
  })

  it('re-encrypts the folder manifest when the GitHub password changes', async () => {
    const folder: VaultNoteFolder = {
      id: 'folder-1', name: 'Private folder', parentId: null,
      createdAt: 1, updatedAt: 2, deleted: false,
    }
    const kdf = {
      name: 'PBKDF2-SHA256' as const,
      iterations: 10,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    }
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', kdf)
    const encrypted = await encryptRecord([folder], key, 'note-folders')
    getNoteFoldersFile.mockResolvedValue({
      content: JSON.stringify({ ...encrypted, kdf }),
      sha: 'folders-sha',
    })
    getFile.mockResolvedValue(await remoteFile(payload))

    await expect(rotateSyncPassword(config, 'master-password', 'new-password')).resolves.toBe(true)

    expect(putNoteFoldersFile).toHaveBeenCalledOnce()
    const [content, sha] = putNoteFoldersFile.mock.calls[0]!
    expect(sha).toBe('folders-sha')
    const rotated = JSON.parse(content) as {
      v: number
      iv: string
      data: string
      kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string }
    }
    const { key: newKey } = await deriveKey('new-password', rotated.kdf)
    await expect(decryptRecord(
      { v: rotated.v, iv: rotated.iv, data: rotated.data },
      newKey,
      'note-folders',
    )).resolves.toEqual([folder])
  })

  it('rejects concurrent folder moves that would create a cycle', async () => {
    const localFolders: VaultNoteFolder[] = [
      { id: 'a', name: 'A', parentId: 'b', createdAt: 1, updatedAt: 10, deleted: false },
      { id: 'b', name: 'B', parentId: null, createdAt: 1, updatedAt: 1, deleted: false },
    ]
    const remoteFolders: VaultNoteFolder[] = [
      { id: 'a', name: 'A', parentId: null, createdAt: 1, updatedAt: 1, deleted: false },
      { id: 'b', name: 'B', parentId: 'a', createdAt: 1, updatedAt: 10, deleted: false },
    ]
    const kdf = {
      name: 'PBKDF2-SHA256' as const,
      iterations: 10,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    }
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('master-password', kdf)
    const encrypted = await encryptRecord(remoteFolders, key, 'note-folders')
    getNoteFoldersFile.mockResolvedValue({
      content: JSON.stringify({ ...encrypted, kdf }),
      sha: 'folders-sha',
    })
    getFile.mockResolvedValue(await remoteFile(payload))

    await expect(runSync({
      config,
      masterPassword: 'master-password',
      payload: { ...payload, noteFolders: localFolders },
    })).rejects.toMatchObject({ kind: 'conflict' })
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
