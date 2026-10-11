/**
 * Shared Key (connection string) blob access for the browser.
 *
 * Azure's own `@azure/storage-blob` browser bundle deliberately omits
 * `StorageSharedKeyCredential`: their docs list Shared Key authorization as
 * "only available in Node.js runtime". Since Sandiman runs entirely in the
 * browser and the spec calls for connection-string support, the signing is
 * implemented here directly against the Blob REST API using WebCrypto.
 *
 * Only the operations the sync engine needs are implemented, and the surface is
 * intentionally close to `BlockBlobClient` so the engine can treat both
 * credential kinds the same way.
 *
 * Security note: this transmits the account key from the browser, which grants
 * full access to the storage account. The settings UI says so and recommends a
 * container-scoped SAS token instead. That is a limitation of the credential
 * type, not of this implementation.
 */

/** Service version. Pinned rather than "latest" so signatures stay stable. */
const API_VERSION = '2021-12-02'

export interface SharedKeyTarget {
  accountName: string
  accountKey: string
  /** Service endpoint, e.g. https://account.blob.core.windows.net */
  endpoint: string
  container: string
  blob: string
}

export class SharedKeyRequestError extends Error {
  readonly status: number

  constructor(status: number, body: string) {
    super(`Azure returned ${status}${body ? `: ${body.slice(0, 300)}` : ''}`)
    this.name = 'SharedKeyRequestError'
    this.status = status
  }
}

/** RFC 1123 date in GMT, the format Azure requires for `x-ms-date`. */
function rfc1123(date: Date): string {
  return date.toUTCString()
}

/**
 * Builds the `StringToSign` for Shared Key authorization.
 *
 * The layout is fixed by the service: a fixed set of standard headers in a
 * fixed order, then canonicalized `x-ms-*` headers, then the canonicalized
 * resource. Getting any part of this wrong produces a 403 rather than a
 * subtle partial failure.
 */
export function buildStringToSign(
  method: string,
  headers: Headers,
  contentLength: number,
  target: SharedKeyTarget,
  /**
   * Canonicalized resource. Container-level requests sign
   * `/account/container`, blob-level ones sign `/account/container/blob`.
   */
  resource = `/${target.accountName}/${target.container}/${target.blob}`,
): string {
  const get = (name: string): string => headers.get(name)?.trim() ?? ''

  // Canonicalized headers: every x-ms-* header, lowercased, sorted, each
  // contributing "name:value\n".
  const canonicalizedHeaders = Array.from(headers.entries())
    .filter(([name]) => name.startsWith('x-ms-'))
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, value]) => `${name}:${value}\n`)
    .join('')

  return [
    method.toUpperCase(),
    get('content-encoding'),
    get('content-language'),
    // An absent or zero length is signed as an empty string.
    contentLength > 0 ? String(contentLength) : '',
    get('content-md5'),
    get('content-type'),
    get('date'),
    get('if-modified-since'),
    get('if-match'),
    get('if-none-match'),
    get('if-unmodified-since'),
    get('range'),
    canonicalizedHeaders,
    resource,
  ].join('\n')
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = ''
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]!)
  return btoa(binary)
}

/** Computes `SharedKey account:signature` for a prepared request. */
async function signRequest(
  method: string,
  headers: Headers,
  contentLength: number,
  target: SharedKeyTarget,
  resource: string,
): Promise<string> {
  const stringToSign = buildStringToSign(method, headers, contentLength, target, resource)

  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(target.accountKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(stringToSign),
  )

  return `SharedKey ${target.accountName}:${bytesToBase64(signature)}`
}

/** Builds the signed headers every request needs. */
async function prepare(
  method: string,
  target: SharedKeyTarget,
  extra: Record<string, string> = {},
  contentLength = 0,
  scope: 'blob' | 'container' = 'blob',
): Promise<Headers> {
  const headers = new Headers({
    // Signed rather than the browser's own Date header, which fetch may rewrite.
    'x-ms-date': rfc1123(new Date()),
    'x-ms-version': API_VERSION,
    ...extra,
  })

  const resource =
    scope === 'container'
      ? `/${target.accountName}/${target.container}`
      : `/${target.accountName}/${target.container}/${target.blob}`

  headers.set('Authorization', await signRequest(method, headers, contentLength, target, resource))
  return headers
}

function url(target: SharedKeyTarget, query: Record<string, string> = {}): string {
  const base = `${target.endpoint}/${target.container}/${target.blob}`
  const params = new URLSearchParams(query).toString()
  return params.length > 0 ? `${base}?${params}` : base
}

function containerUrl(target: SharedKeyTarget, query: Record<string, string> = {}): string {
  const base = `${target.endpoint}/${target.container}`
  const params = new URLSearchParams(query).toString()
  return params.length > 0 ? `${base}?${params}` : base
}

async function readError(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/** Minimum surface the sync engine uses from a blob client. */
export interface BlobTransport {
  containerExists(): Promise<boolean>
  createContainer(): Promise<void>
  blobExists(): Promise<boolean>
  download(): Promise<string>
  upload(body: string, leaseId: string): Promise<void>
  acquireLease(leaseId: string, durationSeconds: number): Promise<void>
  releaseLease(leaseId: string): Promise<void>
}

export class SharedKeyBlobTransport implements BlobTransport {
  readonly target: SharedKeyTarget

  constructor(target: SharedKeyTarget) {
    this.target = target
  }

  async containerExists(): Promise<boolean> {
    const headers = await prepare('HEAD', this.target, {}, 0, 'container')
    const response = await fetch(containerUrl(this.target), { method: 'HEAD', headers })
    if (response.status === 404) return false
    if (!response.ok) throw new SharedKeyRequestError(response.status, await readError(response))
    return true
  }

  async createContainer(): Promise<void> {
    const headers = await prepare('PUT', this.target, {}, 0, 'container')
    const response = await fetch(containerUrl(this.target, { restype: 'container' }), {
      method: 'PUT',
      headers,
    })
    // 409 means another device created it first, which is a success for us.
    if (!response.ok && response.status !== 409) {
      throw new SharedKeyRequestError(response.status, await readError(response))
    }
  }

  async blobExists(): Promise<boolean> {
    const headers = await prepare('HEAD', this.target, {}, 0)
    const response = await fetch(url(this.target), { method: 'HEAD', headers })
    if (response.status === 404) return false
    if (!response.ok) throw new SharedKeyRequestError(response.status, await readError(response))
    return true
  }

  async download(): Promise<string> {
    const headers = await prepare('GET', this.target, {}, 0)
    const response = await fetch(url(this.target), { method: 'GET', headers })
    if (!response.ok) throw new SharedKeyRequestError(response.status, await readError(response))
    return response.text()
  }

  async upload(body: string, leaseId: string): Promise<void> {
    const content = new TextEncoder().encode(body)
    const headers = await prepare(
      'PUT',
      this.target,
      {
        'x-ms-blob-type': 'BlockBlob',
        'content-type': 'application/json',
        // Optimistic concurrency, mirroring the SDK path.
        'if-match': '*',
        'x-ms-lease-id': leaseId,
      },
      content.byteLength,
    )

    const response = await fetch(url(this.target), { method: 'PUT', headers, body })
    if (!response.ok) throw new SharedKeyRequestError(response.status, await readError(response))
  }

  async acquireLease(leaseId: string, durationSeconds: number): Promise<void> {
    const headers = await prepare('PUT', this.target, {
      'x-ms-lease-id': leaseId,
      'x-ms-lease-action': 'acquire',
      'x-ms-lease-duration': String(durationSeconds),
    })

    const response = await fetch(url(this.target, { comp: 'lease' }), { method: 'PUT', headers })
    if (!response.ok) throw new SharedKeyRequestError(response.status, await readError(response))
  }

  async releaseLease(leaseId: string): Promise<void> {
    const headers = await prepare('PUT', this.target, {
      'x-ms-lease-id': leaseId,
      'x-ms-lease-action': 'release',
    })

    const response = await fetch(url(this.target, { comp: 'lease' }), { method: 'PUT', headers })
    if (!response.ok) throw new SharedKeyRequestError(response.status, await readError(response))
  }
}