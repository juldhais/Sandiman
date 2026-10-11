import { describe, expect, it, vi } from 'vitest'
import { decryptVault } from '@/crypto/aes'
import { sealForSync } from '@/sync/syncEngine'
import type { VaultPayload } from '@/storage/types'

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
}

describe('master-password sync encryption', () => {
  it('encrypts the shared vault payload with the master password and strips local sync config', async () => {
    const envelope = await sealForSync(
      { ...payload, sync: { config: {} as never } },
      'the-vault-master-password',
    )
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('the-vault-master-password', envelope.kdf)
    const decrypted = await decryptVault(envelope, key)

    expect(decrypted).not.toHaveProperty('sync')
    expect(decrypted.items).toEqual([])
  })

  it('does not allow a different password to decrypt the remote envelope', async () => {
    const envelope = await sealForSync(payload, 'the-vault-master-password')
    const { deriveKey } = await import('@/crypto/kdf')
    const { key } = await deriveKey('a-different-password', envelope.kdf)

    await expect(decryptVault(envelope, key)).rejects.toThrow()
  })
})
