import { describe, expect, it } from 'vitest'
import { formatExpiryDateInput, isValidExpiryDate, parseExpiryDateValue } from '@/storage/dateExpiry'

describe('expiry date values', () => {
  it('formats typed digits as DD/MM/YYYY', () => {
    expect(formatExpiryDateInput('31122028')).toBe('31/12/2028')
    expect(formatExpiryDateInput('31/12/2028')).toBe('31/12/2028')
    expect(formatExpiryDateInput('31')).toBe('31')
  })

  it('requires an exact, valid DD/MM/YYYY calendar date', () => {
    expect(isValidExpiryDate('31/12/2028')).toBe(true)
    expect(isValidExpiryDate('31/02/2028')).toBe(false)
    expect(isValidExpiryDate('12/31/2028')).toBe(false)
    expect(isValidExpiryDate('1/2/2028')).toBe(false)
  })

  it('parses through the end of the expiry day', () => {
    expect(parseExpiryDateValue('31/12/2028')?.toISOString()).toBe('2028-12-31T23:59:59.999Z')
    expect(parseExpiryDateValue('31/02/2028')).toBeNull()
  })
})
