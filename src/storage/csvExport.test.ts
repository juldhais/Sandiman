import { describe, expect, it } from 'vitest'
import { createBuiltinTemplates } from '@/storage/builtins'
import { exportVaultCsv } from '@/storage/csvExport'
import type { VaultItem } from '@/storage/types'

function item(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: 'item-1',
    templateId: 'builtin-login',
    title: 'Example, Inc.',
    values: { username: 'alice', password: 'say "hello"', url: 'https://example.com' },
    customFields: [
      {
        id: 'account-id',
        label: 'Account ID',
        type: 'text',
        required: false,
        copyable: false,
        expiry: false,
        value: '123',
      },
    ],
    tags: ['work', 'important'],
    notes: 'line one\nline two',
    createdAt: 1,
    updatedAt: 1,
    deleted: false,
    ...overrides,
  }
}

describe('exportVaultCsv', () => {
  it('exports built-in and custom fields with CSV escaping', () => {
    const csv = exportVaultCsv([item()], createBuiltinTemplates())

    expect(csv.startsWith('\uFEFF"Title","Template","Tags","Notes"')).toBe(true)
    expect(csv).toContain('"Username","Password","Website URL","Account ID"')
    expect(csv).toContain('"Example, Inc.","Login","work; important","line one\nline two"')
    expect(csv).toContain('"alice","say ""hello""","https://example.com","123"')
  })

  it('keeps same-named fields from different templates in separate columns', () => {
    const templates = createBuiltinTemplates()
    const login = item()
    const database: VaultItem = {
      ...item({
        id: 'item-2',
        templateId: 'builtin-database',
        title: 'Database',
        values: { username: 'db-alice' },
        customFields: [],
        tags: [],
        notes: '',
      }),
    }

    const csv = exportVaultCsv([login, database], templates)
    expect(csv).toContain('"Username"')
    expect(csv).toContain('"Database - Username"')
    expect(csv).toContain('"db-alice"')
  })

  it('exports a header row even when the vault has no active items', () => {
    expect(exportVaultCsv([], [])).toBe('\uFEFF"Title","Template","Tags","Notes"')
  })
})
