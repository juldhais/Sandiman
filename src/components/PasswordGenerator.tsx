/**
 * Password generator panel.
 *
 * Two presentations share one options object: a compact popover for use inside
 * forms, and a full panel for the sidebar. Both draw from the CSPRNG via
 * `generatePassword`.
 */
import { useId, useMemo, useState } from 'react'
import { Check, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import { copyWithAutoClear } from '@/lib/clipboard'
import {
  DEFAULT_GENERATOR_OPTIONS,
  MAX_SLIDER_LENGTH,
  MIN_LENGTH,
  checkOptions,
  estimateStrength,
  generatePassword,
  optionsForPasswordType,
  type GeneratorOptions,
  type PasswordType,
} from '@/generator/password'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CopyButton } from '@/components/CopyButton'
import { PasswordInput } from '@/components/PasswordInput'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const STRENGTH_COLORS = [
  'bg-destructive',
  'bg-destructive',
  'bg-warning',
  'bg-success',
  'bg-success',
]

export interface PasswordGeneratorProps {
  /** When supplied, each regenerate calls back so a form can adopt the value. */
  onUse?: (password: string) => void
  className?: string
  clearAfterSeconds?: number
}

export function PasswordGenerator({
  onUse,
  className,
  clearAfterSeconds = 30,
}: PasswordGeneratorProps) {
  const generatorId = useId().replace(/:/g, '')
  const [passwordType, setPasswordType] = useState<PasswordType>('random')
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS)
  const [lengthText, setLengthText] = useState(String(DEFAULT_GENERATOR_OPTIONS.length))

  // The password is stored in state rather than derived, so regenerating
  // requires an explicit action and does not reroll under the user's cursor.
  const [password, setPassword] = useState(() =>
    generatePassword(DEFAULT_GENERATOR_OPTIONS),
  )

  const check = useMemo(() => checkOptions(options), [options])
  const strength = useMemo(() => estimateStrength(password), [password])

  function regenerate(next: GeneratorOptions = options): void {
    const result = checkOptions(next)
    if (result.error) {
      toast.error('Cannot generate a password', { description: result.minimumLength })
      return
    }
    setOptions(next)
    setPassword(generatePassword(next))
  }

  function update(changes: Partial<GeneratorOptions>): void {
    const next = { ...options, ...changes }
    const result = checkOptions(next)
    // Keep the change even when it makes generation impossible, so the user
    // can see the constraint rather than having the toggle silently revert.
    setOptions(next)
    if (!result.error) setPassword(generatePassword(next))
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <PasswordInput
            value={password}
            readOnly
            defaultRevealed
            className="font-mono"
            spellCheck={false}
            aria-label="Generated password"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => regenerate()}
            aria-label="Generate a new password"
            title="Generate again"
          >
            <RefreshCw />
          </Button>
          <CopyButton
            value={password}
            secret
            label="Password"
            clearAfterSeconds={clearAfterSeconds}
            size="icon"
            variant="outline"
          />
        </div>

        <div className="space-y-1.5">
          <Progress
            value={(strength.score + 1) * 20}
            className="h-1.5"
            indicatorClassName={STRENGTH_COLORS[strength.score]}
            aria-label={`Password strength: ${strength.label}`}
          />
          <p className="text-muted-foreground text-xs">
            {strength.label} · {password.length} characters
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${generatorId}-type`}>Password type</Label>
        <Select
          value={passwordType}
          onValueChange={(type: PasswordType) => {
            setPasswordType(type)
            update(optionsForPasswordType(options, type))
          }}
        >
          <SelectTrigger id={`${generatorId}-type`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="letters-and-numbers">Letters and numbers</SelectItem>
            <SelectItem value="letters-only">Letters only</SelectItem>
            <SelectItem value="numbers-only">Numbers only</SelectItem>
            <SelectItem value="random">Random</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${generatorId}-length`}>Length</Label>
          <Input
            id={`${generatorId}-length`}
            type="number"
            inputMode="numeric"
            min={MIN_LENGTH}
            step={1}
            value={lengthText}
            onChange={(event) => {
              const nextText = event.target.value
              setLengthText(nextText)
              update({ length: nextText === '' ? 0 : Number(nextText) })
            }}
            onBlur={() => {
              const parsed = Number(lengthText)
              const nextLength = Number.isFinite(parsed)
                ? Math.max(MIN_LENGTH, Math.trunc(parsed))
                : MIN_LENGTH
              setLengthText(String(nextLength))
              if (nextLength !== options.length) update({ length: nextLength })
            }}
            className="w-24 text-right font-mono-numbers"
            aria-label="Password length"
          />
        </div>
        <Slider
          id={`${generatorId}-length-slider`}
          min={MIN_LENGTH}
          max={MAX_SLIDER_LENGTH}
          step={1}
          value={[Math.min(MAX_SLIDER_LENGTH, Math.max(MIN_LENGTH, options.length))]}
          onValueChange={([value]) => {
            const nextLength = value ?? options.length
            setLengthText(String(nextLength))
            update({ length: nextLength })
          }}
          aria-label="Password length slider"
        />
        <p className="text-muted-foreground text-xs">
          Use the slider up to {MAX_SLIDER_LENGTH}, or type a longer length.
        </p>
      </div>

      <div className="space-y-3 border-t pt-3">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`${generatorId}-ambiguous`} className="font-normal">
            Exclude ambiguous characters
          </Label>
          <Switch
            id={`${generatorId}-ambiguous`}
            checked={options.excludeAmbiguous}
            onCheckedChange={(excludeAmbiguous) => update({ excludeAmbiguous })}
          />
        </div>
      </div>

      {check.error ? (
        <p className="text-destructive text-xs">
          {check.error === 'no-character-sets'
            ? 'Enable at least one character set.'
            : check.error === 'invalid-length'
              ? 'Length must be a whole number.'
              : `Length must be at least ${check.minimumLength} characters.`}
        </p>
      ) : null}

      {onUse ? (
        <Button
          type="button"
          className="w-full"
          disabled={Boolean(check.error)}
          onClick={() => {
            onUse(password)
            toast.success('Password applied')
          }}
        >
          <Check />
          Use this password
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Configurable password generator in a popover for an item's password field.
 */
export function QuickGenerator({
  onUse,
  clearAfterSeconds = 30,
}: {
  onUse: (password: string) => void
  clearAfterSeconds?: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Open password generator"
          title="Open password generator"
        >
          <Sparkles />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="max-h-[min(80dvh,42rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <PasswordGenerator
          clearAfterSeconds={clearAfterSeconds}
          onUse={(password) => {
            onUse(password)
            void copyWithAutoClear(password, clearAfterSeconds)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
