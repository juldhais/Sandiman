import { describe, expect, it } from 'vitest'
import { azureSyncConfigSchema, itemSchema, storedSyncSettingsSchema } from '@/storage/schema'

const baseItem = {
  id: 'item-1',
  templateId: 'builtin-login',
  title: 'Example',
  values: { username: 'alice' },
  customFields: [],
  tags: [],
  notes: '',
  createdAt: 0,
  updatedAt: 0,
  deleted: false,
}

describe('item schema field preferences', () => {
  it('requires every item to have a static title', () => {
    expect(itemSchema.parse({ ...baseItem, title: '' }).title).toBe('Untitled')
    expect(itemSchema.parse(baseItem).title).toBe('Example')
  })

  it('keeps per-item ordering when parsing', () => {
    const item = itemSchema.parse({
      ...baseItem,
      fieldOrder: ['password', 'username'],
    })

    expect(item.fieldOrder).toEqual(['password', 'username'])
    expect(item.values.username).toBe('alice')
  })

  it('accepts items written before per-item field preferences existed', () => {
    const item = itemSchema.parse(baseItem)
    expect(item.values.username).toBe('alice')
    expect(item.fieldOrder).toBeUndefined()
  })
})

describe('Azure sync configuration', () => {
  it('keeps the SAS URL and storage location while dropping unknown credentials', () => {
    const config = azureSyncConfigSchema.parse({
      sasUrl: 'https://account.blob.core.windows.net/?sv=2021-12-02&sig=secret',
      containerName: 'custom-container',
      blobName: 'custom-vault.json',
      email: 'user@example.com',
      autoSync: true,
      autoSyncMinutes: 10,
    })

    expect(config.sasUrl).toContain('sig=secret')
    expect(config.containerName).toBe('custom-container')
    expect(config.blobName).toBe('custom-vault.json')
    expect('email' in config).toBe(false)
    expect(config.autoSync).toBe(true)

    const stored = storedSyncSettingsSchema.parse({ config, password: 'legacy-sync-password' })
    expect('password' in stored).toBe(false)
  })
})
