/**
 * Envelope version history.
 *
 * The envelope is the only thing that ever leaves this module in plaintext:
 * a KDF descriptor, an IV, and ciphertext. Everything else in the vault is
 * opaque to storage and to Azure. Fields are additive-only within a version
 * so an older build can still read a newer payload.
 */
export const ENVELOPE_VERSION = 1

/** KDF identifiers accepted by `deriveKeyFromEnvelope`. */
export const KDF_NAMES = ['PBKDF2-SHA256'] as const

export type KdfName = (typeof KDF_NAMES)[number]

/**
 * Work factor for PBKDF2-HMAC-SHA256. 600,000 matches the OWASP 2023 floor.
 *
 * Stored per-envelope rather than hardcoded at read time so the work factor
 * can be raised later without breaking existing vaults: old payloads keep
 * their recorded value, new ones record the new one.
 */
export const DEFAULT_ITERATIONS = 600_000

export const SALT_BYTES = 16
export const IV_BYTES = 12
export const KEY_BITS = 256

/** The decrypted shape. Consumers zod-parse this; it is never trusted as-is. */
export interface VaultPayload {
  /** Schema version of the payload body, independent of the envelope. */
  version: number
  items: unknown[]
  templates: unknown[]
  settings: unknown
  updatedAt: number
}

export interface KdfParams {
  name: KdfName
  iterations: number
  /** Base64-encoded random salt. */
  salt: string
}

/**
 * Serialisable, versioned crypto envelope.
 *
 * This is the on-disk / on-blob shape. Note what is absent: no host, no
 * account, no item metadata. Azure sees only these bytes.
 */
export interface Envelope {
  v: number
  kdf: KdfParams
  /** Base64 12-byte AES-GCM nonce, fresh for every single encryption. */
  iv: string
  /** Base64 AES-GCM-256 ciphertext, including the appended auth tag. */
  data: string
}