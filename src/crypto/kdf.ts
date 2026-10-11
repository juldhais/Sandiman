/**
 * Password-based key derivation, dispatched to a Web Worker.
 *
 * The only reason this is not a plain `crypto.subtle.deriveKey` call is the
 * main-thread stall. See `kdf.worker.ts`.
 */
import { encodeBase64 } from './base64'
import {
  DEFAULT_ITERATIONS,
  KDF_NAMES,
  SALT_BYTES,
  type KdfName,
  type KdfParams,
} from './envelope'
import { randomBytes } from './secureRandom'
import type { WorkerRequest, WorkerResponse } from './kdf.worker'

/** A derived key plus the wall-clock cost of producing it. */
export interface DerivedKey {
  key: CryptoKey
  elapsedMs: number
}

let worker: Worker | null = null
let nextRequestId = 1

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

function post<T extends WorkerResponse>(
  request: WorkerRequest,
  transfer?: Transferable[],
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const activeWorker = getWorker()

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      // Ignore replies belonging to other in-flight requests.
      if (response.id !== request.id) return
      activeWorker.removeEventListener('message', onMessage)
      if (response.ok) {
        resolve(response as T)
      } else {
        reject(new Error('error' in response ? response.error : 'Key derivation failed'))
      }
    }

    const onError = (event: ErrorEvent) => {
      activeWorker.removeEventListener('message', onMessage)
      reject(new Error(event.message || 'The key derivation worker crashed'))
    }

    activeWorker.addEventListener('message', onMessage)
    activeWorker.addEventListener('error', onError)
    activeWorker.postMessage(request, transfer ?? [])
  })
}

/**
 * Builds a fresh salt plus the KDF descriptor that will be stored next to the
 * ciphertext. The descriptor must be persisted for the vault to be unlockable.
 */
export function createKdfParams(overrides?: {
  iterations?: number
  name?: KdfName
}): KdfParams {
  const name = overrides?.name ?? 'PBKDF2-SHA256'
  if (!KDF_NAMES.includes(name)) {
    throw new Error(`Unsupported KDF: ${String(overrides?.name)}`)
  }
  return {
    name,
    iterations: overrides?.iterations ?? DEFAULT_ITERATIONS,
    salt: encodeBase64(randomBytes(SALT_BYTES)),
  }
}

/**
 * Derives an AES-GCM key from a password. Runs in the worker; resolves with a
 * non-extractable key.
 */
export async function deriveKey(
  password: string,
  kdf: KdfParams,
): Promise<DerivedKey> {
  const id = nextRequestId++
  const response = await post<Extract<WorkerResponse, { ok: true; key: CryptoKey }>>({
    id,
    type: 'derive',
    password,
    kdf,
  })
  return { key: response.key, elapsedMs: response.elapsedMs }
}

