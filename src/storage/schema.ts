/**
 * Runtime schemas for decrypted vault data.
 *
 * Decrypted bytes are untrusted input: they may come from a tampered blob, a
 * downgrade attack on an older envelope, or a payload written by a future
 * build. Everything is parsed here before it reaches the React tree, and
 * unknown-but-harmless extra keys are stripped rather than rejected so that
 * newer payloads degrade instead of breaking.
 */
import { z } from 'zod'
import { FIELD_TYPES, DEFAULT_SETTINGS, VAULT_PAYLOAD_VERSION } from './types'
import { DEFAULT_GITHUB_SYNC_CONFIG } from '@/sync/types'

/** Coerces anything timestamp-ish into epoch millis, defaulting to `fallback`. */
function epochMs(fallback: number) {
  return z.union([z.number(), z.string()]).transform((value, ctx) => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : fallback
    }
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid timestamp' })
      return z.NEVER
    }
    return parsed
  }).catch(fallback)
}

export const fieldTypeSchema = z.enum(FIELD_TYPES)

export const fieldDefSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  type: fieldTypeSchema,
  required: z.boolean().catch(false),
  copyable: z.boolean().catch(false),
  expiry: z.boolean().catch(false),
  placeholder: z.string().optional(),
  defaultValue: z.string().optional(),
})

export const customFieldSchema = fieldDefSchema.extend({
  value: z.string().catch(''),
})

export const templateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().catch('Square'),
  builtIn: z.boolean().catch(false),
  fields: z.array(fieldDefSchema).catch([]),
  createdAt: epochMs(0),
  updatedAt: epochMs(0),
  deleted: z.boolean().catch(false),
})

export const itemSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().nullable().catch(null),
  title: z.string().trim().min(1).catch('Untitled'),
  values: z.record(z.string(), z.string()).catch({}),
  customFields: z.array(customFieldSchema).catch([]),
  fieldOrder: z.array(z.string()).catch([]).optional(),
  hiddenFieldIds: z.array(z.string()).catch([]).optional(),
  tags: z.array(z.string()).catch([]),
  notes: z.string().catch(''),
  createdAt: epochMs(0),
  updatedAt: epochMs(0),
  deleted: z.boolean().catch(false),
})

export const settingsSchema = z
  .object({
    clipboardClearSeconds: z.number().int().min(0).max(600).catch(DEFAULT_SETTINGS.clipboardClearSeconds),
    autoLockMinutes: z.number().int().min(0).max(1440).catch(DEFAULT_SETTINGS.autoLockMinutes),
    lockOnBlur: z.boolean().catch(DEFAULT_SETTINGS.lockOnBlur),
    expiryWarningDays: z.number().int().min(1).max(365).catch(DEFAULT_SETTINGS.expiryWarningDays),
    lastSyncAt: z.number().nullable().catch(null),
  })
  .catch(DEFAULT_SETTINGS)

export const githubSyncConfigSchema = z
  .object({
    owner: z.string().catch(''),
    repo: z.string().catch(''),
    branch: z.string().catch(''),
    path: z.string().catch(DEFAULT_GITHUB_SYNC_CONFIG.path),
    token: z.string().catch(''),
    autoSync: z.boolean().catch(false),
    autoSyncMinutes: z.number().int().min(1).max(1440).catch(DEFAULT_GITHUB_SYNC_CONFIG.autoSyncMinutes),
  })
  .catch(DEFAULT_GITHUB_SYNC_CONFIG)

export const storedSyncSettingsSchema = z.object({
  config: githubSyncConfigSchema,
})

export const vaultPayloadSchema = z.object({
  version: z.number().int().catch(VAULT_PAYLOAD_VERSION),
  items: z.array(itemSchema).catch([]),
  templates: z.array(templateSchema).catch([]),
  settings: settingsSchema,
  updatedAt: epochMs(0),
  sync: storedSyncSettingsSchema.optional(),
  localItemCount: z.number().int().min(0).optional(),
})

export type ParsedVaultPayload = z.infer<typeof vaultPayloadSchema>

/**
 * Parses decrypted bytes into a payload, filling defaults for missing sections.
 *
 * @throws {z.ZodError} only if a structural invariant fails outright (for
 * example a non-array `items` of the wrong element type). Individual field
 * level failures are absorbed by the `.catch` defaults above.
 */
export function parseVaultPayload(input: unknown): ParsedVaultPayload {
  return vaultPayloadSchema.parse(input)
}

/**
 * Best-effort parse that never throws, for the remote side of a sync where a
 * malformed blob should be reported rather than crash the merge.
 */
export function safeParseVaultPayload(input: unknown): ParsedVaultPayload | null {
  const result = vaultPayloadSchema.safeParse(input)
  return result.success ? result.data : null
}
