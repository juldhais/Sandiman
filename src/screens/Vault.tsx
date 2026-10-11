/**
 * The unlocked vault screen.
 *
 * Owns the selection state and composes sidebar, list, and detail. All data
 * shown here is already decrypted in memory; nothing on this screen performs
 * decryption, so there is no loading state beyond the initial paint.
 */
import { useEffect, useMemo, useState } from 'react'
import { CloudUpload, Menu, Plus, Settings, X } from 'lucide-react'
import { toast } from 'sonner'
import { collectExpiries, type ExpiryEntry } from '@/storage/expiry'
import type { VaultItem, VaultTemplate } from '@/storage/types'
import { useVaultStore } from '@/state/vaultStore'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ToggleThemeButton } from '@/components/ToggleThemeButton'
import { ItemDetail } from '@/components/vault/ItemDetail'
import { ItemForm } from '@/components/vault/ItemForm'
import { ItemList } from '@/components/vault/ItemList'
import { ExpiryDashboard } from '@/components/vault/ExpiryDashboard'
import { Sidebar, type SidebarView } from '@/components/vault/Sidebar'
import { SyncPanel } from '@/components/sync/SyncPanel'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { TemplateManager } from '@/components/templates/TemplateManager'

export function Vault() {
  const items = useVaultStore((state) => state.items)
  const templates = useVaultStore((state) => state.templates)
  const settings = useVaultStore((state) => state.settings)
  const deleteItem = useVaultStore((state) => state.deleteItem)
  const lock = useVaultStore((state) => state.lock)

  const [view, setView] = useState<SidebarView>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState('')

  const [formState, setFormState] = useState<
    { open: false } | { open: true; item: VaultItem | null; templateId: string | null }
  >({ open: false })
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const liveTemplates = useMemo(
    () => templates.filter((template) => !template.deleted),
    [templates],
  )

  const templateById = useMemo(
    () => new Map(liveTemplates.map((template) => [template.id, template])),
    [liveTemplates],
  )

  const expiry = useMemo(
    () => collectExpiries(items, templates, settings.expiryWarningDays),
    [items, templates, settings.expiryWarningDays],
  )

  const expiriesByItem = useMemo(() => {
    const map = new Map<string, ExpiryEntry[]>()
    for (const entry of expiry.entries) {
      const existing = map.get(entry.itemId)
      if (existing) existing.push(entry)
      else map.set(entry.itemId, [entry])
    }
    return map
  }, [expiry])

  /** Items visible in the list pane, honouring the sidebar's current view. */
  const scopedItems = useMemo(() => {
    switch (view.kind) {
      case 'template':
        return view.id === '' ? items.filter((item) => !item.templateId) : items.filter((item) => item.templateId === view.id)
      case 'tags':
        return items
      case 'expiring':
        return items.filter((item) => (expiriesByItem.get(item.id)?.length ?? 0) > 0)
      case 'all':
      default:
        return items
    }
  }, [view, items, expiriesByItem])

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  )

  // Clear the selection when it points at something no longer in scope.
  useEffect(() => {
    if (selectedId && !scopedItems.some((item) => item.id === selectedId)) {
      setSelectedId(null)
    }
  }, [scopedItems, selectedId])

  const allTags = useMemo(() => {
    const seen = new Set<string>()
    for (const item of items) for (const tag of item.tags) seen.add(tag)
    return Array.from(seen).sort()
  }, [items])

  const visibleTags = allTags.filter((tag) =>
    tagFilter.trim().length === 0 ? true : tag.toLowerCase().includes(tagFilter.trim().toLowerCase()),
  )

  function openCreate(templateId: string | null): void {
    setFormState({ open: true, item: null, templateId })
    setMobileNavOpen(false)
  }

  function openEdit(item: VaultItem): void {
    setFormState({ open: true, item, templateId: item.templateId })
  }

  const editTemplate: VaultTemplate | null =
    formState.open && formState.templateId
      ? (templateById.get(formState.templateId) ?? null)
      : null

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden w-64 shrink-0 md:block">
        <Sidebar
          view={view}
          onViewChange={setView}
          onAddItem={() => openCreate(view.kind === 'template' && view.id ? view.id : null)}
          onOpenTemplates={() => setTemplatesOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onLock={lock}
          lastSync={
            settings.lastSyncAt
              ? {
                  direction: 'none',
                  itemsAfterMerge: items.length,
                  itemsReceived: 0,
                  itemsSent: 0,
                  templatesReceived: 0,
                  templatesSent: 0,
                  remoteWasNewer: false,
                  completedAt: settings.lastSyncAt,
                }
              : null
          }
        />
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

          <h1 className="flex-1 truncate text-sm font-medium">
            {view.kind === 'all'
              ? 'All items'
              : view.kind === 'expiring'
                ? 'Expiring'
                : view.kind === 'tags'
                  ? 'Tags'
                  : view.id === ''
                    ? 'No template'
                    : (templateById.get(view.id)?.name ?? 'Template')}
          </h1>

          <Button variant="ghost" size="icon" onClick={() => setSyncOpen(true)} aria-label="Sync settings">
            <CloudUpload />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <Settings />
          </Button>
          <ToggleThemeButton />
          <Button size="sm" onClick={() => openCreate(null)}>
            <Plus />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[22rem_1fr]">
          <div className="flex min-h-0 flex-col border-r">
            {view.kind === 'tags' ? (
              <div className="border-b p-3">
                <input
                  value={tagFilter}
                  onChange={(event) => setTagFilter(event.target.value)}
                  placeholder="Filter tags"
                  aria-label="Filter tags"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  {visibleTags.length === 0 ? (
                    <span className="text-muted-foreground text-xs">No tags yet.</span>
                  ) : (
                    visibleTags.map((tag) => (
                      <Button
                        key={tag}
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => setSearch(tag)}
                      >
                        {tag}
                      </Button>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1">
              <ItemList
                items={scopedItems}
                templates={liveTemplates}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onEdit={(id) => {
                  const item = items.find((candidate) => candidate.id === id)
                  if (item) openEdit(item)
                }}
                onDelete={(id) => setPendingDelete(id)}
                search={search}
                onSearchChange={setSearch}
                expiriesByItem={expiriesByItem}
              />
            </div>
          </div>

          <div className="min-h-0">
            {view.kind === 'expiring' ? (
              <ExpiryDashboard summary={expiry} onSelectItem={setSelectedId} />
            ) : selected ? (
              <ItemDetail
                key={`${selected.id}:${selected.updatedAt}`}
                item={selected}
                template={selected.templateId ? (templateById.get(selected.templateId) ?? null) : null}
                expiries={expiriesByItem.get(selected.id) ?? []}
                onEdit={() => openEdit(selected)}
                onDelete={() => setPendingDelete(selected.id)}
              />
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
                Select an item to see its details.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile navigation */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Vault categories and settings</SheetDescription>
          </SheetHeader>
          <Sidebar
            view={view}
            onViewChange={(next) => {
              setView(next)
              setMobileNavOpen(false)
            }}
            onAddItem={() => openCreate(null)}
            onOpenTemplates={() => {
              setTemplatesOpen(true)
              setMobileNavOpen(false)
            }}
            onOpenSettings={() => {
              setSettingsOpen(true)
              setMobileNavOpen(false)
            }}
            onLock={lock}
            lastSync={null}
          />
        </SheetContent>
      </Sheet>

      <ItemForm
        key={
          formState.open
            ? (formState.item?.id ?? `new-${formState.templateId ?? 'default'}`)
            : 'closed'
        }
        open={formState.open}
        onOpenChange={(open) => {
          if (!open) setFormState({ open: false })
        }}
        item={formState.open ? formState.item : null}
        template={editTemplate}
        templates={liveTemplates}
      />

      <TemplateManager open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <SyncPanel open={syncOpen} onOpenChange={setSyncOpen} />
      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />

      <DeleteConfirm
        itemId={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            void deleteItem(pendingDelete)
            toast.success('Item deleted', {
              description: 'A tombstone is kept so the delete syncs to other devices.',
            })
            if (selectedId === pendingDelete) setSelectedId(null)
          }
          setPendingDelete(null)
        }}
      />
    </div>
  )
}

/** Small confirm sheet for deletes, so the list's dropdown stays one click. */
function DeleteConfirm({
  itemId,
  onCancel,
  onConfirm,
}: {
  itemId: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const items = useVaultStore((state) => state.items)
  const item = items.find((candidate) => candidate.id === itemId)

  return (
    <Sheet open={itemId !== null} onOpenChange={(open) => !open && onCancel()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <X className="text-destructive size-4" />
            Delete this item?
          </SheetTitle>
          <SheetDescription>
            {item ? `"${item.title || 'Untitled'}" will be removed from this device.` : ''}{' '}
            A deletion marker is kept in the vault so the change reaches your other
            devices on the next sync.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 p-6">
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
