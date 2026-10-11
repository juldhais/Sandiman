/** Formatting and parsing helpers for credit card expiration values (MM/YY). */

/** Adds the slash while the user types, keeping only the four date digits. */
export function formatCardExpiryInput(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

/** Whether a value is a complete, valid MM/YY expiration. */
export function isValidCardExpiry(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(value.trim())
  if (!match) return false
  const month = Number(match[1])
  return month >= 1 && month <= 12
}

/** Returns the last instant of the card's expiration month, or null if invalid. */
export function parseCardExpiryDate(value: string): Date | null {
  if (!isValidCardExpiry(value)) return null
  const [monthText, yearText] = value.trim().split('/')
  const month = Number(monthText)
  const year = 2000 + Number(yearText)
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
}
