import { describe, expect, it } from 'vitest'
import { formatCardExpiryInput, isValidCardExpiry, parseCardExpiryDate } from '@/storage/cardExpiry'

describe('card expiry values', () => {
  it('formats typed digits as MM/YY', () => {
    expect(formatCardExpiryInput('0428')).toBe('04/28')
    expect(formatCardExpiryInput('04/28')).toBe('04/28')
    expect(formatCardExpiryInput('4')).toBe('4')
  })

  it('validates a two-digit month and year', () => {
    expect(isValidCardExpiry('04/28')).toBe(true)
    expect(isValidCardExpiry('00/28')).toBe(false)
    expect(isValidCardExpiry('13/28')).toBe(false)
    expect(isValidCardExpiry('4/28')).toBe(false)
  })

  it('parses MM/YY through the end of that month', () => {
    expect(parseCardExpiryDate('04/28')?.toISOString()).toBe('2028-04-30T23:59:59.999Z')
    expect(parseCardExpiryDate('13/28')).toBeNull()
  })
})
