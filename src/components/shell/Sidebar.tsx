/** Navigation and app actions for the unlocked workspace. */
import { useMemo, useState } from 'react'
import {
  CalendarClock,
  Clock,
  KeyRound,
  Layers,
  LayoutGrid,
  Plus,
  Settings,
  ShieldCheck,
  StickyNote,
  Tags,
  Unlock,
  UploadCloud,
} from 'lucide-react'
import { collectExpiries } from '@/storage/expiry'
import { ALL_NOTES_FOLDER_ID } from '@/storage/noteFolders'
import type { VaultNoteFolder } from '@/storage/types'
import { useVaultStore } from '@/state/vaultStore'
import type { SyncOutcome } from '@/sync/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NoteFolderTree } from '@/components/notes/NoteFolderTree'
import { NoteFolderDialog } from '@/components/notes/NoteFolderDialog'
import { TemplateIcon } from '@/components/TemplateIcon'
import { cn } from '@/lib/cn'
import type { ModuleView, VaultView } from './moduleView'

export interface SidebarProps {
  view: ModuleView
  onViewChange: (view: ModuleView) => void
  onAddItem: () => void
  onAddNote: () => void
  onOpenTemplates: () => void
  onOpenSettings: () => void
  onOpenSync: () => void
  onLock: () => void
  lastSync: SyncOutcome | null
}

export function Sidebar({
  view,
  onViewChange,
  onAddItem,
  onAddNote,
  onOpenTemplates,
  onOpenSettings,
  onOpenSync,
  onLock,
  lastSync,
}: SidebarProps) {
  const items = useVaultStore((state) => state.items)
  const notes = useVaultStore((state) => state.notes)
  const folders = useVaultStore((state) => state.noteFolders)
  const templates = useVaultStore((state) => state.templates)
  const settings = useVaultStore((state) => state.settings)
  const saving = useVaultStore((state) => state.saving)
  const addNoteFolder = useVaultStore((state) => state.addNoteFolder)
  const updateNoteFolder = useVaultStore((state) => state.updateNoteFolder)
  const deleteNoteFolder = useVaultStore((state) => state.deleteNoteFolder)
  const [folderEditor, setFolderEditor] = useState<
    { kind: 'create'; parentId: string | null } | { kind: 'edit'; folder: VaultNoteFolder } | null
  >(null)
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<VaultNoteFolder | null>(null)

  const liveTemplates = useMemo(() => templates.filter((template) => !template.deleted), [templates])
  const countsByTemplate = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      if (item.templateId) counts.set(item.templateId, (counts.get(item.templateId) ?? 0) + 1)
    }
    return counts
  }, [items])
  const templatesWithItems = liveTemplates.filter((template) => (countsByTemplate.get(template.id) ?? 0) > 0)
  const tags = useMemo(() => {
    const seen = new Set<string>()
    for (const item of items) for (const tag of item.tags) seen.add(tag)
    return Array.from(seen).sort((left, right) => left.localeCompare(right))
  }, [items])
  const expiry = useMemo(
    () => collectExpiries(items, templates, settings.expiryWarningDays),
    [items, templates, settings.expiryWarningDays],
  )
  const attention = expiry.expired + expiry.critical + expiry.warning
  const activeVaultView = view.module === 'vault' ? view.view : null
  const selectedFolderId = view.module === 'notes' ? view.folderId : ALL_NOTES_FOLDER_ID

  function changeVaultView(next: VaultView): void {
    onViewChange({ module: 'vault', view: next })
  }

  async function saveFolder(name: string, parentId: string | null): Promise<void> {
    if (folderEditor?.kind === 'edit') {
      await updateNoteFolder(folderEditor.folder.id, { name, parentId })
    } else {
      const folder = await addNoteFolder(name, parentId)
      onViewChange({ module: 'notes', folderId: folder.id })
    }
    setFolderEditor(null)
  }

  async function confirmDeleteFolder(): Promise<void> {
    if (!pendingDeleteFolder) return
    const parentId = await deleteNoteFolder(pendingDeleteFolder.id)
    if (view.module === 'notes' && view.folderId === pendingDeleteFolder.id) {
      onViewChange({ module: 'notes', folderId: parentId ?? ALL_NOTES_FOLDER_ID })
    }
    setPendingDeleteFolder(null)
  }

  return (
    <aside className="bg-sidebar text-sidebar-foreground flex h-full w-full flex-col border-r">
      <div className="flex items-center gap-2 p-4">
        <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Sandiman</p>
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            {saving ? <><Clock className="size-3" />Saving</> : <><Unlock className="size-3" />Unlocked</>}
          </p>
        </div>
      </div>

      <div className="px-3 pb-2">
        <Button className="w-full" size="sm" onClick={view.module === 'notes' ? onAddNote : onAddItem}>
          <Plus />{view.module === 'notes' ? 'Add note' : 'Add item'}
        </Button>
      </div>

      <nav className="scrollbar-slim flex-1 space-y-2 overflow-y-auto px-2 pb-4">
        <section>
          <ModuleHeading
            label="Vault"
            count={items.length}
            active={view.module === 'vault'}
            icon={<ShieldCheck className="size-4" />}
            onClick={() => changeVaultView({ kind: 'all' })}
          />
          {view.module === 'vault' ? (
            <ul className="mt-1 space-y-0.5 pl-2">
              <NavItem icon={<LayoutGrid />} label="All items" count={items.length} active={activeVaultView?.kind === 'all'} onClick={() => changeVaultView({ kind: 'all' })} />
              <NavItem icon={<CalendarClock />} label="Expiring" count={attention} emphasis={attention > 0} active={activeVaultView?.kind === 'expiring'} onClick={() => changeVaultView({ kind: 'expiring' })} />
              <NavItem icon={<Tags />} label="Tags" count={tags.length} active={activeVaultView?.kind === 'tags'} onClick={() => changeVaultView({ kind: 'tags' })} />
              {templatesWithItems.length || items.some((item) => !item.templateId) ? (
                <li className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">Templates</li>
              ) : null}
              {templatesWithItems.map((template) => (
                <NavItem
                  key={template.id}
                  icon={<TemplateIcon icon={template.icon} className="size-4" />}
                  label={template.name}
                  count={countsByTemplate.get(template.id) ?? 0}
                  active={activeVaultView?.kind === 'template' && activeVaultView.id === template.id}
                  onClick={() => changeVaultView({ kind: 'template', id: template.id })}
                />
              ))}
              {items.some((item) => !item.templateId) ? (
                <NavItem icon={<KeyRound />} label="No template" count={items.filter((item) => !item.templateId).length} active={activeVaultView?.kind === 'template' && activeVaultView.id === ''} onClick={() => changeVaultView({ kind: 'template', id: '' })} />
              ) : null}
              <li>
                <Button variant="ghost" size="sm" className="text-muted-foreground w-full justify-start" onClick={onOpenTemplates}>
                  <Layers className="size-4" />Manage templates
                </Button>
              </li>
            </ul>
          ) : null}
        </section>

        <Separator />

        <section>
          <ModuleHeading
            label="Notes"
            count={notes.length}
            active={view.module === 'notes'}
            icon={<StickyNote className="size-4" />}
            onClick={() => onViewChange({ module: 'notes', folderId: ALL_NOTES_FOLDER_ID })}
          />
          {view.module === 'notes' ? (
            <div className="mt-1 pl-2">
              <NoteFolderTree
                folders={folders}
                notes={notes}
                selectedFolderId={selectedFolderId}
                onSelect={(folderId) => onViewChange({ module: 'notes', folderId })}
                onCreate={(parentId) => setFolderEditor({ kind: 'create', parentId })}
                onEdit={(folder) => setFolderEditor({ kind: 'edit', folder })}
                onDelete={setPendingDeleteFolder}
              />
            </div>
          ) : null}
        </section>
      </nav>

      <div className="border-t p-2">
        {lastSync ? (
          <p className="text-muted-foreground px-2 pb-2 text-xs">
            Last sync · {new Date(lastSync.completedAt).toLocaleString()}
          </p>
        ) : null}
        <Button variant="ghost" size="sm" className="text-muted-foreground w-full justify-start" onClick={onOpenSync}>
          <UploadCloud className="size-4" />Sync
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground w-full justify-start" onClick={onOpenSettings}>
          <Settings className="size-4" />Settings
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground w-full justify-start" onClick={onLock}>
          <Unlock className="size-4" />Lock vault
        </Button>
      </div>

      <NoteFolderDialog
        key={folderEditor?.kind === 'edit' ? `folder-${folderEditor.folder.id}` : folderEditor ? 'new-folder' : 'closed-folder'}
        folders={folders}
        folder={folderEditor?.kind === 'edit' ? folderEditor.folder : null}
        defaultParentId={folderEditor?.kind === 'create' ? folderEditor.parentId : null}
        open={folderEditor !== null}
        onOpenChange={(open) => { if (!open) setFolderEditor(null) }}
        onSave={saveFolder}
      />
      <div className="sr-only" aria-live="polite">{items.length} vault items, {notes.length} notes</div>
      {pendingDeleteFolder ? (
        <DeleteFolderDialog folder={pendingDeleteFolder} onCancel={() => setPendingDeleteFolder(null)} onConfirm={() => void confirmDeleteFolder()} />
      ) : null}
    </aside>
  )
}

function ModuleHeading({
  label,
  count,
  active,
  icon,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold',
        active && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
    >
      {icon}<span className="flex-1">{label}</span><Badge variant="muted">{count}</Badge>
    </button>
  )
}

function NavItem({
  icon,
  label,
  count,
  active,
  emphasis = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  emphasis?: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'hover:bg-sidebar-accent focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
          active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="flex-1 truncate text-left">{label}</span>
        {count > 0 ? <Badge variant={emphasis ? 'warning' : 'muted'} className="font-mono-numbers">{count}</Badge> : null}
      </button>
    </li>
  )
}

function DeleteFolderDialog({
  folder,
  onCancel,
  onConfirm,
}: {
  folder: VaultNoteFolder
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this folder?</DialogTitle>
          <DialogDescription>
            “{folder.name}” will be removed. Notes and subfolders move to its parent, or to Unfiled. No notes will be deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Delete folder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
