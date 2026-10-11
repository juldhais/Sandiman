/** Lightweight Blob SAS URL parsing for settings validation. */
import type { AzureSyncConfig } from './types'

export type SasScope = 'service' | 'container' | 'blob'

export interface ParsedSasUrl {
  scope: SasScope
  accountName: string
}

export type ParsedCredential = ParsedSasUrl

export class CredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}

/**
 * Validates a full HTTPS SAS URL. Service SAS URLs target the storage endpoint;
 * container/blob SAS URLs are also accepted when their path matches the
 * configured destination.
 */
export function parseSasUrl(raw: string, config: AzureSyncConfig): ParsedSasUrl {
  const value = raw.trim()
  if (!value) throw new CredentialError('The Blob SAS URL is empty')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CredentialError('The Blob SAS URL is invalid')
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new CredentialError('The Blob SAS URL must be a valid HTTPS URL')
  }
  if (!url.searchParams.get('sig') || !url.searchParams.get('sv')) {
    throw new CredentialError('The Blob SAS URL must include a signature and version')
  }

  let segments: string[]
  try {
    segments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
  } catch {
    throw new CredentialError('The Blob SAS URL contains an invalid path')
  }

  if (segments.length > 0 && segments[0] !== config.containerName) {
    throw new CredentialError('The SAS URL container does not match the configured container')
  }
  if (segments.length > 1 && segments.slice(1).join('/') !== config.blobName) {
    throw new CredentialError('The SAS URL blob does not match the configured blob')
  }

  return {
    scope: segments.length === 0 ? 'service' : segments.length === 1 ? 'container' : 'blob',
    accountName: url.hostname.split('.')[0] ?? url.hostname,
  }
}

/** Extracts the storage account name for display without showing the SAS. */
export function readAccountName(config: AzureSyncConfig): string {
  try {
    return parseSasUrl(config.sasUrl, config).accountName
  } catch {
    return ''
  }
}

/** Human-readable summary for the settings panel's connection status. */
export function describeCredential(
  config: AzureSyncConfig,
): { ok: true; summary: string } | { ok: false; summary: string } {
  try {
    const parsed = parseSasUrl(config.sasUrl, config)
    return { ok: true, summary: `Account "${parsed.accountName}" via ${parsed.scope}-scoped SAS URL` }
  } catch (cause) {
    return {
      ok: false,
      summary: cause instanceof Error ? cause.message : 'Unreadable SAS URL',
    }
  }
}
