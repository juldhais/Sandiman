import { describe, expect, it } from 'vitest'
import {
  CredentialError,
  describeCredential,
  parseConnectionString,
  parseSasUrl,
  readAccountName,
} from '@/sync/credentialParsing'
import { buildStringToSign, type SharedKeyTarget } from '@/sync/sharedKeyTransport'

const CONNECTION_STRING =
  'DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=YWJjZA==;EndpointSuffix=core.windows.net'

describe('parseConnectionString', () => {
  it('reads the fields regardless of order', () => {
    const parsed = parseConnectionString(
      'AccountKey=YWJjZA==;AccountName=myaccount;DefaultEndpointsProtocol=https',
    )

    expect(parsed.accountName).toBe('myaccount')
    expect(parsed.accountKey).toBe('YWJjZA==')
  })

  it('builds the endpoint from the account name', () => {
    const parsed = parseConnectionString(CONNECTION_STRING)
    expect(parsed.endpoint).toBe('https://myaccount.blob.core.windows.net')
  })

  it('rejects a connection string with no account key', () => {
    expect(() => parseConnectionString('AccountName=myaccount')).toThrow(CredentialError)
  })

  it('rejects an empty string', () => {
    expect(() => parseConnectionString('   ')).toThrow(CredentialError)
  })
})

describe('parseSasUrl', () => {
  const url =
    'https://myaccount.blob.core.windows.net/sandiman-vault/vault-encrypted.json?sv=2021-12-02&sig=abc123%2Fdef'

  it('extracts account, container, and blob name', () => {
    const parsed = parseSasUrl(url)

    expect(parsed.accountName).toBe('myaccount')
    expect(parsed.container).toBe('sandiman-vault')
    expect(parsed.blob).toBe('vault-encrypted.json')
  })

  it('preserves the query string intact', () => {
    const parsed = parseSasUrl(url)
    expect(parsed.sasToken).toContain('sig=abc123%2Fdef')
  })

  it('accepts a bare token', () => {
    const parsed = parseSasUrl('?sv=2021-12-02&sig=abc')

    expect(parsed.sasToken).toBe('?sv=2021-12-02&sig=abc')
    expect(parsed.endpoint).toBe('')
  })

  it('rejects a token with no signature', () => {
    expect(() => parseSasUrl('?sv=2021-12-02')).toThrow(CredentialError)
  })

  it('rejects a URL with no signature', () => {
    expect(() => parseSasUrl('https://a.blob.core.windows.net/c/b?sv=2021')).toThrow(
      CredentialError,
    )
  })
})

describe('readAccountName', () => {
  it('prefers an explicitly configured account', () => {
    expect(readAccountName({ kind: 'sas', accountName: 'explicit', email: '', sasToken: '?sig=x', connectionString: '', containerName: 'c', blobName: 'b', autoSync: false, autoSyncMinutes: 5 })).toBe('explicit')
  })

  it('derives the account from a connection string', () => {
    const account = readAccountName({
      kind: 'connection-string',
      accountName: '',
      email: '',
      sasToken: '',
      connectionString: CONNECTION_STRING,
      containerName: 'c',
      blobName: 'b',
      autoSync: false,
      autoSyncMinutes: 5,
    })

    expect(account).toBe('myaccount')
  })

  it('returns empty rather than throwing on a broken credential', () => {
    expect(readAccountName({ kind: 'connection-string', accountName: '', email: '', sasToken: '', connectionString: 'nonsense', containerName: 'c', blobName: 'b', autoSync: false, autoSyncMinutes: 5 })).toBe('')
  })
})

describe('describeCredential', () => {
  it('reports a readable connection string', () => {
    const result = describeCredential({
      kind: 'connection-string',
      accountName: '',
      email: 'a@b.c',
      sasToken: '',
      connectionString: CONNECTION_STRING,
      containerName: 'c',
      blobName: 'b',
      autoSync: false,
      autoSyncMinutes: 5,
    })

    expect(result.ok).toBe(true)
    expect(result.summary).toContain('myaccount')
  })

  it('never echoes the account key', () => {
    const result = describeCredential({
      kind: 'connection-string',
      accountName: '',
      email: '',
      sasToken: '',
      connectionString: CONNECTION_STRING,
      containerName: 'c',
      blobName: 'b',
      autoSync: false,
      autoSyncMinutes: 5,
    })

    expect(result.summary).not.toContain('YWJjZA==')
  })

  it('reports an unreadable credential as not ok', () => {
    const result = describeCredential({
      kind: 'sas',
      accountName: '',
      email: '',
      sasToken: 'not-a-token',
      connectionString: '',
      containerName: 'c',
      blobName: 'b',
      autoSync: false,
      autoSyncMinutes: 5,
    })

    expect(result.ok).toBe(false)
  })
})

describe('buildStringToSign', () => {
  const target: SharedKeyTarget = {
    accountName: 'myaccount',
    accountKey: 'YWJjZA==',
    endpoint: 'https://myaccount.blob.core.windows.net',
    container: 'sandiman-vault',
    blob: 'vault.json',
  }

  it('starts with the method and signs the resource path', () => {
    const headers = new Headers({ 'x-ms-date': 'Mon, 01 Jan 2026 00:00:00 GMT' })
    const signed = buildStringToSign('PUT', headers, 0, target)

    expect(signed.startsWith('PUT\n')).toBe(true)
    expect(signed.endsWith('/myaccount/sandiman-vault/vault.json')).toBe(true)
  })

  it('signs x-ms headers in sorted, lowercased order', () => {
    const headers = new Headers({
      'x-ms-version': '2021-12-02',
      'x-ms-date': 'Mon, 01 Jan 2026 00:00:00 GMT',
      'x-ms-lease-id': 'lease-1',
    })

    const signed = buildStringToSign('PUT', headers, 0, target)

    const dateIndex = signed.indexOf('x-ms-date:')
    const leaseIndex = signed.indexOf('x-ms-lease-id:')
    const versionIndex = signed.indexOf('x-ms-version:')

    // Sorted alphabetically: date < lease-id < version.
    expect(dateIndex).toBeLessThan(leaseIndex)
    expect(leaseIndex).toBeLessThan(versionIndex)
  })

  it('treats a zero content length as an empty string', () => {
    const headers = new Headers()
    const signed = buildStringToSign('GET', headers, 0, target)

    // Method, then an empty encoding/language/length/md5/type/date run.
    expect(signed).toContain('GET\n\n\n\n\n\n')
  })

  it('includes a non-zero content length', () => {
    const headers = new Headers()
    expect(buildStringToSign('PUT', headers, 42, target)).toContain('\n42\n')
  })

  it('signs container-level requests without the blob segment', () => {
    const headers = new Headers()
    const signed = buildStringToSign(
      'PUT',
      headers,
      0,
      target,
      '/myaccount/sandiman-vault',
    )

    expect(signed.endsWith('/myaccount/sandiman-vault')).toBe(true)
  })

  it('is deterministic for the same inputs', () => {
    const headers = new Headers({ 'x-ms-date': 'Mon, 01 Jan 2026 00:00:00 GMT' })
    const a = buildStringToSign('PUT', headers, 10, target)
    const b = buildStringToSign('PUT', headers, 10, target)

    expect(a).toBe(b)
  })
})