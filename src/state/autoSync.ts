/**
 * Background sync.
 *
 * Runs on an interval while the vault is unlocked and auto-sync is enabled.
 * A run is skipped when one is already in flight, so a slow network cannot
 * stack up overlapping syncs.
 */
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { hasSyncSessionKey, SyncError, runSync } from '@/sync/syncEngine'
import { isSyncConfigured } from '@/sync/types'
import { useVaultStore } from './vaultStore'
import { VAULT_PAYLOAD_VERSION, type VaultPayload } from '@/storage/types'

export function useAutoSync(): void {
  const screen = useVaultStore((state) => state.screen)
  const config = useVaultStore((state) => state.sync.config)
  const settings = useVaultStore((state) => state.settings)
  const items = useVaultStore((state) => state.items)
  const deletedItems = useVaultStore((state) => state.deletedItems)
  const templates = useVaultStore((state) => state.templates)
  const updateSettings = useVaultStore((state) => state.updateSettings)
  const applyMergedPayload = useVaultStore((state) => state.applyMergedPayload)

  const runningRef = useRef(false)

  const enabled = screen === 'vault' && config.autoSync && isSyncConfigured(config)

  const sync = useCallback(async () => {
    if (runningRef.current || !hasSyncSessionKey()) return
    runningRef.current = true
    try {
      const payload: VaultPayload = {
        version: VAULT_PAYLOAD_VERSION,
        items: [...items, ...deletedItems],
        templates,
        settings,
        updatedAt: Date.now(),
        sync: { config },
      }

      const result = await runSync({ config, payload })

      await applyMergedPayload({ ...result.mergedPayload, sync: { config } })
      await updateSettings({ lastSyncAt: result.outcome.completedAt })
    } catch (cause) {
      // Background failures are surfaced once and then ignored: repeating a
      // toast every interval would be worse than staying quiet until the next
      // successful run or a manual attempt.
      if (cause instanceof SyncError && cause.kind === 'auth') {
        toast.error('Background sync stopped', {
          description: cause.message,
        })
      }
    } finally {
      runningRef.current = false
    }
  }, [applyMergedPayload, config, deletedItems, items, settings, templates, updateSettings])

  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(
      () => void sync(),
      Math.max(1, config.autoSyncMinutes) * 60_000,
    )
    return () => clearInterval(interval)
  }, [enabled, config.autoSyncMinutes, sync])
}
