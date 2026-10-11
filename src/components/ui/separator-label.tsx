import { cn } from '@/lib/cn'

/** Horizontal rule with optional centred label, used to break up long dialogs. */
function SeparatorLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('relative my-1 flex items-center', className)}>
      <span className="bg-border h-px w-full" />
      <span className="text-muted-foreground bg-background absolute left-1/2 -translate-x-1/2 px-2 text-xs tracking-wide uppercase">
        {children}
      </span>
      <span className="bg-border h-px w-full" />
    </div>
  )
}

export { SeparatorLabel }