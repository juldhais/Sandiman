/** CSV import mapping for password-manager Login entries. */
import { newId, slugify, uniqueId } from '@/lib/id'
import type { CustomField, VaultItem } from './types'

const MAX_IMPORT_ROWS = 5000

const COLUMN_ALIASES = {
  title: ['title', 'name', 'item', 'login_name'],
  username: ['username', 'user', 'login_username', 'login_user', 'email', 'login_email'],
  password: ['password', 'login_password'],
  url: ['url', 'website', 'website_url', 'login_uri', 'login_url'],
  notes: ['notes', 'note', 'login_notes'],
  tags: ['tags', 'tag'],
} as const

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** Parse RFC 4180-style CSV, including escaped quotes and newlines in cells. */
function parseRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let afterQuote = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
          afterQuote = true
        }
      } else {
        cell += char
      }
      continue
    }

    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n' && char !== ' ' && char !== '\t') {
      throw new Error(`Unexpected character after a quoted value near row ${rows.length + 1}`)
    }
    if (afterQuote && (char === ' ' || char === '\t')) continue
    afterQuote = false

    if (char === '"') {
      if (cell.length > 0) {
        throw new Error(`Unexpected quote in an unquoted value near row ${rows.length + 1}`)
      }
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (quoted) throw new Error('The CSV ends inside a quoted value')
  row.push(cell)
  if (row.some((value) => value.trim() !== '')) rows.push(row)
  return rows
}

/**
 * Convert a CSV with a header row into Login items. Unknown columns are kept as
 * item-specific custom fields so importing never silently discards user data.
 */
export function parseLoginCsv(input: string): VaultItem[] {
  const rows = parseRows(input)
  if (rows.length < 2) throw new Error('The CSV must include a header and at least one data row')

  const headers = rows[0]!.map(normalizeHeader)
  if (headers.some((header) => !header)) throw new Error('Every CSV column needs a header')
  if (new Set(headers).size !== headers.length) throw new Error('The CSV contains duplicate column headers')

  const mappedIndexes = new Set<number>()
  const indexes: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {}
  for (const [kind, aliases] of Object.entries(COLUMN_ALIASES) as [keyof typeof COLUMN_ALIASES, readonly string[]][]) {
    const columnIndex = headers.findIndex((header) => aliases.includes(header))
    if (columnIndex >= 0) {
      indexes[kind] = columnIndex
      mappedIndexes.add(columnIndex)
    }
  }

  const extras = rows[0]!
    .map((header, index) => ({ header: header.trim(), index }))
    .filter(({ index }) => !mappedIndexes.has(index))
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw new Error(`Import is limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows`)
  }

  const now = Date.now()
  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`Row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}`)
    }
    const valueAt = (kind: keyof typeof COLUMN_ALIASES): string => {
      const index = indexes[kind]
      return index === undefined ? '' : values[index]!.trim()
    }
    const title = valueAt('title') || valueAt('username') || valueAt('url') || `Imported login ${rowIndex + 1}`
    const customIds = new Set(['username', 'password', 'url'])
    const customFields: CustomField[] = []
    for (const extra of extras) {
      const label = extra.header || `Column ${extra.index + 1}`
      const id = uniqueId(slugify(label), customIds)
      customIds.add(id)
      const value = values[extra.index]!.trim()
      if (!value) continue
      customFields.push({
        id,
        label,
        type: 'text',
        required: false,
        copyable: false,
        value,
      })
    }

    const item: VaultItem = {
      id: newId(),
      templateId: 'builtin-login',
      title,
      values: {
        ...(valueAt('username') ? { username: valueAt('username') } : {}),
        ...(valueAt('password') ? { password: valueAt('password') } : {}),
        ...(valueAt('url') ? { url: valueAt('url') } : {}),
      },
      customFields,
      tags: valueAt('tags').split(/[;,]/).map((tag) => tag.trim()).filter(Boolean),
      notes: valueAt('notes'),
      createdAt: now + rowIndex,
      updatedAt: now + rowIndex,
      deleted: false,
    }
    return item
  })
}
