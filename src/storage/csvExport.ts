import { resolveFields } from './templateEngine'
import type { VaultItem, VaultTemplate } from './types'

interface ExportColumn {
  key: string
  label: string
}

const RESERVED_HEADERS = new Set(['title', 'template', 'tags', 'notes'])

function escapeCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Export active vault items and all their fields as UTF-8 CSV. */
export function exportVaultCsv(items: readonly VaultItem[], templates: readonly VaultTemplate[]): string {
  const templateById = new Map(templates.map((template) => [template.id, template]))
  const fieldColumns = new Map<string, { label: string; templateName: string }>()

  for (const item of items) {
    const template = item.templateId ? templateById.get(item.templateId) ?? null : null
    const templateName = template?.name ?? 'Other'
    for (const field of resolveFields(item, template)) {
      const key = `${item.templateId ?? ''}\u0000${field.custom ? 'custom:' : ''}${field.id}`
      if (!fieldColumns.has(key)) {
        fieldColumns.set(key, { label: field.def.label || field.id, templateName })
      }
    }
  }

  const usedHeaders = new Set(RESERVED_HEADERS)
  const columns: ExportColumn[] = []
  for (const [key, field] of fieldColumns) {
    let label = field.label
    if (usedHeaders.has(label.toLowerCase())) label = `${field.templateName} - ${label}`
    let uniqueLabel = label
    let suffix = 2
    while (usedHeaders.has(uniqueLabel.toLowerCase())) {
      uniqueLabel = `${label} (${suffix})`
      suffix += 1
    }
    usedHeaders.add(uniqueLabel.toLowerCase())
    columns.push({ key, label: uniqueLabel })
  }

  const headers = ['Title', 'Template', 'Tags', 'Notes', ...columns.map((column) => column.label)]
  const lines = [headers.map(escapeCell).join(',')]

  for (const item of items) {
    const template = item.templateId ? templateById.get(item.templateId) ?? null : null
    const values = new Map<string, string>()
    for (const field of resolveFields(item, template)) {
      const key = `${item.templateId ?? ''}\u0000${field.custom ? 'custom:' : ''}${field.id}`
      values.set(key, field.value)
    }
    const row = [
      item.title,
      template?.name ?? '',
      item.tags.join('; '),
      item.notes,
      ...columns.map((column) => values.get(column.key) ?? ''),
    ]
    lines.push(row.map(escapeCell).join(','))
  }

  // BOM helps spreadsheet apps recognise UTF-8, while remaining valid CSV.
  return `\uFEFF${lines.join('\r\n')}`
}
