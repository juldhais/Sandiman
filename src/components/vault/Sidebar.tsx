/**
 * Vault sidebar.
 *
 * Doubles as the category navigator and the global status panel: template
 * counts, expiry warnings, and sync state all live here so the main pane stays
 * purely about items.
 */
import { useMemo } from 'react'
import {
  CalendarClock,
  Clock,
  KeyRound,
  LayoutGrid,
  Layers,
  Plus,
  Settings,
  ShieldCheck,
  Tags,
  Unlock,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { collectExpiries } from '@/storage/expiry'
import type { VaultItem, VaultTemplate } from '@/storage/types'
import { useVaultStore } from '@/state/vaultStore'
import type { SyncOutcome } from '@/sync/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TemplateIcon } from '@/components/TemplateIcon'

export type SidebarView =
  | { kind: 'all' }
  | { kind: 'expiring' }
  | { kind: 'tags' }
  | { kind: 'template'; id: string }

export interface SidebarProps {
  view: SidebarView
  onViewChange: (view: SidebarView) => void
  onAddItem: () => void
  onOpenTemplates: () => void
  onOpenSettings: () => void
  onLock: () => void
  lastSync: SyncOutcome | null
}

export function Sidebar({
  view,
  onViewChange,
  onAddItem,
  onOpenTemplates,
  onOpenSettings,
  onLock,
  lastSync,
}: SidebarProps) {
  const items = useVaultStore((state) => state.items)
  const templates = useVaultStore((state) => state.templates)
  const settings = useVaultStore((state) => state.settings)
  const saving = useVaultStore((state) => state.saving)

  const liveTemplates = useMemo(
    () => templates.filter((template) => !template.deleted),
    [templates],
  )

  const countsByTemplate = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      if (!item.templateId) continue
      counts.set(item.templateId, (counts.get(item.templateId) ?? 0) + 1)
    }
    return counts
  }, [items])

  const tags = useMemo(() => {
    const seen = new Map<string, number>()
    for (const item of items) {
      for (const tag of item.tags) seen.set(tag, (seen.get(tag) ?? 0) + 1)
    }
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  const expiry = useMemo(
    () => collectExpiries(items, templates, settings.expiryWarningDays),
    [items, templates, settings.expiryWarningDays],
  )

  const untemplated = items.filter((item) => !item.templateId).length
  const attention = expiry.expired + expiry.critical + expiry.warning

  return (
    <aside className="bg-sidebar text-sidebar-foreground flex h-full w-full flex-col border-r">
      <div className="flex items-center gap-2 p-4">
        <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Sandiman</p>
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            {saving ? (
              <>
                <Clock className="size-3" />
                Saving
              </>
            ) : (
              <>
                <Unlock className="size-3" />
                Unlocked
              </>
            )}
          </p>
        </div>
      </div>

      <div className="px-3 pb-2">
        <Button className="w-full" size="sm" onClick={onAddItem}>
          <Plus />
          Add item
        </Button>
      </div>

      <nav className="scrollbar-slim flex-1 overflow-y-auto px-2 pb-4">
        <NavGroup>
          <NavItem
            iconNode={<LayoutGrid className="size-4" />}
            label="All items"
            count={items.length}
            active={view.kind === 'all'}
            onClick={() => onViewChange({ kind: 'all' })}
          />
          <NavItem
            iconNode={<CalendarClock className="size-4" />}
            label="Expiring"
            count={attention}
            emphasis={attention > 0 ? 'warning' : undefined}
            active={view.kind === 'expiring'}
            onClick={() => onViewChange({ kind: 'expiring' })}
          />
          <NavItem
            iconNode={<Tags className="size-4" />}
            label="Tags"
            count={tags.length}
            active={view.kind === 'tags'}
            onClick={() => onViewChange({ kind: 'tags' })}
          />
        </NavGroup>

        <Separator className="my-2" />

        <NavGroup>
          <p className="text-muted-foreground px-2 py-1 text-xs font-medium tracking-wide uppercase">
            Templates
          </p>

          {liveTemplates.map((template) => (
            <NavItem
              key={template.id}
              iconNode={<TemplateIcon icon={template.icon} className="size-4" />}
              label={template.name}
              count={countsByTemplate.get(template.id) ?? 0}
              active={view.kind === 'template' && view.id === template.id}
              onClick={() => onViewChange({ kind: 'template', id: template.id })}
            />
          ))}

          {untemplated > 0 ? (
            <NavItem
              iconNode={<KeyRound className="size-4" />}
              label="No template"
              count={untemplated}
              active={view.kind === 'template' && view.id === ''}
              onClick={() => onViewChange({ kind: 'template', id: '' })}
            />
          ) : null}

          <li>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground w-full justify-start"
              onClick={onOpenTemplates}
            >
              <Layers className="size-4" />
              Manage templates
            </Button>
          </li>
        </NavGroup>

        {lastSync ? (
          <>
            <Separator className="my-2" />
            <div className="text-muted-foreground px-2 py-1 text-xs">
              <p className="font-medium">Last sync</p>
              <p>{new Date(lastSync.completedAt).toLocaleString()}</p>
            </div>
          </>
        ) : null}
      </nav>

      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground w-full justify-start"
          onClick={onOpenSettings}
        >
          <Settings className="size-4" />
          Settings
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground w-full justify-start"
          onClick={onLock}
        >
          <Unlock className="size-4" />
          Lock vault
        </Button>
      </div>
    </aside>
  )
}

function NavGroup({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-0.5">{children}</ul>
}

function NavItem({
  iconNode,
  label,
  count,
  active,
  emphasis,
  onClick,
}: {
  /**
   * A rendered node rather than a component type: passing a component type
   * would require constructing a new component on every render of this list.
   */
  iconNode: React.ReactNode
  label: string
  count: number
  active: boolean
  emphasis?: 'warning'
  onClick: () => void
}) {
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'hover:bg-sidebar-accent focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
              active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">{iconNode}</span>
            <span className="flex-1 truncate text-left">{label}</span>
            {count > 0 ? (
              <Badge
                variant={emphasis === 'warning' ? 'warning' : 'muted'}
                className="font-mono-numbers"
              >
                {count}
              </Badge>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </li>
  )
}

export type { VaultItem, VaultTemplate }