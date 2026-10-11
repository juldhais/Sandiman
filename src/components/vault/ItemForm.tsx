/**
 * Item editor dialog.
 *
 * The form is generated from the item's template rather than hand-written per
 * template, and validated by a zod schema built from the same field
 * definitions. Adding a field to a template makes it appear here with no code
 * change.
 */
import { useMemo, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { slugify, uniqueId } from '@/lib/id'
import {
  buildItemSchema,
  createItem,
  resolveFields,
  suggestTitle,
  type ResolvedField,
} from '@/storage/templateEngine'
import type { CustomField, VaultItem, VaultTemplate } from '@/storage/types'
import { useVaultStore } from '@/state/vaultStore'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SeparatorLabel } from '@/components/ui/separator-label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FieldControl } from '@/components/FieldControl'
import { QuickGenerator } from '@/components/PasswordGenerator'

const NO_TEMPLATE = '__none__'

export interface ItemFormProps {
  /** Null when creating; set when editing. */
  item: VaultItem | null
  template: VaultTemplate | null
  templates: readonly VaultTemplate[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ItemForm({ item, template, templates, open, onOpenChange }: ItemFormProps) {
  const addItem = useVaultStore((state) => state.addItem)
  
  const saveItemFromForm = useVaultStore((state) => state.saveItemFromForm)
  const settings = useVaultStore((state) => state.settings)

  const isNew = item === null

  // Draft ad-hoc fields live outside the store until the form is submitted, so
  // abandoning the dialog leaves no trace.
  const [draftFields, setDraftFields] = useState<CustomField[]>(() => item?.customFields ?? [])
  const [templateId, setTemplateId] = useState<string>(template?.id ?? item?.templateId ?? NO_TEMPLATE)
  const [tagText, setTagText] = useState(() => item?.tags.join(', ') ?? '')

  const activeTemplate =
    templates.find((candidate) => candidate.id === templateId && candidate.id !== NO_TEMPLATE) ??
    template ??
    null

  // The base item the form edits: the real one, or a blank bound to the chosen
  // template.
  const baseItem = useMemo(
    () => item ?? createItem(activeTemplate?.id ?? null),
    // A fresh id is generated per mount, not per render, so keying on
    // `templateId` alone is what re-seeds it when the user switches templates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, activeTemplate?.id],
  )

  const resolved: ResolvedField[] = useMemo(
    () => resolveFields(baseItem, activeTemplate),
    [baseItem, activeTemplate],
  )

  /**
   * Every field in this form holds a string, including booleans, which are
   * stored as `"true"`/`""` so that a blank value round-trips as "unset" rather
   * than as `false`. That is what lets `collectValues` distinguish cleared
   * fields from absent ones.
   */
  type FormValues = Record<string, string>

  const schema = useMemo(
    () => buildItemSchema(baseItem, activeTemplate) as unknown as z.ZodType<FormValues, FormValues>,
    [baseItem, activeTemplate],
  )

  const defaultValues = useMemo(() => {
    const initial: Record<string, string> = {}
    for (const field of resolved) {
      initial[field.id] = field.value
    }
    if (item) initial.__notes = item.notes
    return initial
  }, [resolved, item])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues,
    mode: 'onSubmit',
  })

  const values = form.watch()

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const valid = await form.trigger()
    if (!valid) {
      toast.error('Check the highlighted fields')
      return
    }

    const input = form.getValues()
    const tags = tagText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)

    if (isNew) {
      await addItem({
        ...baseItem,
        templateId: activeTemplate?.id ?? null,
        values: collect(input, resolved),
        customFields: draftFields.map((custom) => ({ ...custom, value: input[custom.id] ?? '' })),
        tags,
        title: suggestTitle(resolved.map((f) => ({ ...f, value: input[f.id] ?? f.value }))),
        notes: input.__notes ?? '',
      })
      toast.success('Item added')
    } else {
      await saveItemFromForm(
        baseItem,
        activeTemplate,
        input,
        item!.title,
        tags,
        input.__notes ?? '',
      )
      toast.success('Item saved')
    }

    onOpenChange(false)
  }

  function collect(input: FormValues, fields: ResolvedField[]): Record<string, string> {
    const map: Record<string, string> = {}
    for (const field of fields) {
      const value = input[field.id]
      if (typeof value === 'string' && value.length > 0) map[field.id] = value
    }
    return map
  }

  function addDraftField(): void {
    const id = uniqueId(
      slugify('custom field'),
      draftFields.map((field) => field.id),
    )
    setDraftFields((current) => [
      ...current,
      {
        id,
        label: `Custom field ${current.length + 1}`,
        type: 'text',
        required: false,
        copyable: true,
        expiry: false,
        value: '',
      },
    ])
    // Register so react-hook-form tracks the new input.
    form.register(id as keyof FormValues)
  }

  function removeDraftField(id: string): void {
    setDraftFields((current) => current.filter((field) => field.id !== id))
    form.unregister(id as keyof FormValues)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle>{isNew ? 'Add item' : `Edit ${item!.title || 'item'}`}</DialogTitle>
          <DialogDescription>
            {isNew
              ? 'Fields come from the template. Add extra fields for this item only if you need them.'
              : 'Changes are encrypted and saved to this device immediately.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="item-form"
          onSubmit={handleSubmit}
          className="scrollbar-slim flex-1 space-y-4 overflow-y-auto p-6"
        >
          <div className="space-y-2">
            <Label htmlFor="item-template">Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="item-template" className="w-full">
                <SelectValue placeholder="Choose a template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>No template (ad-hoc)</SelectItem>
                {templates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {resolved.map((field) => {
            const error = form.formState.errors[field.id as keyof FormValues]

            return (
              <div key={field.id} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor={field.id}>
                    {field.def.label}
                    {field.def.required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  {field.orphaned ? (
                    <span className="text-muted-foreground text-xs">
                      (not in this template)
                    </span>
                  ) : null}
                </div>

                <FieldControl
                  id={field.id}
                  def={field.def}
                  value={values[field.id] ?? ''}
                  onChange={(value) => form.setValue(field.id as keyof FormValues, value)}
                  onBlur={() => form.trigger(field.id as keyof FormValues)}
                  onGenerate={undefined}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${field.id}-error` : undefined}
                />

                {error ? (
                  <p id={`${field.id}-error`} className="text-destructive text-xs">
                    {error.message}
                  </p>
                ) : null}

                {field.def.type === 'masked' ? (
                  <QuickGenerator
                    clearAfterSeconds={settings.clipboardClearSeconds}
                    onUse={(password) => form.setValue(field.id as keyof FormValues, password)}
                  />
                ) : null}
              </div>
            )
          })}

          {resolved.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              This template has no fields. Add a custom field below, or pick a different template.
            </p>
          ) : null}

          <SeparatorLabel>Custom fields</SeparatorLabel>

          {draftFields.map((custom) => (
            <div key={custom.id} className="space-y-1.5">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor={`${custom.id}-label`}>Label</Label>
                  <Input
                    id={`${custom.id}-label`}
                    value={custom.label}
                    onChange={(event) =>
                      setDraftFields((current) =>
                        current.map((field) =>
                          field.id === custom.id ? { ...field, label: event.target.value } : field,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => removeDraftField(custom.id)}
                  aria-label={`Remove ${custom.label}`}
                >
                  <Trash2 />
                </Button>
              </div>
              <FieldControl
                id={custom.id}
                def={custom}
                value={values[custom.id] ?? ''}
                onChange={(value) => form.setValue(custom.id as keyof FormValues, value)}
              />
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={addDraftField}>
            <Plus />
            Add custom field
          </Button>

          <SeparatorLabel>Details</SeparatorLabel>

          <div className="space-y-1.5">
            <Label htmlFor="item-tags">Tags</Label>
            <Input
              id="item-tags"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              placeholder="work, personal, finance"
            />
            <p className="text-muted-foreground text-xs">Comma separated.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="__notes">Notes</Label>
            <Textarea
              id="__notes"
              value={values.__notes ?? item?.notes ?? ''}
              onChange={(event) => form.setValue('__notes', event.target.value)}
              rows={3}
            />
          </div>
        </form>

        <DialogFooter className="border-t p-6 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {/* Outside the form element, so it is associated via the form attribute. */}
          <Button type="submit" form="item-form">
            {isNew ? 'Add item' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}