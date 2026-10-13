import { describe, expect, it } from 'vitest'
import { ALL_NOTES_FOLDER_ID, recoverNoteFolderId, resolveSelectedFolderId, validateFolderPlacement, validateFolderTree } from '@/storage/noteFolders'
import type { VaultNote, VaultNoteFolder } from '@/storage/types'

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

const note = (id: string, folderId: string | null): VaultNote => ({
  id,
  title: id,
  markdown: '',
  folderId,
  createdAt: 1,
  updatedAt: 1,
  deleted: false,
})

describe('note folder rules', () => {
  it('keeps the selected folder valid and distinguishes Unfiled from All notes', () => {
    const folders = [folder('work', null)]
    const notes = [note('filed', 'work'), note('loose', null)]

    expect(resolveSelectedFolderId('work', folders, notes)).toBe('work')
    expect(resolveSelectedFolderId(null, folders, notes)).toBeNull()
    expect(resolveSelectedFolderId('missing', folders, notes)).toBe(ALL_NOTES_FOLDER_ID)
    expect(resolveSelectedFolderId(null, folders, [note('filed', 'work')])).toBe(ALL_NOTES_FOLDER_ID)
  })

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
