/**
 * Template builder.
 *
 * Editing a template changes definitions only. Existing items keep their values
 * keyed by field id, so removing a field here orphans that data rather than
 * destroying it — the item views surface orphans instead of silently dropping
 * them. The panel says so explicitly for the same reason.
 */
import { useMemo, useState } from 'react'
import {
  Copy,
  GripVertical,
  Info,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import { newId, slugify, uniqueId } from '@/lib/id'
import { FIELD_TYPES, type FieldDef, type FieldType, type VaultTemplate } from '@/storage/types'
import { isBuiltinTemplateId } from '@/storage/builtins'
import { useVaultStore } from '@/state/vaultStore'
import { ICON_CHOICES } from '@/components/icon-registry'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TemplateIcon } from '@/components/TemplateIcon'

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  masked: 'Password (masked)',
  number: 'Number',
  date: 'Date',
  cardExpiry: 'Card expiry (MM/YY)',
  expiryDate: 'Expiry Date (DD/MM/YYYY)',
  boolean: 'Yes / No',
  url: 'URL',
  note: 'Multi-line note',
}

export function TemplateManager({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const templates = useVaultStore((state) => state.templates)
  const updateTemplate = useVaultStore((state) => state.updateTemplate)
  const deleteTemplate = useVaultStore((state) => state.deleteTemplate)
  const duplicateTemplate = useVaultStore((state) => state.duplicateTemplate)

  // Selection is internal: the sheet owns the list-to-editor transition.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const live = useMemo(() => templates.filter((template) => !template.deleted), [templates])
  const editing = live.find((template) => template.id === selectedId) ?? null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Reset selection when the sheet closes so it reopens on the list.
        if (!next) setSelectedId(null)
        onOpenChange(next)
      }}
    >
      <SheetContent side="right" className="p-0">
        {editing ? (
          <TemplateEditor
            key={editing.id}
            template={editing}
            onCancel={() => setSelectedId(null)}
            onSave={async (changes) => {
              await updateTemplate(editing.id, changes)
              toast.success('Template saved')
              setSelectedId(null)
            }}
          />
        ) : (
          <TemplateList
            templates={live}
            onEdit={setSelectedId}
            onDelete={async (template) => {
              await deleteTemplate(template.id)
              toast.success(`Deleted "${template.name}"`, {
                description: 'Items using it are kept and become template-less.',
              })
            }}
            onDuplicate={async (template) => {
              const copy = await duplicateTemplate(template.id)
              if (copy) toast.success(`Duplicated as "${copy.name}"`)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** List view: choose a template to edit, or create a new one. */
function TemplateList({
  templates,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  templates: readonly VaultTemplate[]
  onEdit: (id: string) => void
  onDelete: (template: VaultTemplate) => void
  onDuplicate: (template: VaultTemplate) => void
}) {
  const addTemplate = useVaultStore((state) => state.addTemplate)
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <>
      <SheetHeader>
        <SheetTitle>Templates</SheetTitle>
        <SheetDescription>
          Templates define which fields an item has. Built-in templates cannot be
          deleted. Create a standalone note from the Notes section.
        </SheetDescription>
      </SheetHeader>

      <div className="scrollbar-slim flex-1 space-y-2 overflow-y-auto p-4">
        {templates.map((template) => (
          <div key={template.id} className="bg-card rounded-lg border p-3">
            <div className="flex items-start gap-3">
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                <TemplateIcon icon={template.icon} className="size-4" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{template.name}</span>
                  {template.builtIn ? (
                    <Badge variant="muted">built-in</Badge>
                  ) : (
                    <Badge variant="secondary">custom</Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {template.fields.length} field{template.fields.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => onEdit(template.id)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void onDuplicate(template)}>
                <Copy />
                Duplicate
              </Button>

              {isBuiltinTemplateId(template.id) ? null : confirming === template.id ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      void onDelete(template)
                      setConfirming(null)
                    }}
                  >
                    Confirm delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(template.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 />
                  Delete
                </Button>
              )}
            </div>
          </div>
        ))}

        <NewTemplateForm
          onCreate={async (definition) => {
            const created = await addTemplate(definition)
            toast.success(`Created "${created?.name ?? 'template'}"`)
          }}
        />
      </div>
    </>
  )
}

/** Inline creation form for a brand-new custom template. */
function NewTemplateForm({
  onCreate,
}: {
  onCreate: (definition: Omit<VaultTemplate, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('Square')
  const [fields, setFields] = useState<FieldDef[]>([
    { id: 'value', label: 'Value', type: 'masked', required: true, copyable: true },
  ])

  return (
    <div className="bg-muted/40 rounded-lg border border-dashed p-3">
      {open ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-template-name">Template name</Label>
            <Input
              id="new-template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Passport"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1">
              {ICON_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setIcon(choice)}
                  aria-label={choice}
                  aria-pressed={icon === choice}
                  className={cn(
                    'hover:bg-accent flex size-8 items-center justify-center rounded-md border transition-colors',
                    icon === choice && 'bg-primary/10 border-primary text-primary',
                  )}
                >
                  <TemplateIcon icon={choice} className="size-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Fields</Label>
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2">
                <Input
                  value={field.label}
                  aria-label={`Field ${index + 1} label`}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((candidate) =>
                        candidate.id === field.id
                          ? { ...candidate, label: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
                <Select
                  value={field.type}
                  onValueChange={(type: FieldType) =>
                    setFields((current) =>
                      current.map((candidate) =>
                        candidate.id === field.id ? { ...candidate, type } : candidate,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="w-36" aria-label={`Field ${index + 1} type`}>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setFields((current) => current.filter((c) => c.id !== field.id))}
                  aria-label={`Remove ${field.label}`}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setFields((current) => [
                  ...current,
                  {
                    id: uniqueId(`field-${current.length + 1}`, current.map((f) => f.id)),
                    label: `Field ${current.length + 1}`,
                    type: 'text',
                    required: false,
                    copyable: false,
                  },
                ])
              }
            >
              <Plus />
              Add field
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={name.trim().length === 0}
              onClick={() => {
                // Field ids are re-slugged from labels so a rename here does
                // not orphan values already stored against the old id.
                const used = new Set<string>()
                onCreate({
                  name: name.trim(),
                  icon,
                  builtIn: false,
                  fields: fields.map((field) => {
                    const id = uniqueId(slugify(field.label) || 'field', used)
                    used.add(id)
                    return { ...field, id, label: field.label.trim() || id }
                  }),
                })
                setName('')
                setFields([
                  {
                    id: 'value',
                    label: 'Value',
                    type: 'masked',
                    required: true,
                    copyable: true,
                  },
                ])
                setOpen(false)
              }}
            >
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
          <Plus />
          New custom template
        </Button>
      )}
    </div>
  )
}

/** Edit view for one template's name, icon, and field list. */
function TemplateEditor({
  template,
  onSave,
  onCancel,
}: {
  template: VaultTemplate
  onSave: (changes: Partial<VaultTemplate>) => void | Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(template.name)
  const [icon, setIcon] = useState(template.icon)
  const [fields, setFields] = useState<FieldDef[]>(() => template.fields.map((f) => ({ ...f })))

  function updateField(id: string, changes: Partial<FieldDef>): void {
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, ...changes } : field)),
    )
  }

  /** Ids are preserved when reordering: values are keyed by them. */
  function move(index: number, direction: -1 | 1): void {
    setFields((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const swap = next[index]!
      next[index] = next[target]!
      next[target] = swap
      return next
    })
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Edit template</SheetTitle>
        <SheetDescription>
          {template.builtIn ? 'This is a built-in template. ' : ''}
          Field changes apply to new and edited items. Existing values are kept and
          shown even if the field is removed.
        </SheetDescription>
      </SheetHeader>

      <div className="scrollbar-slim flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <Label htmlFor="template-name">Name</Label>
          <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>Icon</Label>
          <div className="flex flex-wrap gap-1">
            {ICON_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setIcon(choice)}
                aria-label={choice}
                aria-pressed={icon === choice}
                className={cn(
                  'hover:bg-accent flex size-8 items-center justify-center rounded-md border transition-colors',
                  icon === choice && 'bg-primary/10 border-primary text-primary',
                )}
              >
                <TemplateIcon icon={choice} className="size-4" />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Fields</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setFields((current) => [
                  ...current,
                  {
                    id: newId(),
                    label: `Field ${current.length + 1}`,
                    type: 'text',
                    required: false,
                    copyable: false,
                  },
                ])
              }
            >
              <Plus />
              Add
            </Button>
          </div>

          {fields.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              This template has no fields. Items using it will show only their notes
              and tags.
            </p>
          ) : null}

          {fields.map((field, index) => (
            <div key={field.id} className="bg-card space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${field.label} up`}
                    className="size-6"
                  >
                    <GripVertical className="rotate-90" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => move(index, 1)}
                    disabled={index === fields.length - 1}
                    aria-label={`Move ${field.label} down`}
                    className="size-6"
                  >
                    <GripVertical className="-rotate-90" />
                  </Button>
                </div>

                <Input
                  value={field.label}
                  aria-label={`Field ${index + 1} label`}
                  onChange={(event) => updateField(field.id, { label: event.target.value })}
                />

                <Select
                  value={field.type}
                  onValueChange={(type: FieldType) => updateField(field.id, { type, expiry: false })}
                >
                  <SelectTrigger className="w-36" aria-label={`Field ${index + 1} type`}>
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

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    setFields((current) => current.filter((candidate) => candidate.id !== field.id))
                  }
                  aria-label={`Remove ${field.label}`}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-4 pl-8">
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={field.required}
                    onCheckedChange={(checked) =>
                      updateField(field.id, { required: checked === true })
                    }
                  />
                  Required
                </label>

                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={field.copyable}
                    onCheckedChange={(checked) =>
                      updateField(field.id, { copyable: checked === true })
                    }
                  />
                  Copyable
                </label>

              </div>

              {field.type === 'cardExpiry' || field.type === 'expiryDate' ||
              (field.type === 'date' && field.expiry) ? (
                <Alert className="py-2">
                  <Info className="size-3.5" />
                  <AlertDescription className="text-xs">
                    {field.type === 'cardExpiry' ? (
                      <>Enter <code>MM/YY</code>, for example <code>04/28</code>.</>
                    ) : field.type === 'expiryDate' ? (
                      <>Enter <code>DD/MM/YYYY</code>, for example <code>31/12/2028</code>.</>
                    ) : (
                      <>
                        Accepted formats include <code>YYYY-MM-DD</code>, <code>YYYY-MM</code>,{' '}
                        <code>MM/YYYY</code>, <code>MM/DD</code>, <code>MM/DD/YYYY</code>, and{' '}
                        <code>MM/DD/YY</code>. <code>DD/MM/YYYY</code> is also recognized when the
                        first number is greater than 12; otherwise slash dates are read as
                        <code>MM/DD</code>.
                      </>
                    )}{' '}
                    Items using this field appear in the expiry dashboard.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <SheetFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={name.trim().length === 0}
          onClick={() => void onSave({ name: name.trim(), icon, fields })}
        >
          <Save />
          Save template
        </Button>
      </SheetFooter>
    </>
  )
}
