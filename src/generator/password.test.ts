import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GENERATOR_OPTIONS,
  checkOptions,
  estimateStrength,
  generatePassword,
  optionsForPasswordType,
  type GeneratorOptions,
} from '@/generator/password'

function options(overrides: Partial<GeneratorOptions> = {}): GeneratorOptions {
  return { ...DEFAULT_GENERATOR_OPTIONS, ...overrides }
}

describe('generatePassword', () => {
  it('defaults to 16 characters', () => {
    expect(DEFAULT_GENERATOR_OPTIONS.length).toBe(16)
  })

  it('produces the requested length', () => {
    expect(generatePassword(options({ length: 32 }))).toHaveLength(32)
  })

  it('honours the minimum length bound', () => {
    expect(generatePassword(options({ length: 8 }))).toHaveLength(8)
  })

  it('includes a character from every enabled set', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = generatePassword(options({ length: 12 }))
      expect(result).toMatch(/[a-z]/)
      expect(result).toMatch(/[A-Z]/)
      expect(result).toMatch(/[0-9]/)
      expect(result).toMatch(/[^a-zA-Z0-9]/)
    }
  })

  it('excludes unselected character classes', () => {
    const result = generatePassword(
      options({ length: 40, lowercase: true, uppercase: false, digits: false, symbols: false }),
    )

    expect(result).toMatch(/^[a-z]+$/)
  })

  it('excludes ambiguous characters when asked', () => {
    const result = generatePassword(options({ length: 200, excludeAmbiguous: true }))

    for (const char of ['l', 'I', '1', 'O', '0', '|']) {
      expect(result).not.toContain(char)
    }
  })

  it('shuffles, so required characters are not always first', () => {
    // If the guaranteed character were left in place, the first position would
    // be predictable and the password measurably weaker.
    const firstChars = new Set<string>()
    for (let attempt = 0; attempt < 40; attempt += 1) {
      firstChars.add(generatePassword(options({ length: 8 }))[0]!)
    }
    expect(firstChars.size).toBeGreaterThan(3)
  })

  it('does not repeat itself', () => {
    const results = new Set<string>()
    for (let attempt = 0; attempt < 100; attempt += 1) {
      results.add(generatePassword(options({ length: 24 })))
    }
    // A collision here would indicate a broken generator, not bad luck.
    expect(results.size).toBe(100)
  })

  it('refuses to generate when no character set is enabled', () => {
    expect(() =>
      generatePassword(
        options({
          lowercase: false,
          uppercase: false,
          digits: false,
          symbols: false,
        }),
      ),
    ).toThrow()
  })

  it('refuses a length too short to cover every set', () => {
    expect(() => generatePassword(options({ length: 2, requireEachSet: true }))).toThrow()
  })

  it('allows a short length when coverage is not required', () => {
    expect(generatePassword(options({ length: 4, requireEachSet: false }))).toHaveLength(4)
  })

  it('supports lengths above the slider limit when configured directly', () => {
    expect(generatePassword(options({ length: 80 }))).toHaveLength(80)
  })
})

describe('checkOptions', () => {
  it('reports the minimum viable length', () => {
    const result = checkOptions(options({ length: 3, requireEachSet: true }))
    expect(result.error).toBe('length-too-short')
    expect(result.minimumLength).toBe(4)
  })

  it('requires a whole-number length', () => {
    expect(checkOptions(options({ length: 4.5 })).error).toBe('invalid-length')
  })

  it('reports an empty character pool', () => {
    const result = checkOptions(
      options({ lowercase: false, uppercase: false, digits: false, symbols: false }),
    )
    expect(result.error).toBe('no-character-sets')
  })

  it('accepts valid options', () => {
    expect(checkOptions(options()).error).toBeNull()
  })
})

describe('optionsForPasswordType', () => {
  it('selects letters and numbers without symbols', () => {
    expect(optionsForPasswordType(options(), 'letters-and-numbers')).toMatchObject({
      lowercase: true,
      uppercase: true,
      digits: true,
      symbols: false,
    })
  })

  it('selects letters only', () => {
    expect(optionsForPasswordType(options(), 'letters-only')).toMatchObject({
      lowercase: true,
      uppercase: true,
      digits: false,
      symbols: false,
    })
  })

  it('selects numbers only', () => {
    expect(optionsForPasswordType(options(), 'numbers-only')).toMatchObject({
      lowercase: false,
      uppercase: false,
      digits: true,
      symbols: false,
    })
  })

  it('selects all character sets for random passwords', () => {
    expect(optionsForPasswordType(options(), 'random')).toMatchObject({
      lowercase: true,
      uppercase: true,
      digits: true,
      symbols: true,
    })
  })

  it('preserves length and advanced options', () => {
    expect(optionsForPasswordType(options({ length: 32, excludeAmbiguous: true }), 'letters-only'))
      .toMatchObject({ length: 32, excludeAmbiguous: true })
  })
})

describe('estimateStrength', () => {
  it('scores an empty password as the minimum', () => {
    expect(estimateStrength('').score).toBe(0)
  })

  it('scores a long random password highly', () => {
    expect(estimateStrength('Xk9#pQ2!vLm7$Rt4@Zw8&Ns3^Hg6*Jd1%').score).toBeGreaterThanOrEqual(3)
  })

  it('scores a short weak password low', () => {
    expect(estimateStrength('abc').score).toBeLessThanOrEqual(1)
  })

  it('penalises repetition', () => {
    const repeated = estimateStrength('a'.repeat(20))
    const varied = estimateStrength('abcdefghijklmnopqrst')
    expect(repeated.warnings).toContain('Heavy character repetition')
    expect(repeated.score).toBeLessThan(varied.score)
  })

  it('warns about a common sequence', () => {
    expect(estimateStrength('passwordpassword').warnings.length).toBeGreaterThan(0)
  })
})
