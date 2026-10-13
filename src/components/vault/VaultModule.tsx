/** Item browsing and editing for the Vault module. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { collectExpiries, type ExpiryEntry } from '@/storage/expiry'
import type { VaultItem, VaultTemplate } from '@/storage/types'
import { useVaultStore } from '@/state/vaultStore'
import type { VaultView } from '@/components/shell/moduleView'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ItemDetail } from '@/components/vault/ItemDetail'
import { ItemForm } from '@/components/vault/ItemForm'
import { ItemList } from '@/components/vault/ItemList'
import { ExpiryDashboard } from '@/components/vault/ExpiryDashboard'

export function VaultModule({
  view,
  createRequest,
  onCreateHandled,
}: {
  view: VaultView
  createRequest: { token: number; templateId: string | null } | null
  onCreateHandled: () => void
}) {
  const items = useVaultStore((state) => state.items)
  const templates = useVaultStore((state) => state.templates)
  const settings = useVaultStore((state) => state.settings)
  const deleteItem = useVaultStore((state) => state.deleteItem)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState('')
  const [formState, setFormState] = useState<
    { open: false } | { open: true; item: VaultItem | null; templateId: string | null }
  >({ open: false })
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const handledCreateToken = useRef<number | null>(null)

  const liveTemplates = useMemo(() => templates.filter((template) => !template.deleted), [templates])
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

  const scopedItems = useMemo(() => {
    switch (view.kind) {
      case 'template':
        return view.id === '' ? items.filter((item) => !item.templateId) : items.filter((item) => item.templateId === view.id)
      case 'expiring':
        return items.filter((item) => (expiriesByItem.get(item.id)?.length ?? 0) > 0)
      case 'tags':
      case 'all':
      default:
        return items
    }
  }, [view, items, expiriesByItem])
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId])

  useEffect(() => {
    if (selectedId && !scopedItems.some((item) => item.id === selectedId)) setSelectedId(null)
  }, [scopedItems, selectedId])

  useEffect(() => {
    if (!createRequest || handledCreateToken.current === createRequest.token) return
    handledCreateToken.current = createRequest.token
    setFormState({ open: true, item: null, templateId: createRequest.templateId })
    onCreateHandled()
  }, [createRequest, onCreateHandled])

  const allTags = useMemo(() => {
    const seen = new Set<string>()
    for (const item of items) for (const tag of item.tags) seen.add(tag)
    return Array.from(seen).sort()
  }, [items])
  const visibleTags = allTags.filter((tag) =>
    tagFilter.trim().length === 0 ? true : tag.toLowerCase().includes(tagFilter.trim().toLowerCase()),
  )

  function openEdit(item: VaultItem): void {
    setFormState({ open: true, item, templateId: item.templateId })
  }

  const editTemplate: VaultTemplate | null =
    formState.open && formState.templateId ? (templateById.get(formState.templateId) ?? null) : null

  return (
    <>
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
                ) : visibleTags.map((tag) => (
                  <Button key={tag} size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setSearch(tag)}>
                    {tag}
                  </Button>
                ))}
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
              onDelete={setPendingDelete}
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

      <ItemForm
        key={formState.open ? (formState.item?.id ?? `new-${formState.templateId ?? 'default'}`) : 'closed'}
        open={formState.open}
        onOpenChange={(open) => { if (!open) setFormState({ open: false }) }}
        item={formState.open ? formState.item : null}
        template={editTemplate}
        templates={liveTemplates}
      />
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
    </>
  )
}

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
            <X className="text-destructive size-4" />Delete this item?
          </SheetTitle>
          <SheetDescription>
            {item ? `“${item.title || 'Untitled'}” will be removed from this device. ` : ''}
            A deletion marker is kept in the vault so the change reaches your other devices on the next sync.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 p-6">
          <Button variant="destructive" onClick={onConfirm}>Delete</Button>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
