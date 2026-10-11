/**
 * Base64 helpers.
 *
 * `btoa` only accepts latin1, so binary data must be widened to a binary
 * string first. The chunked spread below keeps large buffers well under the
 * engine's argument-count limit.
 */

/** Encodes bytes as standard base64. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Decodes standard base64 to bytes.
 *
 * @throws if the input is not valid base64, which callers treat as a corrupt
 * envelope rather than a wrong password.
 */
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}