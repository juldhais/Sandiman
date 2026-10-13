/** Formatting and parsing helpers for full-date expiry values (DD/MM/YYYY). */

/** Adds separators while typing or pasting, preserving the day/month/year order. */
export function formatExpiryDateInput(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8)
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return digits
}

export function isValidExpiryDate(value: string): boolean {
  return parseExpiryDateValue(value) !== null
}

/** Returns the end of the stated UTC day, or null for invalid/non-exact input. */
export function parseExpiryDateValue(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(0)
  date.setUTCHours(23, 59, 59, 999)
  date.setUTCFullYear(year, month - 1, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date
}
