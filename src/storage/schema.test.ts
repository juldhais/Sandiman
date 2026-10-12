import { describe, expect, it } from 'vitest'
import { githubSyncConfigSchema, itemSchema, storedSyncSettingsSchema } from '@/storage/schema'

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

describe('GitHub sync configuration', () => {
  it('keeps repository and PAT settings while dropping unknown fields', () => {
    const config = githubSyncConfigSchema.parse({
      owner: 'example-owner',
      repo: 'vault',
      branch: 'main',
      path: 'private/vault.json',
      token: 'github_pat_test-secret',
      email: 'user@example.com',
      autoSync: true,
      autoSyncMinutes: 10,
    })

    expect(config.owner).toBe('example-owner')
    expect(config.repo).toBe('vault')
    expect(config.path).toBe('private/vault.json')
    expect(config.token).toBe('github_pat_test-secret')
    expect('email' in config).toBe(false)
    expect(config.autoSync).toBe(true)

    const stored = storedSyncSettingsSchema.parse({ config, password: 'legacy-sync-password' })
    expect('password' in stored).toBe(false)
  })
})
