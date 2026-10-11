/**
 * Expiry dashboard.
 *
 * Shows everything with a date field marked as an expiry, sorted by urgency.
 * The quick-filter thresholds match the sidebar filters so the two views agree
 * on what "expiring soon" means.
 */
import { useMemo, useState } from 'react'
import { CalendarClock, Inbox } from 'lucide-react'
import { formatExpiryBadge, type ExpiryEntry, type ExpirySummary } from '@/storage/expiry'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExpiryBadge } from '@/components/ExpiryBadge'

const THRESHOLDS = [30, 60, 90] as const

export function ExpiryDashboard({
  summary,
  onSelectItem,
}: {
  summary: ExpirySummary
  onSelectItem: (itemId: string) => void
}) {
  const [threshold, setThreshold] = useState<number | null>(null)

  const visible = useMemo(() => {
    if (threshold === null) return summary.needingAttention
    return summary.entries.filter(
      (entry) => entry.daysRemaining !== null && entry.daysRemaining <= threshold,
    )
  }, [summary, threshold])

  const attention = summary.expired + summary.critical + summary.warning

  if (summary.entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Inbox className="text-muted-foreground size-8" />
        <p className="text-sm font-medium">Nothing to track</p>
        <p className="text-muted-foreground max-w-xs text-sm">
          Mark a date or card-expiry field as an expiry on a template and items using it will
          appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="scrollbar-slim h-full overflow-y-auto">
      <div className="border-b p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarClock className="size-4" />
            Expiry
          </h2>
          {summary.expired > 0 ? (
            <Badge variant="destructive">{summary.expired} expired</Badge>
          ) : null}
          {summary.critical > 0 ? <Badge variant="destructive">{summary.critical} critical</Badge> : null}
          {summary.warning > 0 ? <Badge variant="warning">{summary.warning} soon</Badge> : null}
          {summary.unparseable > 0 ? (
            <Badge variant="muted">{summary.unparseable} unrecognised dates</Badge>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={threshold === null ? 'default' : 'outline'}
            onClick={() => setThreshold(null)}
          >
            Needs attention ({attention})
          </Button>
          {THRESHOLDS.map((days) => (
            <Button
              key={days}
              size="sm"
              variant={threshold === days ? 'default' : 'outline'}
              onClick={() => setThreshold(days)}
            >
              {days} days
            </Button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground p-8 text-center text-sm">
          Nothing falls in this range.
        </p>
      ) : (
        <ul className="divide-y">
          {visible.map((entry) => (
            <ExpiryRow key={`${entry.itemId}:${entry.fieldId}`} entry={entry} onSelect={onSelectItem} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ExpiryRow({
  entry,
  onSelect,
}: {
  entry: ExpiryEntry
  onSelect: (itemId: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(entry.itemId)}
        className="hover:bg-accent/50 flex w-full items-center gap-3 px-5 py-3 text-left transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.itemTitle}</p>
          <p className="text-muted-foreground text-xs">
            {entry.fieldLabel} · {entry.raw}
            {entry.expiresAt ? (
              <span className="ml-1">
                ({entry.expiresAt.toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })})
              </span>
            ) : null}
          </p>
        </div>
        <ExpiryBadge entry={entry} />
      </button>
    </li>
  )
}

export { formatExpiryBadge }
