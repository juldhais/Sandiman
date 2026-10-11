/**
 * Built-in template seeds.
 *
 * These are written once at vault creation and thereafter behave like any other
 * template except that `builtIn` prevents deletion. Users can still edit their
 * fields or duplicate them freely.
 */
import type { FieldDef, VaultTemplate } from './types'

/** Offset applied per seed so templates keep a stable, evident ordering. */
const SEED_ORDER_STEP = 1

function field(
  id: string,
  label: string,
  type: FieldDef['type'],
  overrides: Partial<FieldDef> = {},
): FieldDef {
  return {
    id,
    label,
    type,
    required: false,
    copyable: false,
    expiry: false,
    ...overrides,
  }
}

export const LOGIN_FIELDS: FieldDef[] = [
  field('username', 'Username', 'text', { copyable: true }),
  field('password', 'Password', 'masked', { required: true, copyable: true }),
  field('url', 'Website URL', 'url'),
]

export const CREDIT_CARD_FIELDS: FieldDef[] = [
  field('cardholder', 'Cardholder Name', 'text', { required: true }),
  field('cardNumber', 'Card Number', 'number', {
    required: true,
    copyable: true,
    placeholder: '4111 1111 1111 1111',
  }),
  field('expiryDate', 'Expiration Date', 'cardExpiry', {
    expiry: true,
    placeholder: 'MM/YY',
  }),
  field('cvv', 'Security Code', 'masked', { copyable: true }),
  field('pin', 'PIN', 'masked', { copyable: true }),
  field('bankName', 'Bank', 'text'),
]

export const ID_CARD_FIELDS: FieldDef[] = [
  field('fullName', 'Full Name', 'text', { required: true }),
  field('documentNumber', 'ID / Document Number', 'text', {
    required: true,
    copyable: true,
  }),
  field('documentType', 'Document Type', 'text'),
  field('country', 'Country', 'text'),
  field('issueDate', 'Issue Date', 'date'),
  field('expirationDate', 'Expiration Date', 'date', { expiry: true }),
  field('sex', 'Sex', 'text'),
]

export const SECURE_NOTE_FIELDS: FieldDef[] = [
  field('content', 'Content', 'note', {
    required: true,
    placeholder: 'Write freely. This field is never masked.',
  }),
]

export const WIRELESS_KEY_FIELDS: FieldDef[] = [
  field('ssid', 'Network Name (SSID)', 'text', { required: true }),
  field('password', 'Password', 'masked', { required: true, copyable: true }),
  field('security', 'Security', 'text', {
    placeholder: 'WPA2, WPA3, WEP...',
  }),
  field('band', 'Band', 'text', { placeholder: '2.4 GHz / 5 GHz / 6 GHz' }),
  field('hidden', 'Hidden Network', 'boolean'),
]

export const API_KEY_FIELDS: FieldDef[] = [
  field('token', 'API Key / Token', 'masked', { required: true, copyable: true }),
  field('issuer', 'Issuer', 'text'),
  field('account', 'Account / Subject', 'text'),
  field('scopes', 'Scopes', 'text'),
  field('expiresAt', 'Expires At', 'date', { expiry: true }),
  field('baseUrl', 'Base URL', 'url'),
]

export const SOFTWARE_LICENSE_FIELDS: FieldDef[] = [
  field('licenseKey', 'License Key', 'masked', { required: true, copyable: true }),
  field('version', 'Version', 'text'),
  field('edition', 'Edition', 'text'),
  field('vendor', 'Vendor', 'text'),
  field('purchasedAt', 'Purchased On', 'date'),
  field('renewsAt', 'Renews On', 'date', { expiry: true }),
  field('downloadUrl', 'Download URL', 'url'),
]

export const DATABASE_FIELDS: FieldDef[] = [
  field('host', 'Host', 'text', { required: true, copyable: true }),
  field('port', 'Port', 'number', { defaultValue: '5432' }),
  field('database', 'Database', 'text', { required: true }),
  field('username', 'Username', 'text', { required: true, copyable: true }),
  field('password', 'Password', 'masked', { required: true, copyable: true }),
  field('engine', 'Engine', 'text', { placeholder: 'PostgreSQL, MySQL, MongoDB...' }),
  field('sslMode', 'SSL Mode', 'text'),
]

export interface BuiltinTemplateSeed {
  key: string
  name: string
  icon: string
  fields: FieldDef[]
}

/**
 * Ordered as they appear in the sidebar.
 *
 * This set goes slightly beyond the four named in the spec: a password manager
 * with only logins and cards is not much use, and each of these exercises a
 * different field type that the dynamic form engine needs covered.
 */
export const BUILTIN_TEMPLATES: BuiltinTemplateSeed[] = [
  { key: 'login', name: 'Login', icon: 'KeyRound', fields: LOGIN_FIELDS },
  { key: 'credit-card', name: 'Credit Card', icon: 'CreditCard', fields: CREDIT_CARD_FIELDS },
  { key: 'id-card', name: 'ID Card', icon: 'IdCard', fields: ID_CARD_FIELDS },
  { key: 'secure-note', name: 'Secure Note', icon: 'StickyNote', fields: SECURE_NOTE_FIELDS },
  { key: 'wireless-key', name: 'Wireless Key', icon: 'Wifi', fields: WIRELESS_KEY_FIELDS },
  { key: 'api-key', name: 'API Key', icon: 'KeySquare', fields: API_KEY_FIELDS },
  { key: 'software-license', name: 'Software License', icon: 'Package', fields: SOFTWARE_LICENSE_FIELDS },
  { key: 'database', name: 'Database', icon: 'Database', fields: DATABASE_FIELDS },
]

/** Stable template id per built-in, so re-seeding an existing vault is idempotent. */
export function builtinTemplateId(key: string): string {
  return `builtin-${key}`
}

/** Materialises the seeds into templates stamped for a new vault. */
export function createBuiltinTemplates(now: number = Date.now()): VaultTemplate[] {
  return BUILTIN_TEMPLATES.map((seed, index) => ({
    id: builtinTemplateId(seed.key),
    name: seed.name,
    icon: seed.icon,
    builtIn: true,
    // Clone so callers can mutate field defs without touching the seeds.
    fields: seed.fields.map((f) => ({ ...f })),
    createdAt: now + index * SEED_ORDER_STEP,
    updatedAt: now + index * SEED_ORDER_STEP,
    deleted: false,
  }))
}

/** True when the template id belongs to one of the built-in seeds. */
export function isBuiltinTemplateId(id: string): boolean {
  return BUILTIN_TEMPLATES.some((seed) => builtinTemplateId(seed.key) === id)
}
