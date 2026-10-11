/**
 * Password input with a reveal toggle.
 *
 * Reveal state is local and resets whenever the value changes, so switching
 * between items cannot leave a previously viewed secret exposed.
 */
import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface PasswordInputProps
  extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Forces the field to render as masked regardless of `revealable`. */
  forceMasked?: boolean
  revealable?: boolean
}

export function PasswordInput({
  className,
  forceMasked = false,
  revealable = true,
  value,
  ...props
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false)

  // Reset on value change so a reveal never carries across entries.
  useEffect(() => {
    setRevealed(false)
  }, [value])

  const masked = forceMasked || !revealed

  return (
    <div className="relative w-full">
      <Input
        type={masked ? 'password' : 'text'}
        value={value}
        className={cn(revealable && 'pr-10 font-mono-numbers', className)}
        {...props}
      />
      {revealable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
          onClick={() => setRevealed((current) => !current)}
          aria-label={masked ? 'Reveal value' : 'Hide value'}
          aria-pressed={revealed}
        >
          {masked ? <Eye /> : <EyeOff />}
        </Button>
      ) : null}
    </div>
  )
}