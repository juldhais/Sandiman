import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getVaultState, savePayload, unlock, WrongPasswordError } from '@/storage/vaultService'
import { readEnvelope, setMetaEntries, META_KEYS } from '@/storage/db'
import { emptyPayload } from '@/storage/vaultService'
import { VAULT_PAYLOAD_VERSION, type VaultPayload } from '@/storage/types'
import { decryptVault } from '@/crypto/aes'
import { createKdfParams } from '@/crypto/kdf'
import { decodeBase64 } from '@/crypto/base64'

/**
 * Derives a key directly; `vaultService` reaches its key through the KDF
 * worker, which does not exist in Node.
 */
async function derive(password: string, params: ReturnType<typeof createKdfParams>) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: decodeBase64(params.salt),
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Seeds a vault directly, bypassing the worker-dependent create path. */
async function seed(password: string, payload: VaultPayload): Promise<void> {
  const kdf = createKdfParams({ iterations: 1000 })
  const key = await derive(password, kdf)
  const { encryptVault } = await import('@/crypto/aes')
  const envelope = await encryptVault(payload, key, kdf)

  const { writeEnvelope } = await import('@/storage/db')
  await writeEnvelope(envelope, Date.now())
  await setMetaEntries({
    [META_KEYS.initialized]: true,
    [META_KEYS.masterKdf]: kdf,
  })
}

describe('vault storage lifecycle', () => {
  beforeEach(async () => {
    const { destroyDatabase } = await import('@/storage/db')
    await destroyDatabase()
  })

  it('reports uninitialized for a fresh database', async () => {
    await expect(getVaultState()).resolves.toBe('uninitialized')
  })

  it('reports locked once an envelope exists', async () => {
    await seed('master-password', emptyPayload(1000))
    await expect(getVaultState()).resolves.toBe('locked')
  })

  it('round-trips a payload through IndexedDB', async () => {
    const payload = emptyPayload(1000)
    payload.items.push({
      id: 'i1',
      templateId: 'builtin-login',
      title: 'Example',
      values: { password: 'hunter2' },
      customFields: [],
      tags: [],
      notes: '',
      createdAt: 0,
      updatedAt: 0,
      deleted: false,
    })

    await seed('master-password', payload)

    // Read the envelope back the way the unlock path does.
    const envelope = await readEnvelope()
    expect(envelope).not.toBeNull()

    const kdf = envelope!.kdf
    const key = await derive('master-password', kdf)
    const decrypted = (await decryptVault(envelope!, key)) as VaultPayload

    expect(decrypted.items[0]!.values.password).toBe('hunter2')
  })

  it('keeps the ciphertext opaque in storage', async () => {
    await seed('master-password', {
      ...emptyPayload(1000),
      items: [
        {
          id: 'i1',
          templateId: null,
          title: 'Secret entry',
          values: { password: 'do-not-leak' },
          customFields: [],
          tags: [],
          notes: '',
          createdAt: 0,
          updatedAt: 0,
          deleted: false,
        },
      ],
    })

    const envelope = await readEnvelope()
    const serialised = JSON.stringify(envelope)

    expect(serialised).not.toContain('do-not-leak')
    expect(serialised).not.toContain('Secret entry')
  })

  it('derives a different envelope after a save', async () => {
    const payload = emptyPayload(1000)
    await seed('master-password', payload)

    const envelope = await readEnvelope()
    const kdf = envelope!.kdf
    const key = await derive('master-password', kdf)

    const first = await savePayload(payload, key, kdf, 2000)
    const second = await savePayload(payload, key, kdf, 3000)

    // A new IV per write means two writes of identical data differ on disk.
    expect(first.iv).not.toBe(second.iv)
  })

  it('refuses to unlock when no envelope exists', async () => {
    // The state after the database is cleared but before a vault is created.
    await expect(unlock('master-password')).rejects.toThrow(/No vault exists/i)
  })
})

describe('payload versioning', () => {
  it('exports a stable payload version', () => {
    expect(VAULT_PAYLOAD_VERSION).toBe(1)
  })

  it('seeds the built-in templates into a new vault', () => {
    const payload = emptyPayload(0)
    expect(payload.templates.length).toBeGreaterThanOrEqual(4)
    expect(payload.templates.every((template) => template.builtIn)).toBe(true)
  })

  it('strips sync credentials before upload', async () => {
    const { toSyncPayload } = await import('@/storage/types')
    const payload: VaultPayload = {
      ...emptyPayload(0),
      sync: { config: {} as never, password: 'sync-secret' },
    }

    const shared = toSyncPayload(payload)

    expect(shared).not.toHaveProperty('sync')
    expect(JSON.stringify(shared)).not.toContain('sync-secret')
  })
})

describe('WrongPasswordError', () => {
  it('is a distinct type the UI can branch on', () => {
    const error = new WrongPasswordError()
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('WrongPasswordError')
  })
})