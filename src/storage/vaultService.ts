/**
 * Vault lifecycle: create, unlock, persist, change master password.
 *
 * This module owns the one invariant that matters most: the derived master key
 * lives only as a local variable or in the store's memory, and is never
 * written to storage. Everything persisted is the envelope produced by
 * `encryptVault`.
 */
import { DecryptError, decryptVault, encryptVault } from '@/crypto/aes'
import { createKdfParams, deriveKey } from '@/crypto/kdf'
import type { Envelope, KdfParams } from '@/crypto/envelope'
import { createBuiltinTemplates } from './builtins'
import {
  META_KEYS,
  isInitialized,
  readEnvelope,
  setMeta,
  setMetaEntries,
  writeEnvelope,
} from './db'
import { parseVaultPayload } from './schema'
import {
  DEFAULT_SETTINGS,
  VAULT_PAYLOAD_VERSION,
  type VaultPayload,
} from './types'
import { DEFAULT_AZURE_SYNC_CONFIG } from '@/sync/types'

export type VaultState = 'uninitialized' | 'locked' | 'unlocked'

export interface UnlockSuccess {
  payload: VaultPayload
  /** Non-extractable master key, for subsequent writes. */
  key: CryptoKey
  kdf: KdfParams
  elapsedMs: number
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Incorrect master password')
    this.name = 'WrongPasswordError'
  }
}

/**
 * Reports which screen to show.
 *
 * IndexedDB is the source of truth here, not any in-memory flag, so a reload
 * after locking lands on the correct screen.
 */
export async function getVaultState(): Promise<VaultState> {
  if (!(await isInitialized())) return 'uninitialized'
  // A present envelope means there is ciphertext to unlock against. An
  // initialised vault without one is still 'locked', since the unlock screen
  // is where the missing-ciphertext case gets diagnosed.
  return 'locked'
}

/** Builds the payload a brand-new vault starts with. */
export function emptyPayload(now: number = Date.now()): VaultPayload {
  return {
    version: VAULT_PAYLOAD_VERSION,
    items: [],
    templates: createBuiltinTemplates(now),
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: now,
    sync: {
      config: { ...DEFAULT_AZURE_SYNC_CONFIG },
      password: '',
    },
  }
}

/**
 * Creates the vault: derives a fresh key, seeds built-in templates, and
 * writes the first envelope.
 */
export async function createVault(
  password: string,
  now: number = Date.now(),
): Promise<UnlockSuccess> {
  if (await isInitialized()) {
    throw new Error('A vault already exists on this device')
  }

  const kdf = createKdfParams()
  const { key, elapsedMs } = await deriveKey(password, kdf)
  const payload = emptyPayload(now)

  await writeEnvelope(await encryptVault(payload, key, kdf), now)
  await setMetaEntries({
    [META_KEYS.initialized]: true,
    [META_KEYS.masterKdf]: kdf,
    [META_KEYS.createdAt]: now,
    [META_KEYS.lastLocalWriteAt]: now,
  })

  return { payload, key, kdf, elapsedMs }
}

/**
 * Derives the master key from a password and the stored KDF descriptor.
 *
 * Exposed separately from `unlock` so the settings screen can verify a
 * password change without decrypting the whole vault.
 */
export async function deriveMasterKey(
  password: string,
): Promise<{ key: CryptoKey; kdf: KdfParams; elapsedMs: number } | null> {
  const envelope = await readEnvelope()
  if (!envelope) return null
  const derived = await deriveKey(password, envelope.kdf)
  return { key: derived.key, kdf: envelope.kdf, elapsedMs: derived.elapsedMs }
}

/**
 * Unlocks the vault.
 *
 * @throws {WrongPasswordError} on a bad password.
 * @throws {DecryptError} with `reason: 'corrupt-payload'` when the stored
 * envelope is damaged. These are kept distinct because only one is the user's
 * fault.
 */
export async function unlock(password: string): Promise<UnlockSuccess> {
  const envelope = await readEnvelope()
  if (!envelope) {
    throw new Error('No vault exists on this device yet')
  }

  const { key, elapsedMs } = await deriveKey(password, envelope.kdf)

  let payload: VaultPayload
  try {
    const decrypted = await decryptVault(envelope, key)
    payload = parseVaultPayload(decrypted)
  } catch (cause) {
    if (cause instanceof DecryptError && cause.reason === 'wrong-password') {
      throw new WrongPasswordError()
    }
    throw cause
  }

  return { payload, key, kdf: envelope.kdf, elapsedMs }
}

/**
 * Encrypts and persists a payload.
 *
 * Callers pass the in-memory key so the master password is never needed again
 * while the vault is unlocked.
 */
export async function savePayload(
  payload: VaultPayload,
  key: CryptoKey,
  kdf: KdfParams,
  now: number = Date.now(),
): Promise<Envelope> {
  const envelope = await encryptVault(payload, key, kdf)
  await writeEnvelope(envelope, now)
  return envelope
}

/**
 * Re-encrypts the vault under a new master password.
 *
 * The old password is verified first, because a typo in the current password
 * should not be able to make the vault unopenable. A *new* salt is generated,
 * so the new envelope is unrelated to the old one at the key-derivation level.
 */
export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string,
): Promise<UnlockSuccess> {
  const envelope = await readEnvelope()
  if (!envelope) throw new Error('No vault exists on this device yet')

  const { key: currentKey } = await deriveKey(currentPassword, envelope.kdf)
  try {
    await decryptVault(envelope, currentKey)
  } catch (cause) {
    if (cause instanceof DecryptError && cause.reason === 'wrong-password') {
      throw new WrongPasswordError()
    }
    throw cause
  }

  const kdf = createKdfParams()
  const { key, elapsedMs } = await deriveKey(newPassword, kdf)
  const now = Date.now()

  // Carry the decrypted payload across under the new key.
  const decrypted = await decryptVault(envelope, currentKey)
  const payload = parseVaultPayload(decrypted)

  await writeEnvelope(await encryptVault(payload, key, kdf), now)
  await setMeta(META_KEYS.masterKdf, kdf)

  return { payload, key, kdf, elapsedMs }
}