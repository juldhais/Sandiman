import { describe, expect, it } from 'vitest'
import { mergeItems, mergePayloads, mergeTemplates } from '@/sync/merge'
import type { VaultItem, VaultPayload, VaultTemplate } from '@/storage/types'

function item(id: string, updatedAt: number, deleted = false): VaultItem {
  return {
    id,
    templateId: 't1',
    title: id,
    values: { password: `${id}-secret` },
    customFields: [],
    tags: [],
    notes: '',
    createdAt: 0,
    updatedAt,
    deleted,
  }
}

function template(id: string, updatedAt: number, deleted = false): VaultTemplate {
  return {
    id,
    name: id,
    icon: 'Square',
    builtIn: false,
    fields: [],
    createdAt: 0,
    updatedAt,
    deleted,
  }
}

function payload(items: VaultItem[], templates: VaultTemplate[], updatedAt: number): VaultPayload {
  return {
    version: 1,
    items,
    templates,
    settings: {
      clipboardClearSeconds: 30,
      autoLockMinutes: 5,
      lockOnBlur: false,
      expiryWarningDays: 30,
      lastSyncAt: null,
    },
    updatedAt,
  }
}

describe('mergeItems', () => {
  it('keeps the newer version of a conflicting item', () => {
    const local = [item('a', 100)]
    const remote = [{ ...item('a', 200), title: 'remote edit' }]

    const { value, counts } = mergeItems(local, remote)

    expect(value).toHaveLength(1)
    expect(value[0]!.title).toBe('remote edit')
    expect(counts.received).toBe(1)
  })

  it('keeps the local version when it is newer', () => {
    const local = [{ ...item('a', 300), title: 'local edit' }]
    const remote = [item('a', 200)]

    const { value, counts } = mergeItems(local, remote)

    expect(value[0]!.title).toBe('local edit')
    expect(counts.sent).toBe(1)
  })

  it('lets a delete win over an edit from the same instant', () => {
    // The exact case a naive `updatedAt >` comparison gets wrong.
    const local = [item('a', 100, true)]
    const remote = [{ ...item('a', 100), title: 'still here' }]

    const { value } = mergeItems(local, remote)

    expect(value[0]!.deleted).toBe(true)
  })

  it('keeps a delete against an older offline edit', () => {
    // Device A deletes at t=200. Device B edited offline at t=100 and syncs
    // afterwards. The tombstone must still win, or the stale edit resurrects
    // the item on device A.
    const local = [item('a', 200, true)]
    const remote = [{ ...item('a', 100), title: 'edited offline' }]

    const { value } = mergeItems(local, remote)

    expect(value[0]!.deleted).toBe(true)
  })

  it('lets a genuinely newer edit win over a delete', () => {
    // The inverse case: an edit made *after* the delete is a real user action,
    // so it wins rather than being silently discarded.
    const local = [item('a', 100, true)]
    const remote = [{ ...item('a', 300), title: 're-added later' }]

    const { value } = mergeItems(local, remote)

    expect(value[0]!.deleted).toBe(false)
    expect(value[0]!.title).toBe('re-added later')
  })

  it('unions items that exist on only one side', () => {
    const local = [item('a', 100)]
    const remote = [item('b', 100)]

    const { value } = mergeItems(local, remote)

    expect(value.map((candidate) => candidate.id).sort()).toEqual(['a', 'b'])
  })

  it('retains a tombstone for an item never seen locally', () => {
    // Otherwise a third device that does have the record would never learn it
    // was deleted.
    const remote = [item('ghost', 100, true)]

    const { value } = mergeItems([], remote)

    expect(value).toHaveLength(1)
    expect(value[0]!.deleted).toBe(true)
  })

  it('drops a record tombstoned on both sides', () => {
    const local = [item('a', 100, true)]
    const remote = [item('a', 300, true)]

    const { value, counts } = mergeItems(local, remote)

    expect(value).toHaveLength(0)
    expect(counts.dropped).toBe(1)
  })
})

describe('mergeTemplates', () => {
  it('merges by updatedAt like items', () => {
    const { value } = mergeTemplates(
      [template('t1', 100)],
      [{ ...template('t1', 200), name: 'renamed' }],
    )

    expect(value[0]!.name).toBe('renamed')
  })

  it('keeps a deleted template deleted', () => {
    const { value } = mergeTemplates([template('t1', 100, true)], [template('t1', 50)])

    expect(value[0]!.deleted).toBe(true)
  })
})

describe('mergePayloads', () => {
  it('merges items and templates together', () => {
    const local = payload([item('a', 100)], [template('t1', 100)], 100)
    const remote = payload([item('b', 100)], [template('t2', 100)], 100)

    const result = mergePayloads(local, remote)

    expect(result.payload.items).toHaveLength(2)
    expect(result.payload.templates).toHaveLength(2)
    expect(result.diverged).toBe(true)
  })

  it('takes settings wholesale from the newer payload', () => {
    const local = payload([], [], 100)
    const remote = payload([], [], 200)
    remote.settings.autoLockMinutes = 15

    const result = mergePayloads(local, remote)

    // Per-key merging would produce a combination neither device chose.
    expect(result.payload.settings.autoLockMinutes).toBe(15)
    expect(result.remoteWasNewer).toBe(true)
  })

  it('reports no divergence when both sides match', () => {
    const items = [item('a', 100)]
    const templates = [template('t1', 100)]
    const local = payload(items, templates, 100)
    const remote = payload(items, templates, 100)

    expect(mergePayloads(local, remote).diverged).toBe(false)
  })

  it('converges: merging twice is idempotent', () => {
    const a = payload([item('a', 100)], [template('t1', 100)], 100)
    const b = payload([item('b', 200)], [], 200)

    const first = mergePayloads(a, b)
    const second = mergePayloads(first.payload, b)

    const ids = (result: typeof first) => result.payload.items.map((i) => i.id).sort()
    expect(ids(second)).toEqual(ids(first))
  })

  it('never carries local sync settings into the result', () => {
    const local = { ...payload([], [], 100), sync: { config: { sasUrl: 'local-secret' } as never } }
    const remote = { ...payload([], [], 100), sync: { config: { sasUrl: 'remote-secret' } as never } }

    const result = mergePayloads(local, remote)

    expect(result.payload).not.toHaveProperty('sync')
    expect(JSON.stringify(result.payload)).not.toContain('secret')
  })
})
