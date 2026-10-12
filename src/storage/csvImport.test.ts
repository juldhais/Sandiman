import { describe, expect, it } from 'vitest'
import { parseLoginCsv } from '@/storage/csvImport'

describe('parseLoginCsv', () => {
  it('maps common login columns and preserves extra columns', () => {
    const items = parseLoginCsv(
      '\uFEFFname,login_username,login_password,login_uri,notes,tags,Folder\r\n' +
        'Example,alice,secret,https://example.com,"line one\nline two","work; important",Personal\r\n',
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      templateId: 'builtin-login',
      title: 'Example',
      values: {
        username: 'alice',
        password: 'secret',
        url: 'https://example.com',
      },
      notes: 'line one\nline two',
      tags: ['work', 'important'],
      customFields: [expect.objectContaining({ label: 'Folder', value: 'Personal' })],
      deleted: false,
    })
  })

  it('handles escaped quotes and generates a title when one is absent', () => {
    const [item] = parseLoginCsv('username,password\nalice,"says ""hello"""')
    expect(item?.title).toBe('alice')
    expect(item?.values.password).toBe('says "hello"')
  })

  it('rejects malformed row widths instead of importing partial data', () => {
    expect(() => parseLoginCsv('name,password\nGood,secret\nBad'))
      .toThrow('Row 3 has 1 columns; expected 2')
  })

  it('requires headers and at least one data row', () => {
    expect(() => parseLoginCsv('')).toThrow('header and at least one data row')
    expect(() => parseLoginCsv('name,password')).toThrow('header and at least one data row')
  })

  it('rejects duplicate normalized headers', () => {
    expect(() => parseLoginCsv('Login Name,login_name\nA,B')).toThrow('duplicate column headers')
  })
})
