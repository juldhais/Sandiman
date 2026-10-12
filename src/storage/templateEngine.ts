/**
 * Template resolution and runtime schema generation.
 *
 * This module is the single source of truth for "what fields does this item
 * actually have". Both the read view and the edit form are driven from the
 * resolvers here, so they cannot drift apart.
 */
import { z } from 'zod'
import { isValidCardExpiry } from './cardExpiry'
import {
  DEFAULT_SETTINGS,
  type FieldDef,
  type VaultItem,
  type VaultTemplate,
} from './types'

/**
 * A template field paired with the value resolved for a specific item.
 */
export interface ResolvedField {
  /** Key into `item.values` for template fields, or the custom field id. */
  id: string
  def: FieldDef
  value: string
  /**
   * True when the item holds a value for a field the template no longer
   * declares. Such fields are surfaced but flagged, because deleting a field
   * from a template must not silently destroy the data behind it.
   */
  orphaned: boolean
  /** Marks an ad-hoc field defined on the item rather than the template. */
  custom: boolean
}

function isBlank(value: string): boolean {
  return value.trim().length === 0
}

/**
 * Flattens an item into the ordered field list to render.
 *
 * Default order is template fields, orphaned template values, then ad-hoc
 * custom fields. Per-item ordering is applied after resolution. Orphans come
 * before customs because they are older data the user is more likely to still
 * care about.
 */
export function resolveFields(item: VaultItem, template: VaultTemplate | null): ResolvedField[] {
  const resolved: ResolvedField[] = []
  const declaredIds = new Set<string>()
  const customIds = new Set(item.customFields.map((field) => field.id))
  const hiddenIds = new Set(item.hiddenFieldIds ?? [])

  if (template) {
    for (const def of template.fields) {
      declaredIds.add(def.id)
      if (hiddenIds.has(def.id)) continue
      resolved.push({
        id: def.id,
        def,
        value: item.values[def.id] ?? def.defaultValue ?? '',
        orphaned: false,
        custom: false,
      })
    }
  }

  // Values whose field was removed from the template. Surfaced rather than
  // dropped, so editing a template is never destructive.
  for (const [fieldId, value] of Object.entries(item.values)) {
    if (declaredIds.has(fieldId) || customIds.has(fieldId)) continue
    resolved.push({
      id: fieldId,
      def: {
        id: fieldId,
        label: fieldId,
        type: 'text',
        required: false,
        copyable: true,
        expiry: false,
      },
      value,
      orphaned: true,
      custom: false,
    })
  }

  for (const custom of item.customFields) {
    resolved.push({
      id: custom.id,
      def: custom,
      value: custom.value,
      orphaned: false,
      custom: true,
    })
  }

  const order = new Map((item.fieldOrder ?? []).map((id, index) => [id, index]))

  return resolved
    .map((field, index) => ({ field, index }))
    .sort((a, b) => {
      const aOrder = order.get(a.field.id)
      const bOrder = order.get(b.field.id)
      if (aOrder === undefined && bOrder === undefined) return a.index - b.index
      if (aOrder === undefined) return 1
      if (bOrder === undefined) return -1
      return aOrder - bOrder || a.index - b.index
    })
    .map(({ field }) => field)
}

/** Permanently removes selected fields and their values from one item. */
export function removeItemFields(item: VaultItem, fieldIds: readonly string[]): VaultItem {
  if (fieldIds.length === 0) return item

  const removedIds = new Set(fieldIds)
  const values = { ...item.values }
  for (const id of removedIds) delete values[id]

  return {
    ...item,
    values,
    customFields: item.customFields.filter((field) => !removedIds.has(field.id)),
    fieldOrder: item.fieldOrder?.filter((id) => !removedIds.has(id)),
  }
}

/** Fields worth showing in a detail view: anything with content. */
export function populatedFields(item: VaultItem, template: VaultTemplate | null): ResolvedField[] {
  return resolveFields(item, template).filter((field) => !isBlank(field.value))
}


/** Every field on an item that should drive an expiry warning. */
export function expiryFields(item: VaultItem, template: VaultTemplate | null): ResolvedField[] {
  return resolveFields(item, template).filter((field) => field.def.expiry && !isBlank(field.value))
}

/**
 * Builds a zod object schema from field definitions.
 *
 * `required` drives the basic non-blank rule. The card-expiry type also has a
 * strict MM/YY check; ordinary date fields remain free text so partial dates
 * and other user-entered formats can still be stored.
 */
export function buildFieldSchema(
  fields: readonly FieldDef[],
): z.ZodObject<Record<string, z.ZodType<string>>> {
  const shape: Record<string, z.ZodType<string>> = {}

  for (const def of fields) {
    if (def.type === 'cardExpiry') {
      shape[def.id] = z.string().trim().superRefine((value, context) => {
        if (!value && def.required) {
          context.addIssue({ code: 'custom', message: `${def.label} is required` })
        } else if (value && !isValidCardExpiry(value)) {
          context.addIssue({ code: 'custom', message: `${def.label} must use MM/YY` })
        }
      })
    } else {
      shape[def.id] = def.required
        ? z.string().trim().min(1, `${def.label} is required`)
        : z.string().catch('')
    }
  }

  return z.object(shape)
}

/**
 * The shape used by the dynamic item form: template fields plus the ad-hoc
 * custom fields currently attached to the item.
 */
export function buildItemSchema(item: VaultItem, template: VaultTemplate | null): z.ZodObject<Record<string, z.ZodType<string>>> {
  const fields = resolveFields(item, template).map((field) => field.def)
  return buildFieldSchema(fields)
}

/** Splits a resolved field list into template and custom halves for editing. */
export function collectValues(
  fields: readonly ResolvedField[],
  input: Record<string, unknown>,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    const raw = input[field.id]
    if (typeof raw === 'string' && raw.length > 0) {
      values[field.id] = raw
    }
  }
  return values
}

/** Suggests an item title from the first meaningful field value. */
export function suggestTitle(
  fields: readonly ResolvedField[],
  fallback = 'Untitled',
): string {
  const preferred = ['username', 'cardNumber', 'documentNumber', 'host', 'ssid', 'issuer', 'fullName', 'token']
  for (const id of preferred) {
    const match = fields.find((field) => field.id === id && !isBlank(field.value))
    if (match) return match.value.trim()
  }
  const first = fields.find((field) => !isBlank(field.value) && field.def.type !== 'note')
  return first ? first.value.trim() : fallback
}

/** Default settings, re-exported so UI modules have one import site. */
export { DEFAULT_SETTINGS }

/** Builds an empty item bound to a template. */
export function createItem(templateId: string | null, now: number = Date.now()): VaultItem {
  return {
    id: crypto.randomUUID(),
    templateId,
    title: '',
    values: {},
    customFields: [],
    tags: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
}
/** Marks an item as updated without touching its creation time. */
export function touchItem(item: VaultItem, now: number = Date.now()): VaultItem {
  return { ...item, updatedAt: now }
}

/** Marks a template as updated, preserving field order. */
export function touchTemplate(template: VaultTemplate, now: number = Date.now()): VaultTemplate {
  return { ...template, updatedAt: now }
}
