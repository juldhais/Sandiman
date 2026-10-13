import { describe, expect, it } from 'vitest'
import { recoverNoteFolderId, validateFolderPlacement, validateFolderTree } from '@/storage/noteFolders'
import type { VaultNoteFolder } from '@/storage/types'

const folder = (
  id: string,
  parentId: string | null,
  overrides: Partial<VaultNoteFolder> = {},
): VaultNoteFolder => ({
  id,
  name: id,
  parentId,
  createdAt: 1,
  updatedAt: 1,
  deleted: false,
  ...overrides,
})

describe('note folder rules', () => {
  it('accepts a valid nested tree and rejects missing parents and cycles', () => {
    expect(() => validateFolderTree([folder('parent', null), folder('child', 'parent')])).not.toThrow()
    expect(() => validateFolderTree([folder('child', 'missing')])).toThrow(/parent/)
    expect(() => validateFolderTree([folder('a', 'b'), folder('b', 'a')])).toThrow(/contain themselves/)
  })

  it('rejects duplicate sibling names and moves into descendants', () => {
    expect(() => validateFolderTree([
      folder('parent', null),
      folder('first', 'parent', { name: 'Shared' }),
      folder('second', 'parent', { name: 'shared' }),
    ])).toThrow(/unique/)
    expect(() => validateFolderPlacement([
      folder('parent', null),
      folder('child', 'parent'),
    ], 'parent', 'child', 'Parent')).toThrow(/inside itself/)
  })

  it('recovers a note in a deleted folder to the closest live parent', () => {
    const folders = [
      folder('root', null),
      folder('deleted', 'root', { deleted: true }),
    ]
    expect(recoverNoteFolderId('deleted', folders)).toBe('root')
    expect(recoverNoteFolderId('unknown', folders)).toBeNull()
  })
})
