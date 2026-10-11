/**
 * Azure credential parsing.
 *
 * Deliberately free of any Azure SDK import: the settings panel validates and
 * summarises credentials on render, and importing the SDK here would pull it
 * into the main bundle for users who never sync.
 */
import type { AzureSyncConfig } from './types'

export interface ParsedConnectionString {
  kind: 'connection-string'
  accountName: string
  /** Never shown in the UI; only used to sign requests. */
  accountKey: string
  /** Endpoint inferred from the account name. */
  endpoint: string
}

export interface ParsedSas {
  kind: 'sas'
  accountName: string
  endpoint: string
  container: string
  blob: string
  /** Full SAS token including the leading `?`. */
  sasToken: string
}

export type ParsedCredential = ParsedConnectionString | ParsedSas

export class CredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}

const DEFAULT_SUFFIX = 'blob.core.windows.net'

/**
 * Derives the service endpoint from an account name.
 *
 * Emulator-style names keep their custom suffix (`devstoreaccount1...`), which
 * matters for anyone testing against Azurite locally.
 */
function normalizeEndpoint(accountName: string, explicit?: string): string {
  if (explicit && explicit.length > 0) {
    return explicit.startsWith('http') ? explicit : `https://${explicit}`
  }
  const suffix = accountName.includes('.')
    ? accountName.slice(accountName.indexOf('.') + 1)
    : DEFAULT_SUFFIX
  const bare = accountName.includes('.') ? accountName.slice(0, accountName.indexOf('.')) : accountName
  return `https://${bare}.${suffix}`
}

/**
 * Parses a storage connection string.
 *
 * Format: `DefaultEndpointsProtocol=...;AccountName=...;AccountKey=...;...`
 * Order is not guaranteed, so this reads by key rather than by position.
 */
export function parseConnectionString(raw: string): ParsedConnectionString {
  const value = raw.trim()
  if (!value) throw new CredentialError('The connection string is empty')

  const fields = new Map<string, string>()
  for (const part of value.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const key = part.slice(0, separator).trim().toLowerCase()
    fields.set(key, part.slice(separator + 1).trim())
  }

  const accountName = fields.get('accountname')
  if (!accountName) {
    throw new CredentialError('The connection string has no AccountName field')
  }

  const accountKey = fields.get('accountkey')
  if (!accountKey) {
    throw new CredentialError('The connection string has no AccountKey field')
  }

  const protocol = fields.get('defaultendpointsprotocol') ?? 'https'
  const suffix = fields.get('defaultendpointsuffix') ?? DEFAULT_SUFFIX

  return {
    kind: 'connection-string',
    accountName,
    accountKey,
    endpoint: normalizeEndpoint(accountName, `${protocol}://${accountName}.${suffix}`),
  }
}

export interface ParsedSasUrl {
  accountName: string
  endpoint: string
  container: string
  blob: string
  sasToken: string
}

/**
 * Splits a SAS URL into its parts.
 *
 * Accepts either a full blob URL or a bare token beginning with `?`. In the
 * URL form the container and blob name are read from the path, which lets the
 * settings screen prefill those fields.
 */
export function parseSasUrl(raw: string): ParsedSasUrl {
  const value = raw.trim()
  if (!value) throw new CredentialError('The SAS token is empty')

  if (!value.includes('://')) {
    if (!value.startsWith('?')) {
      throw new CredentialError('Enter a SAS URL or a token starting with "?"')
    }
    const params = new URLSearchParams(value.slice(1))
    if (!params.has('sig')) {
      throw new CredentialError('The SAS token is missing its signature (sig) parameter')
    }
    return { accountName: '', endpoint: '', container: '', blob: '', sasToken: value }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CredentialError('The SAS URL could not be parsed')
  }

  if (!url.searchParams.get('sig')) {
    throw new CredentialError('The SAS URL is missing its signature (sig) parameter')
  }

  // Typical host: <account>.blob.core.windows.net
  const accountName = url.hostname.split('.')[0] ?? ''
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

  return {
    accountName,
    endpoint: `${url.protocol}//${url.host}`,
    container: segments[0] ?? '',
    blob: segments.slice(1).join('/'),
    sasToken: url.search,
  }
}

/** Extracts the account name for display, for either credential kind. */
export function readAccountName(config: AzureSyncConfig): string {
  if (config.accountName) return config.accountName
  try {
    return config.kind === 'sas'
      ? parseSasUrl(config.sasToken).accountName
      : parseConnectionString(config.connectionString).accountName
  } catch {
    return ''
  }
}

/** Human-readable summary for the settings panel's "verify" step. */
export function describeCredential(
  config: AzureSyncConfig,
): { ok: true; summary: string } | { ok: false; summary: string } {
  try {
    if (config.kind === 'connection-string') {
      const parsed = parseConnectionString(config.connectionString)
      return { ok: true, summary: `Account "${parsed.accountName}" via connection string` }
    }
    const sas = parseSasUrl(config.sasToken)
    if (sas.endpoint) {
      return {
        ok: true,
        summary: `Account "${sas.accountName || 'unknown'}" via SAS at ${sas.endpoint}`,
      }
    }
    return {
      ok: true,
      summary: `Bare SAS token${config.accountName ? ` for "${config.accountName}"` : ''}`,
    }
  } catch (cause) {
    return {
      ok: false,
      summary: cause instanceof Error ? cause.message : 'Unreadable credential',
    }
  }
}

export { normalizeEndpoint }