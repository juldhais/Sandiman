/**
 * The unlocked workspace shell.
 *
 * Owns module selection and app-wide actions. Feature modules own their
 * browsing and editing state; all data shown here is already decrypted.
 */
import { useRef, useState } from 'react'
import { Menu, Plus } from 'lucide-react'
import { useVaultStore } from '@/state/vaultStore'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { VaultModule } from '@/components/vault/VaultModule'
import { Sidebar, type SidebarProps } from '@/components/shell/Sidebar'
import type { ModuleView } from '@/components/shell/moduleView'
import { SyncPanel } from '@/components/sync/SyncPanel'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { TemplateManager } from '@/components/templates/TemplateManager'
import { NotesModule } from '@/components/notes/NotesModule'
import { ALL_NOTES_FOLDER_ID, resolveSelectedFolderId } from '@/storage/noteFolders'

export function Workspace() {
  const items = useVaultStore((state) => state.items)
  const notes = useVaultStore((state) => state.notes)
  const noteFolders = useVaultStore((state) => state.noteFolders)
  const templates = useVaultStore((state) => state.templates)
  const settings = useVaultStore((state) => state.settings)
  const lock = useVaultStore((state) => state.lock)

  const [view, setView] = useState<ModuleView>({ module: 'vault', view: { kind: 'all' } })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [noteCreateRequested, setNoteCreateRequested] = useState(false)
  const [itemCreateRequest, setItemCreateRequest] = useState<
    { token: number; templateId: string | null } | null
  >(null)
  const createToken = useRef(0)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const activeView: ModuleView = view.module === 'notes'
    ? {
        module: 'notes',
        folderId: resolveSelectedFolderId(view.folderId, noteFolders, notes),
      }
    : view

  const lastSync = settings.lastSyncAt
    ? {
        direction: 'none' as const,
        itemsAfterMerge: items.length,
        itemsReceived: 0,
        itemsSent: 0,
        templatesReceived: 0,
        templatesSent: 0,
        notesReceived: 0,
        notesSent: 0,
        foldersReceived: 0,
        foldersSent: 0,
        remoteWasNewer: false,
        completedAt: settings.lastSyncAt,
      }
    : null

  function openCreate(templateId: string | null): void {
    setItemCreateRequest({ token: ++createToken.current, templateId })
    setMobileNavOpen(false)
  }

  function openCreateNote(): void {
    setView((current) => ({
      module: 'notes',
      folderId: current.module === 'notes' ? current.folderId : ALL_NOTES_FOLDER_ID,
    }))
    setNoteCreateRequested(true)
  }

  function currentTitle(): string {
    if (view.module === 'notes') return 'Notes'
    const vaultView = view.view
    switch (vaultView.kind) {
      case 'all': return 'All items'
      case 'expiring': return 'Expiring'
      case 'tags': return 'Tags'
      case 'template':
        return vaultView.id === ''
          ? 'No template'
          : (templates.find((template) => template.id === vaultView.id && !template.deleted)?.name ?? 'Template')
    }
  }

  function handleViewChange(next: ModuleView): void {
    if (next.module === 'notes') {
      if (view.module !== 'notes' || next.folderId !== view.folderId) setSelectedNoteId(null)
    } else {
      setNoteCreateRequested(false)
    }
    setView(next)
    setMobileNavOpen(false)
  }

  function handleAddItem(): void {
    const templateId = view.module === 'vault' && view.view.kind === 'template' && view.view.id
      ? view.view.id
      : null
    openCreate(templateId)
  }

  function handleAddNote(): void {
    openCreateNote()
    setMobileNavOpen(false)
  }

  const sidebarProps: SidebarProps = {
    view: activeView,
    onViewChange: handleViewChange,
    onAddItem: handleAddItem,
    onAddNote: handleAddNote,
    onOpenTemplates: () => {
      setTemplatesOpen(true)
      setMobileNavOpen(false)
    },
    onOpenSettings: () => {
      setSettingsOpen(true)
      setMobileNavOpen(false)
    },
    onOpenSync: () => {
      setSyncOpen(true)
      setMobileNavOpen(false)
    },
    onLock: lock,
    lastSync,
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden w-64 shrink-0 md:block">
        <Sidebar {...sidebarProps} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b p-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>

          <h1 className="flex-1 truncate text-sm font-medium">{currentTitle()}</h1>

          {view.module === 'notes' ? (
            <Button size="sm" onClick={openCreateNote}>
              <Plus />
              <span className="hidden sm:inline">Add note</span>
            </Button>
          ) : (
            <Button size="sm" onClick={() => openCreate(view.module === 'vault' && view.view.kind === 'template' && view.view.id ? view.view.id : null)}>
              <Plus />
              <span className="hidden sm:inline">Add item</span>
            </Button>
          )}
        </header>

        {view.module === 'notes' ? (
          <div className="min-h-0 flex-1">
            <NotesModule
              selectedId={selectedNoteId}
              onSelect={setSelectedNoteId}
              folderId={activeView.module === 'notes' ? activeView.folderId : ALL_NOTES_FOLDER_ID}
              onSelectFolder={(folderId) => {
                setSelectedNoteId(null)
                setView({ module: 'notes', folderId })
              }}
              createRequested={noteCreateRequested}
              onCreateHandled={() => setNoteCreateRequested(false)}
            />
          </div>
        ) : (
          <VaultModule
            view={view.module === 'vault' ? view.view : { kind: 'all' }}
            createRequest={itemCreateRequest}
            onCreateHandled={() => setItemCreateRequest(null)}
          />
        )}
      </div>

      {/* Mobile navigation */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Vault categories and settings</SheetDescription>
          </SheetHeader>
          <Sidebar {...sidebarProps} />
        </SheetContent>
      </Sheet>

      <TemplateManager open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <SyncPanel open={syncOpen} onOpenChange={setSyncOpen} />
      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
