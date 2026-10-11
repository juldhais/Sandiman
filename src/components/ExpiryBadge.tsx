/**
 * Expiry badge.
 *
 * Maps the four attention tiers onto the badge variants so an expired card and
 * a card expiring in two months never look alike at a glance.
 */
import { AlertTriangle, CalendarClock, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { VariantProps } from 'class-variance-authority'
import { badgeVariants } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatExpiryBadge, type ExpiryEntry, type ExpiryStatus } from '@/storage/expiry'

const VARIANT_BY_STATUS: Record<ExpiryStatus, VariantProps<typeof badgeVariants>['variant']> = {
  expired: 'destructive',
  critical: 'destructive',
  warning: 'warning',
  ok: 'muted',
  unparseable: 'muted',
}

const ICON_BY_STATUS: Record<ExpiryStatus, typeof AlertTriangle> = {
  expired: AlertTriangle,
  critical: AlertTriangle,
  warning: CalendarClock,
  ok: CheckCircle2,
  unparseable: CalendarClock,
}

/** One-line explanation shown on hover. */
function describe(entry: ExpiryEntry): string {
  if (entry.status === 'unparseable') {
    return `${entry.fieldLabel}: "${entry.raw}" is not a date this app recognises.`
  }
  if (entry.status === 'expired') {
    const days = Math.abs(entry.daysRemaining ?? 0)
    return `${entry.fieldLabel} expired ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}.`
  }
  if (entry.status === 'ok') {
    return `${entry.fieldLabel} is valid for another ${entry.daysRemaining} days.`
  }
  return `${entry.fieldLabel} expires in ${entry.daysRemaining} day${entry.daysRemaining === 1 ? '' : 's'}.`
}

export function ExpiryBadge({
  entry,
  showLabel = false,
}: {
  entry: ExpiryEntry
  showLabel?: boolean
}) {
  const Icon = ICON_BY_STATUS[entry.status]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={VARIANT_BY_STATUS[entry.status]} className="gap-1">
          <Icon />
          {showLabel ? `${entry.fieldLabel} ` : null}
          {formatExpiryBadge(entry)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{describe(entry)}</TooltipContent>
    </Tooltip>
  )
}