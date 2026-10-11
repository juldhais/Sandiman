import { cn } from '@/lib/cn'

/**
 * Skeleton placeholder.
 *
 * Used for vault content during unlock, where showing the real layout up front
 * avoids a jarring jump once decryption completes.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }