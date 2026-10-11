/**
 * Password input with a reveal toggle.
 *
 * Reveal state is local and resets whenever the value changes, so switching
 * between items cannot leave a previously viewed secret exposed.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface PasswordInputProps
  extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Forces the field to render as masked regardless of `revealable`. */
  forceMasked?: boolean
  revealable?: boolean
  /** Controls the revealed state when an enclosing view owns the reveal button. */
  revealed?: boolean
  /** Initial local reveal state, reapplied when the input value changes. */
  defaultRevealed?: boolean
  /** Optional control placed after the reveal button inside the input. */
  endAdornment?: ReactNode
}

export function PasswordInput({
  className,
  forceMasked = false,
  revealable = true,
  revealed: controlledRevealed,
  defaultRevealed = false,
  endAdornment,
  value,
  ...props
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(defaultRevealed)

  // Reset on value change so a reveal never carries across entries.
  useEffect(() => {
    setRevealed(defaultRevealed)
  }, [value, defaultRevealed])

  const masked = forceMasked || !(controlledRevealed ?? revealed)

  return (
    <div className="relative w-full">
      <Input
        type={masked ? 'password' : 'text'}
        value={value}
        className={cn(
          revealable && (endAdornment ? 'pr-20 font-mono-numbers' : 'pr-10 font-mono-numbers'),
          className,
        )}
        {...props}
      />
      {revealable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            'absolute top-1/2 -translate-y-1/2 text-muted-foreground',
            endAdornment ? 'right-10' : 'right-1',
          )}
          onClick={() => setRevealed((current) => !current)}
          aria-label={masked ? 'Reveal value' : 'Hide value'}
          aria-pressed={revealed}
        >
          {masked ? <Eye /> : <EyeOff />}
        </Button>
      ) : null}
      {endAdornment ? (
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
          {endAdornment}
        </div>
      ) : null}
    </div>
  )
}
