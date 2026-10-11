import { describe, expect, it } from 'vitest'
import { createBlobHandle } from '@/sync/azure'
import {
  CredentialError,
  describeCredential,
  parseSasUrl,
  readAccountName,
} from '@/sync/credentialParsing'

const SAS_URL = 'https://myaccount.blob.core.windows.net/?sv=2021-12-02&sig=YWJj'

const config = {
  sasUrl: SAS_URL,
  containerName: 'vault-container',
  blobName: 'vault.json',
  autoSync: false,
  autoSyncMinutes: 5,
}

describe('parseSasUrl', () => {
  it('reads a service SAS URL', () => {
    const parsed = parseSasUrl(SAS_URL, config)

    expect(parsed.accountName).toBe('myaccount')
    expect(parsed.scope).toBe('service')
  })

  it('accepts a container SAS URL matching the configured container', () => {
    const parsed = parseSasUrl(
      'https://myaccount.blob.core.windows.net/vault-container?sv=2021-12-02&sig=YWJj',
      config,
    )

    expect(parsed.scope).toBe('container')
  })

  it('accepts a blob SAS URL matching the configured blob', () => {
    const parsed = parseSasUrl(
      'https://myaccount.blob.core.windows.net/vault-container/vault.json?sv=2021-12-02&sig=YWJj',
      config,
    )

    expect(parsed.scope).toBe('blob')
  })

  it('rejects URLs without SAS query parameters', () => {
    expect(() => parseSasUrl('https://myaccount.blob.core.windows.net/', config)).toThrow(
      /SAS URL/i,
    )
  })

  it('rejects a path that conflicts with the configured blob', () => {
    expect(() =>
      parseSasUrl(
        'https://myaccount.blob.core.windows.net/vault-container/other.json?sv=2021-12-02&sig=YWJj',
        config,
      ),
    ).toThrow(/does not match/i)
  })

  it('rejects an empty string', () => {
    expect(() => parseSasUrl('   ', config)).toThrow(CredentialError)
  })
})

describe('readAccountName', () => {
  it('derives the account from the SAS endpoint', () => {
    expect(readAccountName(config)).toBe('myaccount')
  })

  it('returns empty rather than throwing on a broken credential', () => {
    expect(readAccountName({ ...config, sasUrl: 'nonsense' })).toBe('')
  })
})

describe('describeCredential', () => {
  it('reports a readable SAS URL', () => {
    const result = describeCredential(config)
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('myaccount')
  })

  it('never echoes the SAS token', () => {
    const result = describeCredential(config)
    expect(result.summary).not.toContain('YWJj')
  })

  it('reports an unsupported account-key credential as not ok', () => {
    const result = describeCredential({ ...config, sasUrl: 'https://myaccount.blob.core.windows.net/' })
    expect(result.ok).toBe(false)
  })
})

describe('createBlobHandle', () => {
  it('constructs the official Azure SDK clients from the SAS URL', () => {
    const { handle, parsed } = createBlobHandle(config)

    expect(parsed.accountName).toBe('myaccount')
    expect(typeof handle.containerExists).toBe('function')
    expect(typeof handle.download).toBe('function')
    expect(typeof handle.acquireLease).toBe('function')
  })
})
