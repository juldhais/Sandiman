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
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { slugify, uniqueId } from '@/lib/id'
import {
  buildFieldSchema,
  createItem,
  resolveFields,
  suggestTitle,
  type ResolvedField,
} from '@/storage/templateEngine'
import { FIELD_TYPES } from '@/storage/types'
import type { CustomField, FieldType, VaultItem, VaultTemplate } from '@/storage/types'
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

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  masked: 'Password (masked)',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes / No',
  url: 'URL',
  note: 'Multi-line note',
}

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
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => item?.fieldOrder ?? [])
  const [removedFieldIds, setRemovedFieldIds] = useState<string[]>([])
  const [editingFields, setEditingFields] = useState(false)

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

  const itemForFields = useMemo(
    () => ({
      ...baseItem,
      templateId: activeTemplate?.id ?? null,
      customFields: draftFields,
      fieldOrder,
    }),
    [baseItem, activeTemplate, draftFields, fieldOrder],
  )

  const allResolved: ResolvedField[] = useMemo(
    () => resolveFields(itemForFields, activeTemplate),
    [itemForFields, activeTemplate],
  )

  const resolved: ResolvedField[] = useMemo(
    () => allResolved.filter((field) => !removedFieldIds.includes(field.id)),
    [allResolved, removedFieldIds],
  )

  /**
   * Every field in this form holds a string, including booleans, which are
   * stored as `"true"`/`""` so that a blank value round-trips as "unset" rather
   * than as `false`. That is what lets the collect helper distinguish cleared
   * fields from absent ones.
   */
  type FormValues = Record<string, string>

  const schema = useMemo(
    () => buildFieldSchema(resolved.map((field) => field.def)) as unknown as z.ZodType<FormValues, FormValues>,
    [resolved],
  )

  const defaultValues = useMemo(() => {
    const initial: Record<string, string> = {}
    for (const field of allResolved) {
      initial[field.id] = field.value
    }
    if (item) initial.__notes = item.notes
    return initial
  }, [allResolved, item])

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
        values: collect(
          input,
          allResolved.filter((field) => !field.custom && !removedFieldIds.includes(field.id)),
        ),
        customFields: draftFields
          .filter((custom) => !removedFieldIds.includes(custom.id))
          .map((custom) => ({
            ...custom,
            value: input[custom.id] ?? custom.value,
          })),
        fieldOrder: resolved.map((field) => field.id),
        tags,
        title: suggestTitle(resolved.map((f) => ({ ...f, value: input[f.id] ?? f.value }))),
        notes: input.__notes ?? '',
      })
      toast.success('Item added')
    } else {
      await saveItemFromForm(
        itemForFields,
        activeTemplate,
        input,
        item!.title,
        tags,
        input.__notes ?? '',
        draftFields,
        resolved.map((field) => field.id),
        removedFieldIds,
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

  function moveField(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= resolved.length) return
    const next = resolved.map((field) => field.id)
    const current = next[index]!
    next[index] = next[target]!
    next[target] = current
    const visibleIds = new Set(next)
    setFieldOrder((previous) => [...next, ...previous.filter((id) => !visibleIds.has(id))])
  }

  function addDraftField(): void {
    const id = uniqueId(slugify('custom field'), allResolved.map((field) => field.id))
    const field: CustomField = {
      id,
      label: `Custom field ${draftFields.length + 1}`,
      type: 'text',
      required: false,
      copyable: true,
      expiry: false,
      value: '',
    }
    setDraftFields((current) => [...current, field])
    setFieldOrder([...resolved.map((resolvedField) => resolvedField.id), id])
    // Register so react-hook-form tracks the new input.
    form.register(id as keyof FormValues)
  }

  function updateDraftField(id: string, changes: Partial<CustomField>): void {
    setDraftFields((current) =>
      current.map((field) => (field.id === id ? { ...field, ...changes } : field)),
    )
  }

  function removeField(id: string): void {
    setRemovedFieldIds((current) => (current.includes(id) ? current : [...current, id]))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b p-6 pb-4">
          <DialogTitle>{isNew ? 'Add item' : `Edit ${item!.title || 'item'}`}</DialogTitle>
          <DialogDescription>
            {isNew
              ? 'Use Edit Fields to reorder, add, or remove fields. Removed fields are permanently deleted when you save.'
              : 'Changes are encrypted when saved. Removed fields and their values are permanently deleted from this item.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="item-form"
          onSubmit={handleSubmit}
          className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto p-6"
        >
          <div className="space-y-2">
            <Label htmlFor="item-template">Template</Label>
            <Select
              value={templateId}
              onValueChange={(nextTemplateId) => {
                setTemplateId(nextTemplateId)
                // Per-item field choices belong to the selected template.
                setFieldOrder([])
                setRemovedFieldIds([])
              }}
            >
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

          {editingFields ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
              Removed fields and their saved values are permanently deleted from this item when you save.
            </p>
          ) : null}

          {resolved.map((field, index) => {
            const error = form.formState.errors[field.id as keyof FormValues]

            return (
              <div key={field.id} className="bg-card space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  {editingFields ? (
                    <div className="flex shrink-0 flex-col">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6"
                        onClick={() => moveField(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${field.def.label} up`}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6"
                        onClick={() => moveField(index, 1)}
                        disabled={index === resolved.length - 1}
                        aria-label={`Move ${field.def.label} down`}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  ) : null}

                  {field.custom ? (
                    <div className="min-w-0 flex-1 space-y-1">
                      {editingFields ? (
                        <>
                          <Label htmlFor={`${field.id}-label`}>Field name</Label>
                          <Input
                            id={`${field.id}-label`}
                            value={draftFields.find((custom) => custom.id === field.id)?.label ?? field.def.label}
                            onChange={(event) => updateDraftField(field.id, { label: event.target.value })}
                          />
                        </>
                      ) : (
                        <Label htmlFor={field.id}>{field.def.label}</Label>
                      )}
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={field.id}>
                        {field.def.label}
                        {field.def.required ? <span className="text-destructive"> *</span> : null}
                      </Label>
                      {field.orphaned ? (
                        <span className="text-muted-foreground ml-2 text-xs">
                          (not in this template)
                        </span>
                      ) : null}
                    </div>
                  )}

                  {editingFields && field.custom ? (
                    <Select
                      value={field.def.type}
                      onValueChange={(type: FieldType) => updateDraftField(field.id, { type })}
                    >
                      <SelectTrigger className="w-36" aria-label={`${field.def.label} type`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {FIELD_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {editingFields ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeField(field.id)}
                      aria-label={`Remove ${field.def.label} from this item`}
                    >
                      <Trash2 />
                    </Button>
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
              No fields are on this item. Use Edit Fields to add one.
            </p>
          ) : null}

          {editingFields ? (
            <Button type="button" variant="outline" size="sm" onClick={addDraftField}>
              <Plus />
              Add field
            </Button>
          ) : null}

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

        <DialogFooter className="shrink-0 border-t p-6 pt-4 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditingFields((current) => !current)}
          >
            {editingFields ? 'Done' : 'Edit Fields'}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {/* Outside the form element, so it is associated via the form attribute. */}
            <Button type="submit" form="item-form">
              {isNew ? 'Add item' : 'Save changes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
