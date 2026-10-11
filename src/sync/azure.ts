/**
 * Azure Blob Storage client construction.
 *
 * Two credential kinds, two mechanisms:
 *
 *  - **SAS tokens** go through `@azure/storage-blob`, which supports them in the
 *    browser.
 *  - **Connection strings** cannot: Azure's browser bundle omits
 *    `StorageSharedKeyCredential` by design (their docs list Shared Key as
 *    Node-only). `sharedKeyTransport` implements the needed operations directly
 *    against the Blob REST API using WebCrypto signing.
 *
 * This module is imported dynamically by the sync engine, keeping the SDK out
 * of the main bundle.
 */
import {
  AnonymousCredential,
  BlobServiceClient,
  ContainerClient,
  type BlockBlobClient,
} from '@azure/storage-blob'
import {
  CredentialError,
  normalizeEndpoint,
  parseConnectionString,
  parseSasUrl,
  type ParsedCredential,
} from './credentialParsing'
import { SharedKeyBlobTransport } from './sharedKeyTransport'
import type { AzureSyncConfig } from './types'

/**
 * The blob operations the sync engine needs, independent of credential kind.
 */
export interface BlobHandle {
  containerExists(): Promise<boolean>
  createContainer(): Promise<void>
  blobExists(): Promise<boolean>
  download(): Promise<string>
  upload(body: string, leaseId: string): Promise<void>
  acquireLease(leaseId: string, durationSeconds: number): Promise<void>
  releaseLease(leaseId: string): Promise<void>
}

/**
 * Builds the blob handle for the configured credential.
 *
 * @throws {CredentialError} when the credential cannot be parsed. The message is
 * written to be shown directly to the user.
 */
export function createBlobHandle(config: AzureSyncConfig): {
  handle: BlobHandle
  parsed: ParsedCredential
} {
  if (config.kind === 'connection-string') {
    const parsed = parseConnectionString(config.connectionString)
    return {
      handle: new SharedKeyBlobTransport({
        accountName: parsed.accountName,
        accountKey: parsed.accountKey,
        endpoint: parsed.endpoint,
        container: config.containerName,
        blob: config.blobName,
      }),
      parsed,
    }
  }

  const sas = parseSasUrl(config.sasToken)

  if (sas.endpoint) {
    // Building the container client with the SAS already in its URL preserves
    // every query parameter on every derived request, which reconstructing a
    // signature would not.
    const container = new ContainerClient(
      `${sas.endpoint}/${encodeURIComponent(config.containerName)}${sas.sasToken}`,
    )
    return {
      handle: wrapSdkClients(container, container.getBlockBlobClient(config.blobName)),
      parsed: {
        kind: 'sas',
        accountName: sas.accountName,
        endpoint: sas.endpoint,
        container: config.containerName,
        blob: config.blobName,
        sasToken: sas.sasToken,
      },
    }
  }

  // Bare token form: the account must be named explicitly.
  if (!config.accountName) {
    throw new CredentialError('A bare SAS token also needs the storage account name')
  }

  const endpoint = normalizeEndpoint(config.accountName)
  // A bare SAS token needs an anonymous credential object so the SDK attaches
  // the query string to every request rather than treating it as an account key.
  const container = new BlobServiceClient(endpoint, new AnonymousCredential()).getContainerClient(
    config.containerName,
  )
  return {
    handle: wrapSdkClients(container, container.getBlockBlobClient(config.blobName)),
    parsed: {
      kind: 'sas',
      accountName: config.accountName,
      endpoint,
      container: config.containerName,
      blob: config.blobName,
      sasToken: sas.sasToken,
    },
  }
}

/**
 * Adapts the SDK's client objects to `BlobHandle`.
 *
 * The SDK throws on error and returns a boolean from `exists()`, which lines up
 * with the transport, so this is a shape conversion rather than logic.
 */
function wrapSdkClients(container: ContainerClient, blob: BlockBlobClient): BlobHandle {
  return {
    containerExists: () => container.exists(),
    createContainer: async () => {
      await container.create()
    },
    blobExists: () => blob.exists(),
    download: async () => new TextDecoder().decode(await blob.downloadToBuffer()),
    upload: async (body, leaseId) => {
      await blob.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        // Lease id plus an ETag check: the upload fails rather than clobbering
        // a blob another device changed.
        conditions: { ifMatch: '*', leaseId },
      })
    },
    acquireLease: async (leaseId, durationSeconds) => {
      await blob.getBlobLeaseClient(leaseId).acquireLease(durationSeconds)
    },
    releaseLease: async (leaseId) => {
      await blob.getBlobLeaseClient(leaseId).releaseLease()
    },
  }
}