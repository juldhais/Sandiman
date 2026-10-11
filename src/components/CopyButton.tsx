/**
 * Click-to-copy control.
 *
 * Secrets go through the auto-clearing clipboard path; non-secrets such as
 * usernames are copied plainly, because overwriting a user's clipboard to
 * clear "alice@example.com" would be pure friction.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import { copyPlain, copyWithAutoClear } from '@/lib/clipboard'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  /** The text to place on the clipboard. */
  value: string
  /**
   * When true the value is treated as a secret: it is cleared from the
   * clipboard on a timer and never logged in the toast.
   */
  secret?: boolean
  /** Label shown in the tooltip and the success toast. */
  label: string
  /** Seconds before the clipboard is overwritten. Zero disables auto-clear. */
  clearAfterSeconds?: number
  onCopied?: () => void
}

export function CopyButton({
  value,
  secret = false,
  label,
  clearAfterSeconds = 30,
  onCopied,
  className,
  variant = 'ghost',
  size = 'icon-sm',
  disabled,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the checkmark even if the component unmounts mid-window.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  async function handleCopy(): Promise<void> {
    const result = secret
      ? await copyWithAutoClear(value, clearAfterSeconds)
      : { ok: await copyPlain(value), willAutoClear: false }

    if (!result.ok) {
      toast.error('Could not copy', { description: result.error })
      return
    }

    setCopied(true)
    onCopied?.()

    // Deliberately does not echo the value: toasts can be captured by
    // screen recorders and notification history.
    toast.success(`${label} copied`, {
      description: result.willAutoClear
        ? `Clipboard clears in ${clearAfterSeconds}s`
        : undefined,
    })

    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={cn(className)}
          disabled={disabled || value.length === 0}
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          onClick={handleCopy}
          {...props}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : `Copy ${label}`}</TooltipContent>
    </Tooltip>
  )
}