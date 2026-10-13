import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react'
import type { VaultNote, VaultNoteFolder } from '@/storage/types'
import { ALL_NOTES_FOLDER_ID } from '@/storage/noteFolders'
import { Button } from '@/components/ui/button'

export { ALL_NOTES_FOLDER_ID } from '@/storage/noteFolders'

export function NoteFolderTree({
  folders,
  notes,
  selectedFolderId,
  disabled = false,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
}: {
  folders: readonly VaultNoteFolder[]
  notes: readonly VaultNote[]
  selectedFolderId: string | null
  disabled?: boolean
  onSelect: (id: string | null) => void
  onCreate: (parentId: string | null) => void
  onEdit: (folder: VaultNoteFolder) => void
  onDelete: (folder: VaultNoteFolder) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const childrenByParent = new Map<string | null, VaultNoteFolder[]>()
  for (const folder of folders) {
    const siblings = childrenByParent.get(folder.parentId) ?? []
    siblings.push(folder)
    childrenByParent.set(folder.parentId, siblings)
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name))
  }
  const countIn = (id: string | null) => notes.filter((note) => (note.folderId ?? null) === id).length

  function createFolder(parentId: string | null): void {
    if (parentId) setExpanded((current) => new Set(current).add(parentId))
    onCreate(parentId)
  }

  function renderFolder(folder: VaultNoteFolder, depth: number): React.ReactNode {
    const children = childrenByParent.get(folder.id) ?? []
    const isExpanded = expanded.has(folder.id)
    const isSelected = selectedFolderId === folder.id
    return (
      <div key={folder.id}>
          <div className={`group flex items-center gap-1 rounded-md pr-1 ${isSelected ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent'}`} style={{ paddingLeft: `${8 + depth * 16}px` }}>
          <button
            type="button"
            className="text-muted-foreground flex size-6 shrink-0 items-center justify-center"
            aria-label={isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
            disabled={disabled}
            onClick={() => setExpanded((current) => {
              const next = new Set(current)
              if (next.has(folder.id)) next.delete(folder.id)
              else next.add(folder.id)
              return next
            })}
          >
            {children.length > 0 ? (isExpanded ? <ChevronDown /> : <ChevronRight />) : null}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(folder.id)}
            aria-current={isSelected ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm"
          >
            <Folder className="size-4 shrink-0" />
            <span className="truncate">{folder.name}</span>
            <span className="text-muted-foreground text-[10px]">{countIn(folder.id)}</span>
          </button>
          <Button disabled={disabled} size="icon-sm" variant="ghost" className="size-6 opacity-100 md:opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Add subfolder to ${folder.name}`} onClick={() => createFolder(folder.id)}>
            <FolderPlus />
          </Button>
          <Button disabled={disabled} size="icon-sm" variant="ghost" className="size-6 opacity-100 md:opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Rename ${folder.name}`} onClick={() => onEdit(folder)}>
            <Pencil />
          </Button>
          <Button disabled={disabled} size="icon-sm" variant="ghost" className="text-destructive size-6 opacity-100 md:opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete ${folder.name}`} onClick={() => onDelete(folder)}>
            <Trash2 />
          </Button>
        </div>
        {isExpanded ? children.map((child) => renderFolder(child, depth + 1)) : null}
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground px-2 py-1 text-xs">Folders</span>
        <Button disabled={disabled} size="icon-sm" variant="ghost" aria-label="Create folder" onClick={() => createFolder(null)}>
          <FolderPlus />
        </Button>
      </div>
      <FolderChoice
        selected={selectedFolderId === ALL_NOTES_FOLDER_ID}
        disabled={disabled}
        label="All notes"
        count={notes.length}
        onClick={() => onSelect(ALL_NOTES_FOLDER_ID)}
      />
      {(childrenByParent.get(null) ?? []).map((folder) => renderFolder(folder, 0))}
      {countIn(null) > 0 ? (
        <div className="mt-1 border-t pt-1">
          <FolderChoice
            selected={selectedFolderId === null}
            disabled={disabled}
            label="Unfiled"
            count={countIn(null)}
            onClick={() => onSelect(null)}
          />
        </div>
      ) : null}
    </div>
  )
}

function FolderChoice({
  label,
  count,
  selected,
  disabled,
  onClick,
}: {
  label: string
  count: number
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={`flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm ${selected ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent'}`}
    >
      <span className="size-6 shrink-0" aria-hidden="true" />
      <Folder className="size-4 shrink-0" />
      <span>{label}</span>
      <span className="text-muted-foreground text-[10px]">{count}</span>
    </button>
  )
}
