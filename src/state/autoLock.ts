/**
 * Auto-lock on inactivity.
 *
 * Two independent triggers, both user-configurable:
 *  - an idle timeout reset by any pointer, keyboard, or scroll activity
 *  - window blur, for users who switch away from a shared machine
 *
 * The idle timer is a debounce, not a polling loop: activity re-arms a single
 * timeout rather than resetting an interval, so an idle tab does no work at all.
 */
import { useEffect, useRef } from 'react'
import { useVaultStore } from './vaultStore'

/** Events that count as "the user is present". */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'visibilitychange',
] as const

export function useAutoLock(): void {
  const autoLockMinutes = useVaultStore((state) => state.settings.autoLockMinutes)
  const lockOnBlur = useVaultStore((state) => state.settings.lockOnBlur)
  const lock = useVaultStore((state) => state.lock)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read inside the handler so re-arming does not need `lock` in its deps.
  const lockRef = useRef(lock)
  // Synced in an effect rather than during render: writing a ref while
  // rendering is not safe when React discards and re-renders a component.
  useEffect(() => {
    lockRef.current = lock
  }, [lock])

  useEffect(() => {
    // Zero disables the idle timer entirely.
    if (autoLockMinutes <= 0) return

    const arm = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        lockRef.current()
      }, autoLockMinutes * 60_000)
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, arm, { passive: true })
    }
    arm()

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, arm)
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [autoLockMinutes])

  useEffect(() => {
    if (!lockOnBlur) return
    const onBlur = () => {
      // A tab switch triggers blur on the window; lock immediately.
      lockRef.current()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [lockOnBlur])
}

/** Locks the vault when the tab is hidden for an extended period. */
export function useHiddenTabLock(minutes: number): void {
  const lock = useVaultStore((state) => state.lock)
  const lockRef = useRef(lock)
  useEffect(() => {
    lockRef.current = lock
  }, [lock])

  useEffect(() => {
    if (minutes <= 0) return
    let timer: ReturnType<typeof setTimeout> | null = null

    const onVisibility = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(() => lockRef.current(), minutes * 60_000)
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer !== null) clearTimeout(timer)
    }
  }, [minutes])
}
