import { describe, expect, it } from 'vitest'
import { DecryptError, decryptVault, encryptVault } from '@/crypto/aes'
import { createKdfParams } from '@/crypto/kdf'
import { decodeBase64 } from '@/crypto/base64'
import type { KdfParams } from '@/crypto/envelope'
import type { VaultPayload } from '@/storage/types'

/**
 * Iterations are reduced for the tests: the real 600,000 makes each case take
 * around a second, and the purpose here is to exercise the envelope logic, not
 * to measure the work factor.
 */
const TEST_ITERATIONS = 1000

function kdf(): KdfParams {
  return createKdfParams({ iterations: TEST_ITERATIONS })
}

/**
 * Derives a key directly rather than through `deriveKey`, which dispatches to a
 * Web Worker that does not exist in the Node test environment. The parameters
 * must stay identical to the worker's, or these tests would not be exercising
 * the real derivation.
 */
async function derive(password: string, params: KdfParams): Promise<CryptoKey> {
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

function payload(): VaultPayload {
  return {
    version: 1,
    items: [
      {
        id: 'a',
        templateId: 'builtin-login',
        title: 'Example',
        values: { username: 'alice', password: 'hunter2' },
        customFields: [],
        tags: ['work'],
        notes: '',
        createdAt: 1,
        updatedAt: 2,
        deleted: false,
      },
    ],
    templates: [],
    settings: {
      clipboardClearSeconds: 30,
      autoLockMinutes: 5,
      lockOnBlur: false,
      expiryWarningDays: 30,
      lastSyncAt: null,
    },
    updatedAt: 2,
  }
}

describe('AES-GCM envelope', () => {
  it('round-trips a payload', async () => {
    const params = kdf()
    const key = await derive('correct horse battery staple', params)

    const envelope = await encryptVault(payload(), key, params)

    await expect(decryptVault(envelope, key)).resolves.toEqual(payload())
  })

  it('produces different ciphertext each time for the same input', async () => {
    const params = kdf()
    const key = await derive('password', params)

    const first = await encryptVault(payload(), key, params)
    const second = await encryptVault(payload(), key, params)

    // A fresh IV per encryption is what prevents GCM keystream reuse.
    expect(first.iv).not.toBe(second.iv)
    expect(first.data).not.toBe(second.data)
  })

  it('reports a wrong password distinctly from corruption', async () => {
    const params = kdf()
    const key = await derive('right password', params)
    const envelope = await encryptVault(payload(), key, params)

    const wrongKey = await derive('wrong password', params)

    await expect(decryptVault(envelope, wrongKey)).rejects.toMatchObject({
      reason: 'wrong-password',
    })
  })

  it('detects tampering with the ciphertext', async () => {
    const params = kdf()
    const key = await derive('password', params)
    const envelope = await encryptVault(payload(), key, params)

    // Flip one character in the middle of the base64 payload.
    const chars = envelope.data.split('')
    const index = Math.floor(chars.length / 2)
    chars[index] = chars[index] === 'A' ? 'B' : 'A'

    // GCM authenticates, so any modification fails the tag check.
    await expect(decryptVault({ ...envelope, data: chars.join('') }, key)).rejects.toThrow(
      DecryptError,
    )
  })

  it('rejects an envelope from a newer version', async () => {
    const params = kdf()
    const key = await derive('password', params)
    const envelope = await encryptVault(payload(), key, params)

    await expect(decryptVault({ ...envelope, v: 99 }, key)).rejects.toMatchObject({
      reason: 'unsupported-version',
    })
  })

  it('rejects an envelope missing required fields', async () => {
    const params = kdf()
    const key = await derive('password', params)

    await expect(decryptVault({ v: 1, kdf: params } as never, key)).rejects.toBeInstanceOf(
      DecryptError,
    )
  })

  it('does not expose the payload in the serialised envelope', async () => {
    const params = kdf()
    const key = await derive('password', params)
    const envelope = await encryptVault(payload(), key, params)

    const serialised = JSON.stringify(envelope)
    expect(serialised).not.toContain('hunter2')
    expect(serialised).not.toContain('alice')
  })

  it('derives different keys from different salts', async () => {
    const paramsA = kdf()
    const paramsB = kdf()
    const keyA = await derive('same password', paramsA)
    const keyB = await derive('same password', paramsB)

    const envelope = await encryptVault(payload(), keyA, paramsA)

    await expect(decryptVault(envelope, keyB)).rejects.toThrow()
  })

  it('generates a distinct salt per call', () => {
    expect(kdf().salt).not.toBe(kdf().salt)
  })
})