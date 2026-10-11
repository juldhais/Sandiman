import { describe, expect, it } from 'vitest'
import {
  classifyExpiry,
  collectExpiries,
  daysUntil,
  formatExpiryBadge,
  parseExpiryDate,
} from '@/storage/expiry'
import { createBuiltinTemplates } from '@/storage/builtins'
import type { VaultItem } from '@/storage/types'

const NOW = Date.UTC(2026, 0, 15) // 15 Jan 2026

function login(values: Record<string, string>, updatedAt = NOW): VaultItem {
  return {
    id: 'item-1',
    templateId: 'builtin-login',
    title: 'Example',
    values,
    customFields: [],
    tags: [],
    notes: '',
    createdAt: 0,
    updatedAt,
    deleted: false,
  }
}

describe('parseExpiryDate', () => {
  it('parses an ISO date', () => {
    const parsed = parseExpiryDate('2026-06-01')
    expect(parsed?.toISOString().slice(0, 10)).toBe('2026-06-01')
  })

  it('treats a bare year-month as the end of that month', () => {
    // A card with expiry 04/2028 is usable through April, not expired on 1 April.
    const parsed = parseExpiryDate('2028-04')
    expect(parsed?.getUTCMonth()).toBe(3)
    expect(parsed?.getUTCDate()).toBe(30)
  })

  it('parses MM/YYYY', () => {
    const parsed = parseExpiryDate('04/2028')
    expect(parsed?.toISOString().slice(0, 7)).toBe('2028-04')
  })

  it('parses MM/DD/YYYY', () => {
    const parsed = parseExpiryDate('04/28/2028')
    expect(parsed?.toISOString().slice(0, 10)).toBe('2028-04-28')
  })

  it('parses DD/MM/YYYY when the first part cannot be a month', () => {
    const parsed = parseExpiryDate('28/04/2028')
    expect(parsed?.toISOString().slice(0, 10)).toBe('2028-04-28')
  })

  it('rejects impossible dates instead of rolling them forward', () => {
    // Date would silently turn 31 February into 2 March.
    expect(parseExpiryDate('2028-02-31')).toBeNull()
  })

  it('returns null for unparseable input rather than guessing', () => {
    expect(parseExpiryDate('sometime next spring')).toBeNull()
    expect(parseExpiryDate('')).toBeNull()
  })
})

describe('classifyExpiry', () => {
  it('flags past dates as expired', () => {
    expect(classifyExpiry(-1, 30)).toBe('expired')
  })

  it('escalates as the window approaches', () => {
    expect(classifyExpiry(5, 30)).toBe('critical')
    expect(classifyExpiry(20, 30)).toBe('warning')
    expect(classifyExpiry(120, 30)).toBe('ok')
  })
})

describe('daysUntil', () => {
  it('rounds partial days up so today is not zero-hours', () => {
    expect(daysUntil(new Date(NOW + 1000), NOW)).toBe(1)
  })

  it('is negative once past', () => {
    expect(daysUntil(new Date(NOW - 86_400_000), NOW)).toBe(-1)
  })
})

describe('collectExpiries', () => {
  const templates = createBuiltinTemplates(NOW)

  it('finds expiry fields from the template', () => {
    const summary = collectExpiries(
      [login({ username: 'a' })],
      templates,
      30,
      NOW,
    )
    // Login has no expiry field, so nothing should be tracked.
    expect(summary.entries).toHaveLength(0)
  })

  it('finds a credit card expiry', () => {
    const card: VaultItem = { ...login({}), templateId: 'builtin-credit-card', values: { expiryDate: '2026-02-01' } }
    const summary = collectExpiries([card], templates, 30, NOW)

    expect(summary.entries).toHaveLength(1)
    expect(summary.entries[0]!.fieldLabel).toBe('Expiration Date')
    expect(summary.warning + summary.critical).toBeGreaterThan(0)
  })

  it('ignores deleted items', () => {
    const card: VaultItem = {
      ...login({}),
      templateId: 'builtin-credit-card',
      values: { expiryDate: '2026-02-01' },
      deleted: true,
    }

    expect(collectExpiries([card], templates, 30, NOW).entries).toHaveLength(0)
  })

  it('surfaces an unrecognised date rather than hiding it', () => {
    const card: VaultItem = {
      ...login({}),
      templateId: 'builtin-credit-card',
      values: { expiryDate: 'whenever' },
    }

    const summary = collectExpiries([card], templates, 30, NOW)

    expect(summary.entries[0]!.status).toBe('unparseable')
    expect(summary.unparseable).toBe(1)
  })

  it('sorts the most urgent first', () => {
    const soon: VaultItem = {
      ...login({}),
      id: 'soon',
      templateId: 'builtin-credit-card',
      values: { expiryDate: '2026-01-20' },
    }
    const later: VaultItem = {
      ...login({}),
      id: 'later',
      templateId: 'builtin-credit-card',
      values: { expiryDate: '2027-01-20' },
    }

    const summary = collectExpiries([later, soon], templates, 30, NOW)

    expect(summary.entries[0]!.itemId).toBe('soon')
  })
})

describe('formatExpiryBadge', () => {
  it('labels an expired entry', () => {
    expect(
      formatExpiryBadge({
        itemId: 'a',
        itemTitle: 'a',
        fieldId: 'f',
        fieldLabel: 'Expires',
        raw: '2020-01-01',
        expiresAt: new Date(0),
        daysRemaining: -10,
        status: 'expired',
      }),
    ).toBe('Expired')
  })

  it('abbreviates distant dates', () => {
    expect(
      formatExpiryBadge({
        itemId: 'a',
        itemTitle: 'a',
        fieldId: 'f',
        fieldLabel: 'Expires',
        raw: '2030-01-01',
        expiresAt: new Date(0),
        daysRemaining: 365,
        status: 'ok',
      }),
    ).toBe('1y')
  })
})