/**
 * AES-GCM-256 encryption over a versioned envelope.
 *
 * Encryption is authenticated but not hidden from the *shape* of the message:
 * the KDF descriptor (algorithm, work factor, salt) and the IV travel in the
 * clear, because the receiver needs them to derive the key and to decrypt.
 * The salt and IV are not secret; the payload is.
 */
import { decodeBase64, encodeBase64 } from './base64'
import {
  ENVELOPE_VERSION,
  IV_BYTES,
  type Envelope,
  type KdfParams,
  type RecordCiphertext,
  type VaultPayload,
} from './envelope'
import { randomBytes } from './secureRandom'

/**
 * Why a decrypt attempt failed.
 *
 * These are distinguished because the two cases need different user-facing
 * reactions: a wrong password is the user's typo, whereas corruption means the
 * stored blob has been damaged and re-entering the password will not help.
 */
export type DecryptFailureReason =
  /** AES-GCM auth tag did not verify: overwhelmingly likely a wrong password. */
  | 'wrong-password'
  /** Envelope is structurally valid base64/JSON but semantically unusable. */
  | 'corrupt-payload'
  /** The envelope declares a version this build cannot read. */
  | 'unsupported-version'
  /** Key usage or an environment-level failure. */
  | 'unsupported'

export class DecryptError extends Error {
  readonly reason: DecryptFailureReason

  constructor(reason: DecryptFailureReason, message?: string) {
    super(message ?? `Decryption failed: ${reason}`)
    this.name = 'DecryptError'
    this.reason = reason
  }
}

/** Structural check on an envelope before trusting any of its fields. */
function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Envelope>
  if (typeof candidate.v !== 'number') return false
  if (typeof candidate.iv !== 'string') return false
  if (typeof candidate.data !== 'string') return false
  if (typeof candidate.kdf !== 'object' || candidate.kdf === null) return false
  const { kdf } = candidate
  if (typeof kdf.name !== 'string') return false
  if (typeof kdf.iterations !== 'number') return false
  if (typeof kdf.salt !== 'string') return false
  return true
}

/**
 * Encrypts a vault payload.
 *
 * A fresh random 96-bit IV is drawn per call. Reusing an IV under the same key
 * would be catastrophic for GCM; random 96-bit nonces make collisions
 * negligibly unlikely at the number of records a browser vault can hold.
 */
export async function encryptVault(
  payload: VaultPayload,
  key: CryptoKey,
  kdf: KdfParams,
): Promise<Envelope> {
  const iv = randomBytes(IV_BYTES)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  return {
    v: ENVELOPE_VERSION,
    kdf,
    iv: encodeBase64(iv),
    data: encodeBase64(new Uint8Array(ciphertext)),
  }
}

/**
 * Decrypts an envelope back into a vault payload.
 *
 * @throws {DecryptError} with a `reason` the caller can branch on.
 */
export async function decryptVault(envelope: Envelope, key: CryptoKey): Promise<VaultPayload> {
  if (!isEnvelope(envelope)) {
    throw new DecryptError('corrupt-payload', 'Envelope is missing required fields')
  }
  if (envelope.v > ENVELOPE_VERSION) {
    throw new DecryptError(
      'unsupported-version',
      `Envelope version ${envelope.v} is newer than this build supports (${ENVELOPE_VERSION})`,
    )
  }

  let iv: Uint8Array<ArrayBuffer>
  let ciphertext: Uint8Array<ArrayBuffer>
  try {
    iv = decodeBase64(envelope.iv)
    ciphertext = decodeBase64(envelope.data)
  } catch {
    throw new DecryptError('corrupt-payload', 'Envelope fields are not valid base64')
  }

  if (iv.length !== IV_BYTES) {
    throw new DecryptError('corrupt-payload', `Expected a ${IV_BYTES}-byte IV, got ${iv.length}`)
  }

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  } catch {
    // AES-GCM reports a single opaque failure for both a bad key and a bad
    // auth tag. In the unlock path the overwhelmingly common cause is a wrong
    // password, so that is what this reports.
    throw new DecryptError('wrong-password')
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('payload is not an object')
    }
    return parsed as VaultPayload
  } catch {
    throw new DecryptError('corrupt-payload', 'Decrypted bytes are not a vault payload')
  }
}

/** Encrypts one local record, binding its type and ID to the authentication tag. */
export async function encryptRecord(
  value: unknown,
  key: CryptoKey,
  context: string,
): Promise<RecordCiphertext> {
  const iv = randomBytes(IV_BYTES)
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const additionalData = new TextEncoder().encode(`sandiman:${context}`)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    plaintext,
  )
  return { v: ENVELOPE_VERSION, iv: encodeBase64(iv), data: encodeBase64(new Uint8Array(ciphertext)) }
}

/** Decrypts one local record and rejects swapped IDs or record types. */
export async function decryptRecord<T>(
  record: RecordCiphertext,
  key: CryptoKey,
  context: string,
): Promise<T> {
  if (
    typeof record !== 'object' || record === null || record.v !== ENVELOPE_VERSION ||
    typeof record.iv !== 'string' || typeof record.data !== 'string'
  ) {
    throw new DecryptError('corrupt-payload', 'Local record has an unexpected shape')
  }

  let iv: Uint8Array<ArrayBuffer>
  let ciphertext: Uint8Array<ArrayBuffer>
  try {
    iv = decodeBase64(record.iv)
    ciphertext = decodeBase64(record.data)
  } catch {
    throw new DecryptError('corrupt-payload', 'Local record fields are not valid base64')
  }
  if (iv.length !== IV_BYTES) {
    throw new DecryptError('corrupt-payload', `Expected a ${IV_BYTES}-byte IV, got ${iv.length}`)
  }

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`sandiman:${context}`) },
      key,
      ciphertext,
    )
  } catch {
    throw new DecryptError('corrupt-payload', 'A local record failed authentication')
  }

  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    throw new DecryptError('corrupt-payload', 'A local record is not valid JSON')
  }
}

/** Parses JSON into an envelope, reporting corruption rather than throwing raw. */
export function parseEnvelope(raw: string): Envelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new DecryptError('corrupt-payload', 'Envelope is not valid JSON')
  }
  if (!isEnvelope(parsed)) {
    throw new DecryptError('corrupt-payload', 'Envelope JSON has an unexpected shape')
  }
  return parsed
}
