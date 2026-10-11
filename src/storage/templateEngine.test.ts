import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  buildFieldSchema,
  collectValues,
  createItem,
  removeItemFields,
  resolveFields,
  suggestTitle,
} from '@/storage/templateEngine'
import { createBuiltinTemplates, isBuiltinTemplateId } from '@/storage/builtins'
import type { FieldDef, VaultItem, VaultTemplate } from '@/storage/types'

const templates = createBuiltinTemplates(0)
const loginTemplate = templates.find((t) => t.id === 'builtin-login')!

function loginItem(values: Record<string, string> = {}): VaultItem {
  return {
    id: 'i1',
    templateId: loginTemplate.id,
    title: 'Example',
    values,
    customFields: [],
    tags: [],
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    deleted: false,
  }
}

function field(overrides: Partial<FieldDef> & { id: string }): FieldDef {
  return {
    label: overrides.id,
    type: 'text',
    required: false,
    copyable: false,
    expiry: false,
    ...overrides,
  }
}

describe('resolveFields', () => {
  it('follows template field order', () => {
    const resolved = resolveFields(loginItem(), loginTemplate)
    expect(resolved.map((f) => f.id)).toEqual(loginTemplate.fields.map((f) => f.id))
  })

  it('applies per-item field order', () => {
    const item: VaultItem = {
      ...loginItem({ username: 'alice', password: 'secret' }),
      fieldOrder: ['password', 'username'],
    }

    const visible = resolveFields(item, loginTemplate)
    expect(visible.map((field) => field.id)).toEqual([
      'password',
      'username',
      ...loginTemplate.fields.map((field) => field.id).filter((id) => id !== 'password' && id !== 'username'),
    ])
  })

  it('permanently removes explicitly removed field values and custom fields', () => {
    const item: VaultItem = {
      ...loginItem({ username: 'alice', password: 'secret', url: 'https://example.test' }),
      fieldOrder: ['password', 'username', 'url'],
      customFields: [
        {
          id: 'custom-note',
          label: 'Private note',
          type: 'text',
          required: false,
          copyable: false,
          expiry: false,
          value: 'remove me',
        },
      ],
    }

    const result = removeItemFields(item, ['password', 'custom-note'])

    expect(result.values).toEqual({ username: 'alice', url: 'https://example.test' })
    expect(result.customFields).toEqual([])
    expect(result.fieldOrder).toEqual(['username', 'url'])
    expect(result.title).toBe('Example')
  })

  it('surfaces values whose field was removed from the template', () => {
    // Removing a field from a template must not destroy the data behind it.
    const item = loginItem({ username: 'alice', legacyNote: 'kept' })
    const trimmed: VaultTemplate = {
      ...loginTemplate,
      fields: loginTemplate.fields.filter((f) => f.id !== 'legacyNote'),
    }

    const resolved = resolveFields(item, trimmed)
    const orphan = resolved.find((f) => f.value === 'kept')

    expect(orphan).toBeDefined()
    expect(orphan!.orphaned).toBe(true)
  })

  it('appends ad-hoc custom fields after template fields', () => {
    const item: VaultItem = {
      ...loginItem(),
      customFields: [
        {
          id: 'custom-1',
          label: 'Recovery hint',
          type: 'text',
          required: false,
          copyable: true,
          expiry: false,
          value: 'a hint',
        },
      ],
    }

    const resolved = resolveFields(item, loginTemplate)

    expect(resolved.at(-1)!.custom).toBe(true)
    expect(resolved.at(-1)!.value).toBe('a hint')
  })

  it('renders every field when the template is gone', () => {
    const item = loginItem({ username: 'alice', password: 'secret' })
    const resolved = resolveFields(item, null)

    expect(resolved).toHaveLength(2)
    expect(resolved.every((f) => f.orphaned)).toBe(true)
  })
})

describe('buildFieldSchema', () => {
  it('requires non-blank values for required fields', () => {
    const schema = buildFieldSchema([
      field({ id: 'username', required: true }),
      field({ id: 'note' }),
    ])

    expect(schema.safeParse({ username: '', note: '' }).success).toBe(false)
    expect(schema.safeParse({ username: 'alice', note: '' }).success).toBe(true)
  })

  it('treats whitespace as blank', () => {
    const schema = buildFieldSchema([field({ id: 'username', required: true })])
    expect(schema.safeParse({ username: '   ' }).success).toBe(false)
  })

  it('validates card expirations in MM/YY format', () => {
    const schema = buildFieldSchema([field({ id: 'expiry', type: 'cardExpiry' })])
    expect(schema.safeParse({ expiry: '04/28' }).success).toBe(true)
    expect(schema.safeParse({ expiry: '' }).success).toBe(true)
    expect(schema.safeParse({ expiry: '13/28' }).success).toBe(false)
    expect(schema.safeParse({ expiry: '4/28' }).success).toBe(false)
  })

  it('produces a zod object that can parse', () => {
    const schema: z.ZodObject<Record<string, z.ZodType<string>>> = buildFieldSchema([
      field({ id: 'a' }),
    ])
    expect(schema.parse({ a: 'value' })).toEqual({ a: 'value' })
  })
})

describe('collectValues', () => {
  it('drops blank values so cleared fields are distinguishable', () => {
    const item = loginItem()
    const resolved = resolveFields(item, loginTemplate)

    const values = collectValues(resolved, { username: 'alice', password: '', url: '' })

    expect(values).toEqual({ username: 'alice' })
    expect('password' in values).toBe(false)
  })

  it('keeps values that were cleared, which become orphans', () => {
    const item = loginItem({ username: 'alice' })
    const resolved = resolveFields(item, loginTemplate)

    // The old value is dropped from the map, so the field simply becomes empty
    // rather than retaining a stale secret.
    const values = collectValues(resolved, { username: '' })
    expect(values.username).toBeUndefined()
  })
})

describe('suggestTitle', () => {
  it('prefers the username over other fields', () => {
    const resolved = resolveFields(loginItem({ url: 'https://x', username: 'alice' }), loginTemplate)
    expect(suggestTitle(resolved)).toBe('alice')
  })

  it('falls back to the first non-blank field', () => {
    const resolved = resolveFields(loginItem({ url: 'https://x' }), loginTemplate)
    expect(suggestTitle(resolved)).toBe('https://x')
  })

  it('falls back to a placeholder when everything is empty', () => {
    expect(suggestTitle(resolveFields(loginItem(), loginTemplate))).toBe('Untitled')
  })
})

describe('built-in templates', () => {
  it('keeps the Login template focused on website credentials', () => {
    expect(loginTemplate.fields.map((field) => field.id)).toEqual([
      'username',
      'password',
      'url',
    ])
  })

  it('seeds the four templates named in the spec', () => {
    const names = templates.map((t) => t.name)
    expect(names).toContain('Login')
    expect(names).toContain('Credit Card')
    expect(names).toContain('ID Card')
    expect(names).toContain('Secure Note')
  })

  it('marks seeds as built-in with stable ids', () => {
    expect(templates.every((t) => t.builtIn)).toBe(true)
    expect(isBuiltinTemplateId('builtin-login')).toBe(true)
    expect(isBuiltinTemplateId('some-custom-id')).toBe(false)
  })

  it('gives every seed unique field ids', () => {
    for (const template of templates) {
      const ids = template.fields.map((f) => f.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('exercises every field type across the seed set', () => {
    const used = new Set(templates.flatMap((t) => t.fields.map((f) => f.type)))
    expect([...used].sort()).toEqual(
      ['boolean', 'cardExpiry', 'date', 'masked', 'note', 'number', 'text', 'url'].sort(),
    )
  })

  it('does not share field objects between calls', () => {
    const a = createBuiltinTemplates(0)
    const b = createBuiltinTemplates(0)
    a[0]!.fields[0]!.label = 'mutated'
    expect(b[0]!.fields[0]!.label).not.toBe('mutated')
  })
})

describe('createItem', () => {
  it('creates a live, bound item', () => {
    const item = createItem(loginTemplate.id, 1234)
    expect(item.templateId).toBe(loginTemplate.id)
    expect(item.deleted).toBe(false)
    expect(item.createdAt).toBe(1234)
    expect(item.values).toEqual({})
  })
})
