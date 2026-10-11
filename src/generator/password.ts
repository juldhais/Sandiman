/**
 * Password generator.
 *
 * Character selection goes through `randomInt`, which rejects rather than
 * reduces, so every character in the selected sets is equally likely. Also
 * worth noting: the shuffle is not cosmetic. Placing the first character into
 * the guaranteed-character prefix would leak it to anyone who could observe
 * which positions were constrained.
 */
import { randomInt, randomShuffle } from '@/crypto/secureRandom'

export interface CharacterSets {
  lowercase: string
  uppercase: string
  digits: string
  symbols: string
}

export const CHARACTER_SETS: CharacterSets = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/|~',
}

/** Glyphs that are easy to confuse when read off a screen. */
export const AMBIGUOUS_CHARACTERS = 'Il1O0o|`\'";:,.{}[]()/\\'

export interface GeneratorOptions {
  length: number
  lowercase: boolean
  uppercase: boolean
  digits: boolean
  symbols: boolean
  /** Excludes visually ambiguous characters from every set. */
  excludeAmbiguous: boolean
  /** Guarantees at least one character from every enabled set. */
  requireEachSet: boolean
}

export type PasswordType = 'letters-and-numbers' | 'letters-only' | 'numbers-only' | 'random'

type CharacterSelection = Pick<
  GeneratorOptions,
  'lowercase' | 'uppercase' | 'digits' | 'symbols'
>

const PASSWORD_TYPE_SETS: Record<PasswordType, CharacterSelection> = {
  'letters-and-numbers': {
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: false,
  },
  'letters-only': {
    lowercase: true,
    uppercase: true,
    digits: false,
    symbols: false,
  },
  'numbers-only': {
    lowercase: false,
    uppercase: false,
    digits: true,
    symbols: false,
  },
  random: {
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
  },
}

/** Applies one of the generator's common character-set presets. */
export function optionsForPasswordType(
  options: GeneratorOptions,
  type: PasswordType,
): GeneratorOptions {
  return { ...options, ...PASSWORD_TYPE_SETS[type] }
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 16,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  requireEachSet: true,
}

export const MIN_LENGTH = 4
/** The slider stops at 64; longer lengths can be typed in the generator. */
export const MAX_SLIDER_LENGTH = 64

/** Why a configuration cannot produce a password. */
export type GeneratorError = 'no-character-sets' | 'length-too-short' | 'invalid-length' | null

export interface GeneratorCheck {
  error: GeneratorError
  /** Shortest length that would satisfy `requireEachSet` with these sets. */
  minimumLength: number
}

export function checkOptions(options: GeneratorOptions): GeneratorCheck {
  const pool = buildPool(options)
  if (pool.length === 0) {
    return { error: 'no-character-sets', minimumLength: 0 }
  }
  const enabledSets = enabledSetCount(options)
  const minimumLength = Math.max(MIN_LENGTH, options.requireEachSet ? enabledSets : 1)
  if (!Number.isInteger(options.length)) {
    return { error: 'invalid-length', minimumLength }
  }
  if (options.length < minimumLength) {
    return { error: 'length-too-short', minimumLength }
  }
  return { error: null, minimumLength }
}

function stripAmbiguous(value: string, exclude: boolean): string {
  if (!exclude) return value
  const banned = new Set(AMBIGUOUS_CHARACTERS)
  return Array.from(value)
    .filter((char) => !banned.has(char))
    .join('')
}

interface SetSpec {
  key: keyof Pick<GeneratorOptions, 'lowercase' | 'uppercase' | 'digits' | 'symbols'>
  chars: string
}

function specs(options: GeneratorOptions): SetSpec[] {
  const all: SetSpec[] = [
    { key: 'lowercase', chars: CHARACTER_SETS.lowercase },
    { key: 'uppercase', chars: CHARACTER_SETS.uppercase },
    { key: 'digits', chars: CHARACTER_SETS.digits },
    { key: 'symbols', chars: CHARACTER_SETS.symbols },
  ]
  return all
    .filter((spec) => options[spec.key])
    .map((spec) => ({ ...spec, chars: stripAmbiguous(spec.chars, options.excludeAmbiguous) }))
    .filter((spec) => spec.chars.length > 0)
}

function enabledSetCount(options: GeneratorOptions): number {
  return specs(options).length
}

function buildPool(options: GeneratorOptions): string {
  return specs(options)
    .map((spec) => spec.chars)
    .join('')
}

/**
 * Generates a password.
 *
 * @throws {Error} when the options cannot fill the requested length, which the
 * UI guards against via `checkOptions`.
 */
export function generatePassword(options: GeneratorOptions): string {
  const { error, minimumLength } = checkOptions(options)
  if (error === 'no-character-sets') {
    throw new Error('Enable at least one character set')
  }
  if (error === 'length-too-short') {
    throw new Error(`Length must be at least ${minimumLength} to include every character set`)
  }
  if (error === 'invalid-length') {
    throw new Error('Length must be a whole number')
  }

  const activeSpecs = specs(options)
  const pool = activeSpecs.map((spec) => spec.chars).join('')
  const length = options.length

  const chars: string[] = []

  if (options.requireEachSet) {
    // One character drawn from each enabled set, so the result always spans
    // every requested class of symbol.
    for (const spec of activeSpecs) {
      chars.push(spec.chars[randomInt(spec.chars.length)]!)
    }
  }

  while (chars.length < length) {
    chars.push(pool[randomInt(pool.length)]!)
  }

  return randomShuffle(chars).join('')
}

export interface StrengthResult {
  /** 0-4, suitable for a progress indicator. */
  score: number
  label: string
  /** Rough seconds to exhaust a 10^11/s offline attack. */
  estimatedCrackSeconds: number
  warnings: string[]
}

/**
 * Estimates offline cracking cost for a candidate password.
 *
 * This is an entropy estimate, not a breach lookup: it scores character-set
 * entropy against a length and penalises recognisable structure. It exists to
 * give the onboarding screen feedback, so a clear approximation is better than
 * a false sense of precision.
 */
export function estimateStrength(password: string): StrengthResult {
  const warnings: string[] = []
  const length = password.length

  if (length === 0) {
    return { score: 0, label: 'Empty', estimatedCrackSeconds: 0, warnings: ['Enter a password'] }
  }

  let poolSize = 0
  if (/[a-z]/.test(password)) poolSize += 26
  if (/[A-Z]/.test(password)) poolSize += 26
  if (/[0-9]/.test(password)) poolSize += 10
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 33

  // Structural penalties: runs, repeats, and sequential stretches all reduce
  // the entropy actually carried by the string.
  const uniqueRatio = new Set(password).size / length
  if (uniqueRatio < 0.4) warnings.push('Heavy character repetition')
  if (/(.)\1{2,}/.test(password)) warnings.push('Contains repeated characters')
  if (/(?:abc|qwe|asd|123|xyz|password|letmein|admin)/i.test(password)) {
    warnings.push('Contains a common sequence')
  }
  if (/^\d+$/.test(password)) warnings.push('Digits only')
  if (length < MIN_LENGTH) warnings.push(`Use at least ${MIN_LENGTH} characters`)

  const baseEntropy = poolSize > 0 ? length * Math.log2(poolSize) : 0
  const repetitionPenalty = uniqueRatio < 0.4 ? 0.6 : 1
  const entropyBits = baseEntropy * repetitionPenalty

  // 10^11 guesses/second: a well-funded offline attack on a fast hash.
  const estimatedCrackSeconds = poolSize > 0 ? 2 ** (entropyBits - 1) / 1e11 : 0

  let score: number
  if (entropyBits < 40) score = 0
  else if (entropyBits < 60) score = 1
  else if (entropyBits < 80) score = 2
  else if (entropyBits < 100) score = 3
  else score = 4

  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent']

  return {
    score,
    label: labels[score]!,
    estimatedCrackSeconds,
    warnings,
  }
}
