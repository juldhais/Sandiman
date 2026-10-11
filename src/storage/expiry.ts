/**
 * Expiry calculation.
 *
 * Date fields are stored as free text so users can type what their document
 * actually shows ("12/28", "2028-04"). Parsing therefore accepts several
 * formats and reports `unparseable` rather than guessing, so an ambiguous value
 * never silently becomes "not expiring".
 */
import { expiryFields, type ResolvedField } from '@/storage/templateEngine'
import type { VaultItem, VaultTemplate } from '@/storage/types'
import { parseCardExpiryDate } from '@/storage/cardExpiry'

export type ExpiryStatus = 'expired' | 'critical' | 'warning' | 'ok' | 'unparseable'

export interface ExpiryEntry {
  itemId: string
  itemTitle: string
  fieldId: string
  fieldLabel: string
  /** Raw text as stored. */
  raw: string
  /** Parsed expiry instant, or null when unparseable. */
  expiresAt: Date | null
  /** Whole days until expiry; negative once past. Null when unparseable. */
  daysRemaining: number | null
  status: ExpiryStatus
}

export interface ExpirySummary {
  entries: ExpiryEntry[]
  expired: number
  critical: number
  warning: number
  ok: number
  unparseable: number
  /** Entries needing attention within the configured window. */
  needingAttention: ExpiryEntry[]
}

const MS_PER_DAY = 86_400_000

/**
 * Parses a stored date value into an instant.
 *
 * Returns null rather than an invalid Date so callers must handle ambiguity.
 * A bare month/year is treated as the *end* of that month: an "expiration"
 * of 04/2028 is still usable through April, not expired on 1 April.
 */
export function parseExpiryDate(raw: string): Date | null {
  const value = raw.trim()
  if (!value) return null

  // ISO: YYYY-MM-DD or YYYY-MM
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(value)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    if (!iso[3]) {
      // Last instant of the month.
      return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
    }
    return makeUtc(year, month, Number(iso[3]))
  }

  // Slash or dot separated. Formats seen in the wild include MM/YYYY (the
  // common card expiry), MM/DD, MM/DD/YYYY, MM/DD/YY, and DD/MM/YYYY.
  const slash = /^(\d{1,2})[/.](\d{1,4})(?:[/.](\d{1,4}))?$/.exec(value)
  if (slash) {
    const first = Number(slash[1])
    const second = Number(slash[2])
    const third = slash[3]

    // Two parts where the second is a plausible year: MM/YYYY.
    if (!third && second > 31) {
      return makeUtc(second, first, lastDayOfMonth(second, first))
    }

    const expandYear = (raw: number): number =>
      raw < 100 ? 2000 + raw : raw

    // Three parts: the third is the year.
    if (third !== undefined) {
      const year = expandYear(Number(third))
      // Disambiguate only when the first part cannot be a month.
      return first > 12 ? makeUtc(year, second, first) : makeUtc(year, first, second)
    }

    // Two parts with a small second number: MM/DD, defaulting to this year.
    return makeUtc(new Date().getUTCFullYear(), first, second)
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed)
}

/** Last day of a month, used when only the month and year are known. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function makeUtc(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
  // Rejects overflow like 31 February, which Date would roll forward silently.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

/**
 * Classifies an expiry against a warning window.
 *
 * The tiers are fixed fractions of the window so the sidebar badges read the
 * same regardless of whether the user chose 30 or 90 days.
 */
export function classifyExpiry(daysRemaining: number, warningDays: number): ExpiryStatus {
  if (daysRemaining < 0) return 'expired'
  const critical = Math.max(1, Math.round(warningDays * 0.25))
  if (daysRemaining <= critical) return 'critical'
  if (daysRemaining <= warningDays) return 'warning'
  return 'ok'
}

/** Whole days from `now` until `expiresAt`, rounded up so partial days count. */
export function daysUntil(expiresAt: Date, now: number = Date.now()): number {
  return Math.ceil((expiresAt.getTime() - now) / MS_PER_DAY)
}

function toEntry(
  item: VaultItem,
  field: ResolvedField,
  warningDays: number,
  now: number,
): ExpiryEntry {
  const expiresAt =
    field.def.type === 'cardExpiry'
      ? parseCardExpiryDate(field.value)
      : parseExpiryDate(field.value)
  const daysRemaining = expiresAt ? daysUntil(expiresAt, now) : null

  return {
    itemId: item.id,
    itemTitle: item.title || 'Untitled',
    fieldId: field.id,
    fieldLabel: field.def.label,
    raw: field.value,
    expiresAt,
    daysRemaining,
    status: daysRemaining === null ? 'unparseable' : classifyExpiry(daysRemaining, warningDays),
  }
}

/**
 * Collects every dated expiry across the vault.
 *
 * Soft-deleted items are skipped: they are tombstones awaiting propagation to
 * other devices, not entries the user should be prompted about.
 */
export function collectExpiries(
  items: readonly VaultItem[],
  templates: readonly VaultTemplate[],
  warningDays: number,
  now: number = Date.now(),
): ExpirySummary {
  const templateById = new Map(templates.map((template) => [template.id, template]))
  const entries: ExpiryEntry[] = []

  for (const item of items) {
    if (item.deleted) continue
    const template = item.templateId ? (templateById.get(item.templateId) ?? null) : null
    for (const field of expiryFields(item, template)) {
      entries.push(toEntry(item, field, warningDays, now))
    }
  }

  entries.sort((a, b) => {
    if (a.daysRemaining === null) return 1
    if (b.daysRemaining === null) return -1
    return a.daysRemaining - b.daysRemaining
  })

  const count = (status: ExpiryStatus) =>
    entries.filter((entry) => entry.status === status).length

  return {
    entries,
    expired: count('expired'),
    critical: count('critical'),
    warning: count('warning'),
    ok: count('ok'),
    unparseable: count('unparseable'),
    needingAttention: entries.filter(
      (entry) => entry.status === 'expired' || entry.status === 'critical' || entry.status === 'warning',
    ),
  }
}

/** Compact status label for badges, e.g. "12d", "Expired", "3mo". */
export function formatExpiryBadge(entry: ExpiryEntry): string {
  if (entry.daysRemaining === null) return '?'
  if (entry.daysRemaining < 0) return 'Expired'
  if (entry.daysRemaining === 0) return 'Today'
  if (entry.daysRemaining < 60) return `${entry.daysRemaining}d`
  const months = Math.round(entry.daysRemaining / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(entry.daysRemaining / 365)}y`
}
