/**
 * Item detail view.
 *
 * Read-only presentation of every populated field, with copy buttons where the
 * field definition asked for one. Masked values render as text unless the user
 * reveals them individually, so an item with three secrets does not expose all
 * three at once.
 */
import { useMemo, useState } from 'react'
import { Eye, EyeOff, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { populatedFields, resolveFields } from '@/storage/templateEngine'
import type { ExpiryEntry } from '@/storage/expiry'
import type { VaultItem, VaultTemplate } from '@/storage/types'
import { useVaultStore } from '@/state/vaultStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CopyButton } from '@/components/CopyButton'
import { FieldDisplay } from '@/components/FieldControl'
import { PasswordInput } from '@/components/PasswordInput'
import { ExpiryBadge } from '@/components/ExpiryBadge'
import { TemplateIcon } from '@/components/TemplateIcon'

export interface ItemDetailProps {
  item: VaultItem
  template: VaultTemplate | null
  expiries: readonly ExpiryEntry[]
  onEdit: () => void
  onDelete: () => void
}

export function ItemDetail({ item, template, expiries, onEdit, onDelete }: ItemDetailProps) {
  const settings = useVaultStore((state) => state.settings)

  // Field ids the user has chosen to reveal. Reset when switching items so a
  // reveal never carries over.
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())

  const fields = useMemo(() => populatedFields(item, template), [item, template])
  const orphanedCount = useMemo(
    () => resolveFields(item, template).filter((field) => field.orphaned).length,
    [item, template],
  )

  const expiryByField = useMemo(
    () => new Map(expiries.map((entry) => [entry.fieldId, entry])),
    [expiries],
  )

  function toggleReveal(fieldId: string): void {
    setRevealed((current) => {
      const next = new Set(current)
      if (next.has(fieldId)) next.delete(fieldId)
      else next.add(fieldId)
      return next
    })
  }

  function openWebsite(): void {
    const url = item.values.url
    if (!url) return
    window.open(url.startsWith('http') ? url : `https://${url}`, '_blank', 'noopener,noreferrer')
  }

  const website = item.values.url

  return (
    <div className="scrollbar-slim h-full overflow-y-auto">
      <header className="bg-card/50 sticky top-0 z-10 flex items-start gap-3 border-b px-5 py-4 backdrop-blur">
        <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
          <TemplateIcon icon={template?.icon ?? 'Square'} className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{item.title || 'Untitled'}</h2>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span>{template?.name ?? 'No template'}</span>
            {item.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {website ? (
            <Button variant="ghost" size="icon-sm" onClick={openWebsite} aria-label="Open website">
              <ExternalLink />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit item">
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label="Delete item"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </header>

      <div className="space-y-6 p-5">
        {fields.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            This item has no values yet. Use Edit to add some.
          </p>
        ) : (
          <dl className="space-y-4">
            {fields.map((field) => {
              const expiry = expiryByField.get(field.id)
              const isSecret = field.def.type === 'masked'
              const isRevealed = revealed.has(field.id)

              return (
                <div key={field.id} className="space-y-1">
                  <dt className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                    {field.def.label}
                    {expiry ? <ExpiryBadge entry={expiry} /> : null}
                    {field.orphaned ? (
                      <Badge variant="muted" className="normal-case">
                        not in template
                      </Badge>
                    ) : null}
                  </dt>

                  <dd className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {isSecret ? (
                        <div className="space-y-1">
                          <PasswordInput
                            value={field.value}
                            readOnly
                            // Reveal is driven from this component so that
                            // switching items clears it; the field's own
                            // toggle is disabled to avoid two sources of truth.
                            revealable={false}
                            revealed={isRevealed}
                            className="border-transparent bg-muted/50 shadow-none"
                          />
                        </div>
                      ) : field.def.type === 'boolean' ? (
                        <span className="text-sm">{field.value === 'true' ? 'Yes' : 'No'}</span>
                      ) : field.def.type === 'note' ? (
                        <FieldDisplay value={field.value} type="note" />
                      ) : (
                        <span className="block text-sm break-words">
                          <FieldDisplay value={field.value} type={field.def.type} />
                        </span>
                      )}
                    </div>

                    {isSecret ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => toggleReveal(field.id)}
                        aria-label={isRevealed ? `Hide ${field.def.label}` : `Reveal ${field.def.label}`}
                        aria-pressed={isRevealed}
                      >
                        {isRevealed ? <EyeOff /> : <Eye />}
                      </Button>
                    ) : null}

                    {field.def.copyable ? (
                      <CopyButton
                        value={field.value}
                        // Only masked fields are treated as secrets; a username
                        // or cardholder name does not warrant clipboard wiping.
                        secret={isSecret}
                        label={field.def.label}
                        clearAfterSeconds={settings.clipboardClearSeconds}
                      />
                    ) : null}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}

        {item.notes.trim() ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Notes
              </h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.notes}</p>
            </div>
          </>
        ) : null}

        {orphanedCount > 0 ? (
          <p className="text-muted-foreground border-t pt-4 text-xs">
            {orphanedCount} field{orphanedCount === 1 ? '' : 's'} on this item no longer
            exist in the "{template?.name ?? 'template'}" definition. Their values are
            kept and shown above.
          </p>
        ) : null}

        <p className="text-muted-foreground border-t pt-4 text-xs">
          Updated {new Date(item.updatedAt).toLocaleString()} · Added{' '}
          {new Date(item.createdAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  )
}
