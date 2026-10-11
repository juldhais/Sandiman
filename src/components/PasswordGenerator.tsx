/**
 * Password generator panel.
 *
 * Two presentations share one options object: a compact popover for use inside
 * forms, and a full panel for the sidebar. Both draw from the CSPRNG via
 * `generatePassword`.
 */
import { useMemo, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import { copyWithAutoClear } from '@/lib/clipboard'
import {
  DEFAULT_GENERATOR_OPTIONS,
  MAX_LENGTH,
  MIN_LENGTH,
  checkOptions,
  estimateStrength,
  generatePassword,
  type GeneratorOptions,
} from '@/generator/password'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CopyButton } from '@/components/CopyButton'
import { PasswordInput } from '@/components/PasswordInput'

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
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS)

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
            forceMasked={false}
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
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{strength.label}</span>
            <span className="text-muted-foreground font-mono-numbers">
              {password.length} chars
            </span>
          </div>
          <Progress
            value={(strength.score + 1) * 20}
            indicatorClassName={STRENGTH_COLORS[strength.score]}
            aria-label={`Password strength: ${strength.label}`}
          />
          {strength.warnings.length > 0 ? (
            <p className="text-muted-foreground text-xs">{strength.warnings[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="generator-length">Length</Label>
          <Badge variant="secondary" className="font-mono-numbers">
            {options.length}
          </Badge>
        </div>
        <Slider
          id="generator-length"
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          step={1}
          value={[options.length]}
          onValueChange={([value]) => update({ length: value ?? options.length })}
          aria-label="Password length"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Toggle
          label="Lowercase"
          checked={options.lowercase}
          onChange={(lowercase) => update({ lowercase })}
        />
        <Toggle
          label="Uppercase"
          checked={options.uppercase}
          onChange={(uppercase) => update({ uppercase })}
        />
        <Toggle
          label="Digits"
          checked={options.digits}
          onChange={(digits) => update({ digits })}
        />
        <Toggle
          label="Symbols"
          checked={options.symbols}
          onChange={(symbols) => update({ symbols })}
        />
      </div>

      <div className="space-y-3 border-t pt-3">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="generator-ambiguous" className="font-normal">
            Exclude ambiguous characters
          </Label>
          <Switch
            id="generator-ambiguous"
            checked={options.excludeAmbiguous}
            onCheckedChange={(excludeAmbiguous) => update({ excludeAmbiguous })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="generator-each-set" className="font-normal">
            Include every character set
          </Label>
          <Switch
            id="generator-each-set"
            checked={options.requireEachSet}
            onCheckedChange={(requireEachSet) => update({ requireEachSet })}
          />
        </div>
      </div>

      {check.error ? (
        <p className="text-destructive text-xs">
          {check.error === 'no-character-sets'
            ? 'Enable at least one character set.'
            : `Length must be at least ${check.minimumLength} to include every set.`}
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = `generator-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
    </div>
  )
}

/**
 * Small inline generator for use inside an item form's password field.
 *
 * Kept separate from the full panel so the form does not have to render every
 * option when the user only wants a one-off password.
 */
export function QuickGenerator({
  onUse,
  clearAfterSeconds = 30,
}: {
  onUse: (password: string) => void
  clearAfterSeconds?: number
}) {
  const [options] = useState<GeneratorOptions>({
    ...DEFAULT_GENERATOR_OPTIONS,
    length: 24,
  })
  const [password, setPassword] = useState(() => generatePassword(options))

  function regenerate(): void {
    if (checkOptions(options).error) return
    setPassword(generatePassword(options))
  }

  async function copyAndUse(): Promise<void> {
    await copyWithAutoClear(password, clearAfterSeconds)
    onUse(password)
    toast.success('Password copied and applied', {
      description: `Clipboard clears in ${clearAfterSeconds}s`,
    })
  }

  return (
    <div className="flex items-center gap-2">
      <PasswordInput
        value={password}
        readOnly
        className="h-8 font-mono text-xs"
        aria-label="Generated password"
      />
      <Button type="button" variant="outline" size="icon-sm" onClick={regenerate} aria-label="Regenerate">
        <RefreshCw />
      </Button>
      <Button type="button" size="sm" onClick={() => void copyAndUse()}>
        Use
      </Button>
    </div>
  )
}