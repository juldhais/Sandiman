import type { GitHubSyncConfig } from '@/sync/types'

/**
 * Core vault domain model.
 *
 * The vault is template-driven: a template declares a list of field
 * definitions, and an item holds one value per field, keyed by field id.
 * Keying by id rather than by label is what lets a template be edited without
 * invalidating existing items.
 */

/** Input controls a field can render as. */
export const FIELD_TYPES = [
  'text',
  'masked',
  'number',
  'date',
  'cardExpiry',
  'boolean',
  'url',
  'note',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

/**
 * A single field definition.
 *
 * The same type describes both template fields and an item's ad-hoc custom
 * fields; the difference is only where the definition lives.
 */
export interface FieldDef {
  id: string
  label: string
  type: FieldType
  required: boolean
  /** Renders a click-to-copy button next to the value. */
  copyable: boolean
  /** Marks a date-like field as an expiry, which drives dashboard warnings. */
  expiry: boolean
  placeholder?: string
  defaultValue?: string
}

/**
 * An ad-hoc field attached to one item only.
 *
 * Values are stored inline rather than in the item's `values` map so that
 * orphaned custom fields are easy to enumerate on the item detail view.
 */
export interface CustomField extends FieldDef {
  value: string
}

/**
 * Templates are syncable too, so deleting one has to propagate between devices.
 * They are not filtered out of the store the way deleted items are: a
 * template-less item still renders its values, so a stale template reference is
 * harmless.
 */
export interface VaultTemplate {
  id: string
  name: string
  /** Name of a lucide-react icon, e.g. `KeyRound`. */
  icon: string
  /** Built-in templates cannot be deleted, only duplicated. */
  builtIn: boolean
  fields: FieldDef[]
  createdAt: number
  updatedAt: number
  /** Soft delete, so template deletions propagate through sync. */
  deleted: boolean
}

/** Sync bookkeeping shared with the merge engine. */
export interface Syncable {
  id: string
  createdAt: number
  updatedAt: number
  /**
   * Soft delete. Required for merge: with only `updatedAt`, a delete on device A
   * would be resurrected by a stale copy of the item on device B.
   */
  deleted: boolean
}

export interface VaultItem extends Syncable {
  /** Null once the backing template has been removed. */
  templateId: string | null
  /** Static display title; separate from template fields and never reordered or deleted. */
  title: string
  /** Field id to value, covering both template fields and template-less items. */
  values: Record<string, string>
  customFields: CustomField[]
  /** Per-item display order; omitted ids follow their natural template order. */
  fieldOrder?: string[]
  tags: string[]
  notes: string
}

export interface VaultSettings {
  /** Seconds before a copied secret is overwritten in the clipboard. */
  clipboardClearSeconds: number
  /** Minutes of inactivity before the vault re-locks. Zero disables. */
  autoLockMinutes: number
  /** Also lock when the window loses focus. */
  lockOnBlur: boolean
  /** Lead time for the expiry dashboard, in days. */
  expiryWarningDays: number
  lastSyncAt: number | null
}

export const DEFAULT_SETTINGS: VaultSettings = {
  clipboardClearSeconds: 30,
  autoLockMinutes: 5,
  lockOnBlur: false,
  expiryWarningDays: 30,
  lastSyncAt: null,
}

/**
 * GitHub destination settings, held inside the master-key-encrypted payload.
 * These are local-only and stripped before anything is uploaded.
 */
export interface StoredSyncSettings {
  config: GitHubSyncConfig
}

/** The decrypted vault body used in memory and as the GitHub sync payload. */
export interface VaultPayload {
  version: number
  items: VaultItem[]
  templates: VaultTemplate[]
  settings: VaultSettings
  updatedAt: number
  /** Local-only; stripped before sync. */
  sync?: StoredSyncSettings
  /** Encrypted integrity check for the number of separately stored items. */
  localItemCount?: number
}

/** Payload version, bumped when the item/template shape changes incompatibly. */
export const VAULT_PAYLOAD_VERSION = 1

/**
 * Projects the vault body onto the subset shared with other devices.
 *
 * GitHub credentials and the local sync timestamp are excluded so neither the
 * PAT nor sync-only bookkeeping creates a remote commit.
 */
export function toSyncPayload(payload: VaultPayload): Omit<VaultPayload, 'sync'> {
  const {
    sync: _sync,
    localItemCount: _localItemCount,
    ...shared
  } = payload
  return { ...shared, settings: { ...shared.settings, lastSyncAt: null } }
}
