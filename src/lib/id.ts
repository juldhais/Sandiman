/**
 * Identifier generation.
 *
 * `crypto.randomUUID` gives us ids that sort well enough by creation time and
 * collide with negligible probability. The fallback exists only for the
 * non-secure-context case (an http:// origin), where `randomUUID` is absent;
 * it still draws from `getRandomValues`.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Derives a readable, unique-enough field id from a label.
 *
 * Field ids are stable references used as keys into item value maps, so they
 * must not collide when two fields share a label ("Name" and "Name"). Callers
 * disambiguate by passing a counter for repeats.
 */
export function slugify(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'field'
}

/**
 * Picks an id that is unique within `existing`, appending `-2`, `-3`, and so on.
 */
export function uniqueId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  let counter = 2
  while (taken.has(`${base}-${counter}`)) counter += 1
  return `${base}-${counter}`
}