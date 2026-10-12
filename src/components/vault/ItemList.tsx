/**
 * Vault item list.
 *
 * Filtering happens entirely in memory over the decrypted items, which is safe:
 * nothing is searched off-device, so a query never leaves the browser.
 */
import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { resolveFields } from '@/storage/templateEngine'
import type { ExpiryEntry } from '@/storage/expiry'
import type { VaultItem, VaultTemplate } from '@/storage/types'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/vault/EmptyState'
import { ExpiryBadge } from '@/components/ExpiryBadge'
import { TemplateIcon } from '@/components/TemplateIcon'

/** Short secondary line: the first non-empty, non-sensitive field value. */
function subtitleFor(item: VaultItem, template: VaultTemplate | null): string {
  const fields = resolveFields(item, template).filter(
    (field) =>
      field.value.trim() &&
      field.def.type !== 'note' &&
      field.def.type !== 'masked' &&
      field.def.id.toLowerCase() !== 'password' &&
      field.def.label.toLowerCase() !== 'password',
  )
  const preferred =
    fields.find((field) => field.id === 'username') ??
    fields.find((field) => field.id === 'cardNumber') ??
    fields[0]
  return preferred?.value.trim() ?? ''
}

export interface ItemListProps {
  items: readonly VaultItem[]
  templates: readonly VaultTemplate[]
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  search: string
  onSearchChange: (value: string) => void
  /** Expiry entries keyed by item id, for the row badges. */
  expiriesByItem: ReadonlyMap<string, ExpiryEntry[]>
  loading?: boolean
}

/**
 * Case-insensitive substring match across title, field values, notes, and tags.
 */
function matchesQuery(item: VaultItem, template: VaultTemplate | null, query: string): boolean {
  if (query.length === 0) return true
  const needle = query.toLowerCase()

  if (item.title.toLowerCase().includes(needle)) return true
  if (item.notes.toLowerCase().includes(needle)) return true
  if (item.tags.some((tag) => tag.toLowerCase().includes(needle))) return true

  for (const field of resolveFields(item, template)) {
    if (field.value.toLowerCase().includes(needle)) return true
  }
  return false
}

export function ItemList({
  items,
  templates,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  search,
  onSearchChange,
  expiriesByItem,
  loading = false,
}: ItemListProps) {
  const templateById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  )

  const visible = useMemo(
    () =>
      items
        .filter((item) => matchesQuery(item, item.templateId ? (templateById.get(item.templateId) ?? null) : null, search))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [items, templateById, search],
  )

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search this vault"
          aria-label="Search vault items"
          type="search"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          hasItems={items.length > 0}
          isSearching={search.length > 0}
        />
      ) : (
        <ul className="scrollbar-slim flex-1 divide-y overflow-y-auto">
          {visible.map((item) => {
            const template = item.templateId ? (templateById.get(item.templateId) ?? null) : null
            const expiries = expiriesByItem.get(item.id) ?? []
            const worst = expiries[0]
            const isSelected = item.id === selectedId

            return (
              <li key={item.id}>
                <div
                  className={cn(
                    'group hover:bg-accent/50 flex items-center gap-3 px-3 py-2.5 transition-colors',
                    isSelected && 'bg-accent',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <span
                      className={cn(
                        'bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg',
                        isSelected && 'bg-primary/10 text-primary',
                      )}
                    >
                      <TemplateIcon icon={template?.icon ?? 'Square'} className="size-4" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {item.title || 'Untitled'}
                        </span>
                        {worst &&
                        (worst.status === 'expired' || worst.status === 'critical') ? (
                          <AlertTriangle className="text-destructive size-3.5 shrink-0" />
                        ) : null}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {subtitleFor(item, template)}
                      </span>
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    {worst ? <ExpiryBadge entry={worst} /> : null}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${item.title || 'item'}`}
                        >
                          <span aria-hidden>⋯</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(item.id)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onDelete(item.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="text-muted-foreground border-t px-3 py-2 text-xs">
        {visible.length === 0
          ? 'No matches'
          : `${visible.length} of ${items.length} item${items.length === 1 ? '' : 's'}`}
      </footer>
    </div>
  )
}
