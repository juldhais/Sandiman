/**
 * Unbiased random values drawn from the Web Crypto CSPRNG.
 *
 * All helpers here reject rather than reduce, so every value in the output
 * range is equally likely. `value % length` would quietly favour the first
 * `256 % length` entries of a character set, which is a real (if small) bias
 * in exactly the code path that produces passwords.
 */

/** Number of bytes per CSPRNG refill. */
const REFILL = 65536

let pool = new Uint8Array(0)
let poolOffset = 0

function refill(): void {
  const fresh = new Uint8Array(REFILL)
  crypto.getRandomValues(fresh)
  pool = fresh
  poolOffset = 0
}

/**
 * Returns a uniformly distributed integer in [0, max).
 *
 * Draws from a byte pool and rejects anything in the ragged tail of the
 * 256-multiple so the result stays uniform.
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError(`randomInt requires a positive integer, received ${max}`)
  }
  if (max === 1) return 0

  // Bytes at or above this bound would make the range uneven, so they are
  // discarded and redrawn rather than folded in.
  const limit = Math.floor(256 / max) * max

  for (;;) {
    if (poolOffset >= pool.length) refill()
    const byte = pool[poolOffset++]
    if (byte < limit) return byte % max
  }
}

/** Returns a uniformly distributed integer in [min, max], inclusive. */
export function randomRange(min: number, max: number): number {
  if (max < min) throw new RangeError(`randomRange: max (${max}) < min (${min})`)
  return min + randomInt(max - min + 1)
}

/** Returns `length` cryptographically random bytes. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`randomBytes requires a non-negative integer, received ${length}`)
  }
  return crypto.getRandomValues(new Uint8Array(length))
}

/** Picks one element uniformly at random. */
export function randomChoice<T>(items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('randomChoice: empty collection')
  return items[randomInt(items.length)]!
}

/**
 * Draws `count` entries from `items` without replacement (partial Fisher-Yates).
 */
export function randomSample<T>(items: readonly T[], count: number): T[] {
  const size = Math.min(count, items.length)
  const poolCopy = items.slice()
  const picked: T[] = []

  for (let i = 0; i < size; i += 1) {
    const j = i + randomInt(poolCopy.length - i)
    const swap = poolCopy[i]!
    poolCopy[i] = poolCopy[j]!
    poolCopy[j] = swap
    picked.push(poolCopy[i]!)
  }
  return picked
}

/** Fisher-Yates shuffle driven by the CSPRNG. Returns a new array. */
export function randomShuffle<T>(items: readonly T[]): T[] {
  return randomSample(items, items.length)
}