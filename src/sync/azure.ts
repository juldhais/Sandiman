/** Browser-compatible Azure Blob Storage operations backed by the official SDK. */
import { BlobServiceClient, BlockBlobClient, ContainerClient } from '@azure/storage-blob'
import { parseSasUrl, type ParsedCredential } from './credentialParsing'
import type { AzureSyncConfig } from './types'

/** The blob operations the sync engine needs. */
export interface BlobHandle {
  containerExists(): Promise<boolean>
  createContainer(): Promise<void>
  blobExists(): Promise<boolean>
  createBlobIfNotExists(body: string): Promise<boolean>
  download(): Promise<string>
  upload(body: string, leaseId: string): Promise<void>
  acquireLease(leaseId: string, durationSeconds: number): Promise<void>
  releaseLease(leaseId: string): Promise<void>
}

/**
 * Creates SDK clients directly from a Blob SAS URL. Narrowly scoped container
 * and blob URLs are supported as long as they match the configured destination.
 */
export function createBlobHandle(config: AzureSyncConfig): {
  handle: BlobHandle
  parsed: ParsedCredential
} {
  const parsed = parseSasUrl(config.sasUrl, config)
  const sasUrl = config.sasUrl.trim()
  const container =
    parsed.scope === 'service'
      ? new BlobServiceClient(sasUrl).getContainerClient(config.containerName)
      : parsed.scope === 'container'
        ? new ContainerClient(sasUrl)
        : null
  const blob =
    parsed.scope === 'blob'
      ? new BlockBlobClient(sasUrl)
      : container!.getBlockBlobClient(config.blobName)

  return {
    parsed,
    handle: {
      containerExists: () =>
        parsed.scope === 'blob' ? Promise.resolve(true) : container!.exists(),
      async createContainer() {
        if (parsed.scope === 'blob') return
        if (parsed.scope === 'container') {
          throw new Error(
            'Create the container in Azure before using a container-scoped SAS URL.',
          )
        }
        await container!.createIfNotExists()
      },
      blobExists: () => blob.exists(),
      async createBlobIfNotExists(body) {
        const contentLength = new TextEncoder().encode(body).byteLength
        try {
          await blob.upload(body, contentLength, {
            blobHTTPHeaders: { blobContentType: 'application/json' },
            conditions: { ifNoneMatch: '*' },
          })
          return true
        } catch (cause) {
          const statusCode =
            typeof cause === 'object' && cause !== null && 'statusCode' in cause
              ? (cause as { statusCode?: unknown }).statusCode
              : undefined
          // Another first-time device may have created the blob first.
          if (statusCode === 409 || statusCode === 412) return false
          throw cause
        }
      },
      async download() {
        const response = await blob.download()
        const body = await response.blobBody
        if (!body) throw new Error('Azure returned an empty blob response')
        return body.text()
      },
      async upload(body, leaseId) {
        const contentLength = new TextEncoder().encode(body).byteLength
        await blob.upload(body, contentLength, {
          blobHTTPHeaders: { blobContentType: 'application/json' },
          conditions: { ifMatch: '*', leaseId },
        })
      },
      async acquireLease(leaseId, durationSeconds) {
        await blob.getBlobLeaseClient(leaseId).acquireLease(durationSeconds)
      },
      async releaseLease(leaseId) {
        await blob.getBlobLeaseClient(leaseId).releaseLease()
      },
    },
  }
}
