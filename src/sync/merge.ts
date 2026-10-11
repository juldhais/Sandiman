/**
 * Merge engine.
 *
 * Two devices editing the same vault converge through a per-record
 * last-write-wins rule keyed on `updatedAt`, with two deliberate refinements:
 *
 *  - **Tombstones win ties.** A record marked `deleted` with timestamp T beats a
 *    live record with timestamp T. Without this, a delete that lands in the
 *    same millisecond as an unrelated edit would resurrect the item.
 *  - **Deletes are sticky.** Once a record is tombstoned, it stays tombstoned
 *    for any strictly older version. This is what stops an edit made offline
 *    before a delete from bringing the record back.
 *
 * Settings are not merged per-key; they follow the newer payload wholesale,
 * which matches how a user thinks about "last device to change a setting wins".
 */
import type {
  VaultItem,
  VaultPayload,
  VaultSettings,
  VaultTemplate,
} from '@/storage/types'

export interface MergeCounts {
  /** Records the remote contributed to the result. */
  received: number
  /** Records the local copy contributed to the result. */
  sent: number
  /** Records dropped because both sides tombstoned them. */
  dropped: number
  /**
   * Records both sides already agreed on.
   *
   * Kept separate because without it, two identical vaults would always look
   * like they had diverged and every sync would report a pointless merge.
   */
  unchanged: number
}

export interface MergeResult<T> {
  value: T
  counts: MergeCounts
}

/**
 * Decides which of two versions of a syncable record wins.
 *
 * @returns the winning record, or null when both sides deleted it.
 */
function pickWinner<T extends { updatedAt: number; deleted: boolean }>(local: T, remote: T): T | null {
  // Both deleted: keep the tombstone rather than dropping it, so the record
  // stays known-deleted and cannot be resurrected by a third device.
  if (local.deleted && remote.deleted) return null

  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt ? local : remote
  }

  // Equal timestamps: deletion wins, as above.
  if (local.deleted !== remote.deleted) return local.deleted ? local : remote
  return local
}

function mergeRecords<T extends { id: string; updatedAt: number; deleted: boolean }>(
  local: readonly T[],
  remote: readonly T[],
): MergeResult<T[]> {
  const remoteById = new Map(remote.map((record) => [record.id, record]))
  const localById = new Map(local.map((record) => [record.id, record]))

  const result: T[] = []
  const counts: MergeCounts = { received: 0, sent: 0, dropped: 0, unchanged: 0 }

  for (const localRecord of local) {
    const remoteRecord = remoteById.get(localRecord.id)

    if (!remoteRecord) {
      result.push(localRecord)
      counts.sent += 1
      continue
    }

    const winner = pickWinner(localRecord, remoteRecord)
    if (!winner) {
      counts.dropped += 1
      continue
    }

    result.push(winner)

    // A record both sides agree on is counted as unchanged. Without this,
    // two identical vaults would always look like they had diverged, and every
    // sync would report a pointless merge.
    if (winner === remoteRecord && winner !== localRecord) counts.received += 1
    else if (winner === localRecord && winner !== remoteRecord) counts.sent += 1
    else counts.unchanged += 1
  }

  // Records the local side has never seen.
  for (const remoteRecord of remote) {
    if (localById.has(remoteRecord.id)) continue
    if (remoteRecord.deleted) {
      // A tombstone for something we never had: retain it so the delete
      // propagates to a third device that does have the record.
      result.push(remoteRecord)
      counts.received += 1
      continue
    }
    result.push(remoteRecord)
    counts.received += 1
  }

  return { value: result, counts }
}

/**
 * Merges item lists.
 *
 * Tombstones are retained in the merged output and filtered by the caller,
 * which keeps deleted records available for the next sync rather than being
 * forgotten locally.
 */
export function mergeItems(
  local: readonly VaultItem[],
  remote: readonly VaultItem[],
): MergeResult<VaultItem[]> {
  return mergeRecords(local, remote)
}

/** Merges template lists by the same rule. */
export function mergeTemplates(
  local: readonly VaultTemplate[],
  remote: readonly VaultTemplate[],
): MergeResult<VaultTemplate[]> {
  return mergeRecords(local, remote)
}

/**
 * Chooses the settings blob to carry forward.
 *
 * Settings are not per-key merged: a user changing the auto-lock timeout on one
 * device expects that to be the setting everywhere, and a per-key merge would
 * produce a combination nobody chose.
 */
export function mergeSettings(
  local: VaultSettings,
  remote: VaultSettings,
  localIsNewer: boolean,
): VaultSettings {
  return localIsNewer ? local : remote
}

export interface PayloadMergeResult {
  payload: Omit<VaultPayload, 'sync'>
  itemCounts: MergeCounts
  templateCounts: MergeCounts
  /** True when the remote payload carried the newer settings. */
  remoteWasNewer: boolean
  /** True when either side had records the other lacked. */
  diverged: boolean
}

/**
 * Merges the shareable portion of two payloads.
 *
 * Sync credentials are excluded by construction: `VaultPayload['sync']` is
 * local-only, so neither side of a merge can leak its own sync password to the
 * other.
 */
export function mergePayloads(
  local: VaultPayload,
  remote: VaultPayload,
): PayloadMergeResult {
  const items = mergeItems(local.items, remote.items)
  const templates = mergeTemplates(local.templates, remote.templates)

  const localIsNewer = local.updatedAt >= remote.updatedAt
  const settings = mergeSettings(local.settings, remote.settings, localIsNewer)

  const diverged =
    items.counts.received > 0 ||
    items.counts.sent > 0 ||
    templates.counts.received > 0 ||
    templates.counts.sent > 0

  const payload: Omit<VaultPayload, 'sync'> = {
    version: local.version,
    items: items.value,
    templates: templates.value,
    settings,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  }

  return {
    payload,
    itemCounts: items.counts,
    templateCounts: templates.counts,
    remoteWasNewer: !localIsNewer,
    diverged,
  }
}

