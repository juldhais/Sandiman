import { useMemo, useState } from 'react'
import type { VaultNoteFolder } from '@/storage/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

function folderPath(folder: VaultNoteFolder, folders: readonly VaultNoteFolder[]): string {
  const byId = new Map(folders.map((candidate) => [candidate.id, candidate]))
  const names = [folder.name]
  const seen = new Set([folder.id])
  let parentId = folder.parentId
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    names.push(parent.name)
    parentId = parent.parentId
  }
  return names.reverse().join(' / ')
}

export function NoteFolderDialog({
  folders,
  folder,
  defaultParentId,
  open,
  onOpenChange,
  onSave,
}: {
  folders: readonly VaultNoteFolder[]
  folder: VaultNoteFolder | null
  defaultParentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (name: string, parentId: string | null) => Promise<void>
}) {
  const [name, setName] = useState(folder?.name ?? '')
  const [parentValue, setParentValue] = useState(folder?.parentId ?? defaultParentId ?? '__root__')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const descendants = useMemo(() => {
    if (!folder) return new Set<string>()
    const result = new Set<string>([folder.id])
    let changed = true
    while (changed) {
      changed = false
      for (const candidate of folders) {
        if (candidate.parentId && result.has(candidate.parentId) && !result.has(candidate.id)) {
          result.add(candidate.id)
          changed = true
        }
      }
    }
    return result
  }, [folder, folders])

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSave(name, parentValue === '__root__' ? null : parentValue)
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the folder')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{folder ? 'Edit folder' : 'New folder'}</DialogTitle>
          <DialogDescription>Folder names are encrypted and are not used in GitHub file paths.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="space-y-2">
            <Label htmlFor="note-folder-name">Name</Label>
            <Input id="note-folder-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-folder-parent">Parent folder</Label>
            <Select value={parentValue} onValueChange={setParentValue}>
              <SelectTrigger id="note-folder-parent"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">Top level</SelectItem>
                {folders.filter((candidate) => !descendants.has(candidate.id)).map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>{folderPath(candidate, folders)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save folder'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
