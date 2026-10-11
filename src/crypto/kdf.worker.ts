/// <reference lib="webworker" />

/**
 * PBKDF2 key derivation, executed off the main thread.
 *
 * 600,000 HMAC-SHA256 iterations take on the order of a second on typical
 * hardware. Running that inline on the main thread freezes the tab and makes
 * the unlock button look broken, so derivation is delegated here.
 *
 * The derived key is transferred back as a non-extractable `CryptoKey`, which
 * the structured clone algorithm carries by reference. Raw key material never
 * crosses the boundary and cannot be read back even from the returned handle.
 */
import { DEFAULT_ITERATIONS, KDF_NAMES, type KdfName, type KdfParams } from './envelope'

export interface DeriveRequest {
  id: number
  type: 'derive'
  password: string
  kdf: KdfParams
}

export interface PingRequest {
  id: number
  type: 'ping'
}

export type WorkerRequest = DeriveRequest | PingRequest

export interface DeriveResponse {
  id: number
  ok: true
  key: CryptoKey
  /** Wall-clock cost of derivation, surfaced in the unlock UI. */
  elapsedMs: number
}

export interface ErrorResponse {
  id: number
  ok: false
  error: string
}

export interface PongResponse {
  id: number
  ok: true
  type: 'pong'
}

export type WorkerResponse = DeriveResponse | ErrorResponse | PongResponse

function decodeSalt(salt: string): Uint8Array<ArrayBuffer> {
  const binary = atob(salt)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Derives a non-extractable AES-GCM key from a password.
 *
 * `extractable: false` is deliberate: it means the key cannot be exported to
 * disk or to storage as raw bytes. It can still be used for encrypt/decrypt,
 * which is the only thing the app asks of it.
 */
async function derive(password: string, kdf: KdfParams): Promise<CryptoKey> {
  const name = kdf.name as KdfName
  if (!KDF_NAMES.includes(name)) {
    throw new Error(`Unsupported KDF: ${String(kdf.name)}`)
  }

  const iterations = Number.isInteger(kdf.iterations) ? kdf.iterations : DEFAULT_ITERATIONS
  if (iterations < 1) {
    throw new Error(`Invalid PBKDF2 iteration count: ${kdf.iterations}`)
  }

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
      salt: decodeSalt(kdf.salt),
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    // Not extractable: see the note on `derive`.
    false,
    ['encrypt', 'decrypt'],
  )
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data

  if (request.type === 'ping') {
    ;(self as unknown as Worker).postMessage({ id: request.id, ok: true, type: 'pong' })
    return
  }

  const startedAt = performance.now()
  derive(request.password, request.kdf)
    .then((key) => {
      const response: DeriveResponse = {
        id: request.id,
        ok: true,
        key,
        elapsedMs: performance.now() - startedAt,
      }
      ;(self as unknown as Worker).postMessage(response)
    })
    .catch((cause: unknown) => {
      const response: ErrorResponse = {
        id: request.id,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }
      ;(self as unknown as Worker).postMessage(response)
    })
})