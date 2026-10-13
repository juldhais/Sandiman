/**
 * The dynamic field renderer.
 *
 * One component turns a `FieldDef` into the right control, used by both the
 * item editor and the template preview. Adding a field type means adding a case
 * here and to the `FIELD_TYPES` union, nowhere else.
 */
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PasswordInput } from '@/components/PasswordInput'
import { QuickGenerator } from '@/components/PasswordGenerator'
import { formatCardExpiryInput } from '@/storage/cardExpiry'
import { formatExpiryDateInput } from '@/storage/dateExpiry'
import type { FieldDef } from '@/storage/types'

export interface FieldControlProps {
  def: FieldDef
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** Called when the user applies a generated password. */
  onGenerate?: (password: string) => void
  clearAfterSeconds?: number
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

export function FieldControl({
  def,
  value,
  onChange,
  onBlur,
  onGenerate,
  clearAfterSeconds,
  id,
  ...aria
}: FieldControlProps) {
  switch (def.type) {
    case 'masked':
      return (
        <PasswordInput
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={def.placeholder}
          autoComplete="off"
          spellCheck={false}
          endAdornment={
            onGenerate ? (
              <QuickGenerator onUse={onGenerate} clearAfterSeconds={clearAfterSeconds} />
            ) : undefined
          }
          {...aria}
        />
      )

    case 'note':
      return (
        <Textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={def.placeholder}
          rows={4}
          className="min-h-24 resize-y"
          {...aria}
        />
      )

    case 'number':
      return (
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={def.placeholder}
          className="font-mono-numbers"
          {...aria}
        />
      )

    case 'date':
      // A free-text field rather than `type="date"`: stored dates are often
      // partial ("04/28") or non-ISO, and a native date input cannot represent
      // that without silently discarding it.
      return (
        <Input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={def.placeholder ?? 'YYYY-MM-DD'}
          className="font-mono-numbers"
          {...aria}
        />
      )

    case 'cardExpiry':
      return (
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={value}
          onChange={(event) => onChange(formatCardExpiryInput(event.target.value))}
          onBlur={onBlur}
          placeholder={def.placeholder ?? 'MM/YY'}
          className="font-mono-numbers"
          {...aria}
        />
      )

    case 'expiryDate':
      return (
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          maxLength={10}
          value={value}
          onChange={(event) => onChange(formatExpiryDateInput(event.target.value))}
          onBlur={onBlur}
          placeholder={def.placeholder ?? 'DD/MM/YYYY'}
          className="font-mono-numbers"
          {...aria}
        />
      )

    case 'url':
      return (
        <Input
          id={id}
          type="url"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={def.placeholder ?? 'https://'}
          autoCapitalize="none"
          spellCheck={false}
          {...aria}
        />
      )

    case 'boolean':
      return (
        <div className="flex h-9 items-center gap-2">
          <Checkbox
            id={id}
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked === true ? 'true' : '')}
            onBlur={onBlur}
            {...aria}
          />
          <span className="text-muted-foreground text-sm">{value === 'true' ? 'Yes' : 'No'}</span>
        </div>
      )

    case 'text':
    default:
      return (
        <Input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={def.placeholder}
          spellCheck={false}
          {...aria}
        />
      )
  }
}

/** Read-only rendering of a stored value, used by the detail view. */
export function FieldDisplay({ value, type }: { value: string; type: FieldDef['type'] }) {
  if (type === 'boolean') return <>{value === 'true' ? 'Yes' : 'No'}</>

  if (type === 'note') {
    return (
      <p className="text-foreground/90 text-sm leading-relaxed whitespace-pre-wrap break-words">
        {value}
      </p>
    )
  }

  if (type === 'url') {
    return (
      <a
        href={value.startsWith('http') ? value : `https://${value}`}
        target="_blank"
        rel="noreferrer noopener"
        className="text-primary hover:underline break-all"
      >
        {value}
      </a>
    )
  }

  return (
    <span
      className={
        type === 'number' || type === 'date' || type === 'cardExpiry' || type === 'expiryDate'
          ? 'font-mono-numbers'
          : undefined
      }
    >
      {value}
    </span>
  )
}
