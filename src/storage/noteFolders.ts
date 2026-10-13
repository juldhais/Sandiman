import type { VaultNoteFolder } from './types'

/** Validates the active folder hierarchy and rejects duplicate sibling names. */
export function validateFolderTree(folders: readonly VaultNoteFolder[]): void {
  const allIds = new Set<string>()
  const active = new Map<string, VaultNoteFolder>()
  for (const folder of folders) {
    if (allIds.has(folder.id)) throw new Error('Folder IDs must be unique')
    allIds.add(folder.id)
    if (!folder.deleted) active.set(folder.id, folder)
  }

  const siblingNames = new Set<string>()
  for (const folder of active.values()) {
    if (folder.parentId && !active.has(folder.parentId)) {
      throw new Error('A folder parent is missing or deleted')
    }
    const key = `${folder.parentId ?? ''}\0${folder.name.trim().toLowerCase()}`
    if (siblingNames.has(key)) throw new Error('Folder names must be unique within a folder')
    siblingNames.add(key)

    const seen = new Set([folder.id])
    let parentId = folder.parentId
    while (parentId) {
      if (seen.has(parentId)) throw new Error('Folders cannot contain themselves')
      seen.add(parentId)
      parentId = active.get(parentId)?.parentId ?? null
    }
  }
}

/** Validates a prospective create, rename, or move before it reaches state. */
export function validateFolderPlacement(
  folders: readonly VaultNoteFolder[],
  id: string,
  parentId: string | null,
  name: string,
): void {
  const active = folders.filter((folder) => !folder.deleted)
  if (parentId && !active.some((folder) => folder.id === parentId)) {
    throw new Error('The selected parent folder no longer exists')
  }

  const byId = new Map(active.map((folder) => [folder.id, folder]))
  const seen = new Set([id])
  let ancestor = parentId
  while (ancestor) {
    if (seen.has(ancestor)) throw new Error('A folder cannot be moved inside itself')
    seen.add(ancestor)
    ancestor = byId.get(ancestor)?.parentId ?? null
  }

  const normalizedName = name.trim().toLowerCase()
  if (active.some((folder) =>
    folder.id !== id && folder.parentId === parentId && folder.name.trim().toLowerCase() === normalizedName,
  )) {
    throw new Error('A folder with that name already exists here')
  }
}

/** Rehomes references to unavailable folders rather than dropping note data. */
export function recoverNoteFolderId(
  folderId: string | null | undefined,
  folders: readonly VaultNoteFolder[],
): string | null {
  if (!folderId) return null
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  let current = byId.get(folderId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (!current.deleted) return current.id
    seen.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return null
}
