/**
 * IndexedDB schema for the local, at-rest vault.
 *
 * Two stores, deliberately separated:
 *
 *  - `vault` holds the encrypted header (templates/settings).
 *  - `items` holds one authenticated ciphertext per item, keyed only by its
 *    random ID. Neither IDs nor other item metadata are indexed.
 *  - `meta` holds unencrypted *bookkeeping only* — the KDF descriptor and
 *    timestamps. The salt and iteration count are not secret; the ciphertext
 *    is. Nothing here reveals vault contents.
 *
 * Azure sync configuration is stored inside the master-key-encrypted payload.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Envelope, KdfParams, RecordCiphertext } from '@/crypto/envelope'

export const DATABASE_NAME = 'sandiman'
export const DATABASE_VERSION = 1

export const VAULT_STORE = 'vault'
export const META_STORE = 'meta'
export const ITEM_STORE = 'items'

/** Key of the encrypted header record. The vault is a singleton by design. */
export const VAULT_KEY = 'primary'

/** Keys within the meta store. */
export const META_KEYS = {
  /** KDF descriptor of the master-password envelope. */
  masterKdf: 'master-kdf',
  /** Epoch millis the vault was created. */
  createdAt: 'created-at',
  /** Epoch millis of the last successful local write. */
  lastLocalWriteAt: 'last-local-write',
  /** Opaque marker used to tell "created" from "not set up". */
  initialized: 'initialized',
} as const

interface MetaValue {
  [META_KEYS.masterKdf]: Envelope['kdf'] | null
  [META_KEYS.createdAt]: number | null
  [META_KEYS.lastLocalWriteAt]: number | null
  [META_KEYS.initialized]: boolean | null
}

export interface VaultRecord {
  key: typeof VAULT_KEY
  envelope: Envelope
  /** Epoch millis this record was written. */
  updatedAt: number
}

export interface StoredItemRecord {
  id: string
  ciphertext: RecordCiphertext
}

interface SandimanDB extends DBSchema {
  [VAULT_STORE]: {
    key: string
    value: VaultRecord
  }
  [META_STORE]: {
    key: string
    value: unknown
  }
  [ITEM_STORE]: {
    key: string
    value: StoredItemRecord
  }
}

let dbPromise: Promise<IDBPDatabase<SandimanDB>> | null = null

function getDB(): Promise<IDBPDatabase<SandimanDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SandimanDB>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(VAULT_STORE)) {
          db.createObjectStore(VAULT_STORE, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE)
        }
        if (!db.objectStoreNames.contains(ITEM_STORE)) {
          db.createObjectStore(ITEM_STORE, { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

/** True when a vault has been created on this device. */
export async function isInitialized(): Promise<boolean> {
  const db = await getDB()
  const flag = await db.get(META_STORE, META_KEYS.initialized)
  return flag === true
}

/** Reads a meta value by key. */
export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await getDB()
  const value = await db.get(META_STORE, key)
  return (value as T | undefined) ?? null
}

/** Writes a meta value by key. */
export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put(META_STORE, value, key)
}

/** Writes several meta values in one transaction. */
export async function setMetaEntries(entries: Record<string, unknown>): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(META_STORE, 'readwrite')
  await Promise.all(Object.entries(entries).map(([key, value]) => tx.store.put(value, key)))
  await tx.done
}

/** Returns the stored envelope, or null when the vault has never been created. */
export async function readEnvelope(): Promise<Envelope | null> {
  const db = await getDB()
  const record = await db.get(VAULT_STORE, VAULT_KEY)
  return record?.envelope ?? null
}

/** Returns every encrypted item record. No item content is indexed. */
export async function readItemRecords(): Promise<StoredItemRecord[]> {
  const db = await getDB()
  return db.getAll(ITEM_STORE)
}

/**
 * Writes changed encrypted records and optionally replaces the encrypted
 * header. All ciphertext is prepared before this transaction is opened so the
 * transaction stays live and the header/items commit atomically.
 */
export async function writeLocalChanges(input: {
  header?: Envelope
  upserts: StoredItemRecord[]
  deletes?: string[]
  kdf: KdfParams
  now?: number
}): Promise<void> {
  const db = await getDB()
  const now = input.now ?? Date.now()
  const tx = db.transaction([VAULT_STORE, ITEM_STORE, META_STORE], 'readwrite')
  if (input.header) {
    await tx.objectStore(VAULT_STORE).put({
      key: VAULT_KEY,
      envelope: input.header,
      updatedAt: now,
    } satisfies VaultRecord)
  }
  const items = tx.objectStore(ITEM_STORE)
  await Promise.all([
    ...input.upserts.map((record) => items.put(record)),
    ...(input.deletes ?? []).map((id) => items.delete(id)),
    tx.objectStore(META_STORE).put(input.kdf, META_KEYS.masterKdf),
    tx.objectStore(META_STORE).put(now, META_KEYS.lastLocalWriteAt),
  ])
  await tx.done
}

/** Atomically installs a complete per-item vault, used at creation and re-keying. */
export async function replaceLocalVault(input: {
  header: Envelope
  records: StoredItemRecord[]
  kdf: KdfParams
  now?: number
  createdAt?: number
}): Promise<void> {
  const db = await getDB()
  const now = input.now ?? Date.now()
  const tx = db.transaction([VAULT_STORE, ITEM_STORE, META_STORE], 'readwrite')
  await tx.objectStore(VAULT_STORE).put({
    key: VAULT_KEY,
    envelope: input.header,
    updatedAt: now,
  } satisfies VaultRecord)
  const items = tx.objectStore(ITEM_STORE)
  await items.clear()
  await Promise.all([
    ...input.records.map((record) => items.put(record)),
    tx.objectStore(META_STORE).put(input.kdf, META_KEYS.masterKdf),
    tx.objectStore(META_STORE).put(now, META_KEYS.lastLocalWriteAt),
    tx.objectStore(META_STORE).put(true, META_KEYS.initialized),
    ...(input.createdAt === undefined
      ? []
      : [tx.objectStore(META_STORE).put(input.createdAt, META_KEYS.createdAt)]),
  ])
  await tx.done
}

/** Returns the epoch millis of the last local write, or null. */
export async function readLastLocalWrite(): Promise<number | null> {
  return getMeta<number>(META_KEYS.lastLocalWriteAt)
}

/** Wipes every local trace of the vault. Used by "delete vault". */
export async function destroyDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to delete database'))
    // Another tab may still hold the database open.
    request.onblocked = () => resolve()
  })
}

export type { MetaValue }
