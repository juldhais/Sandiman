/**
 * Clipboard access with automatic clearing.
 *
 * The clipboard is shared system state, so a secret left there outlives the
 * tab that copied it. Every copy is therefore paired with a timer that
 * overwrites the clipboard after a configurable delay.
 */

export interface CopyResult {
  ok: boolean
  /** Why the copy failed, when `ok` is false. */
  error?: string
  /** True when the auto-clear timer was armed. */
  willAutoClear: boolean
  /** Seconds until auto-clear, when armed. */
  clearInSeconds?: number
}

/** Value written over a copied secret when the timer fires. */
const CLEAR_SENTINEL = ''

let activeTimer: ReturnType<typeof setTimeout> | null = null
let lastCopy: { value: string; timer: ReturnType<typeof setTimeout> } | null = null

/** Cancels any pending auto-clear. Exposed for lock and for tests. */
export function cancelPendingClear(): void {
  if (lastCopy) {
    clearTimeout(lastCopy.timer)
    lastCopy = null
  }
}

/**
 * Overwrites the clipboard with the sentinel, best effort.
 *
 * Browsers refuse clipboard writes outside a user gesture in some contexts,
 * which is why this is deliberately not treated as a hard failure: the copy
 * already succeeded, and nagging about a failed cleanup is noise.
 */
async function clearClipboard(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(CLEAR_SENTINEL)
    return true
  } catch {
    return false
  }
}

/**
 * Copies text and arms the auto-clear timer.
 *
 * @param value the secret to copy
 * @param clearAfterSeconds delay before the clipboard is overwritten. Zero or
 * negative disables auto-clear, which the settings screen allows explicitly.
 */
export async function copyWithAutoClear(
  value: string,
  clearAfterSeconds: number,
): Promise<CopyResult> {
  // Replacing a pending secret: clear the old one first so two secrets are
  // never queued to overwrite each other.
  cancelPendingClear()

  try {
    await navigator.clipboard.writeText(value)
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Clipboard access was denied by the browser'
          : 'Could not write to the clipboard',
      willAutoClear: false,
    }
  }

  if (!(clearAfterSeconds > 0)) {
    return { ok: true, willAutoClear: false }
  }

  const timer = setTimeout(() => {
    void clearClipboard().then(() => {
      lastCopy = null
      activeTimer = null
    })
  }, clearAfterSeconds * 1000)

  activeTimer = timer
  lastCopy = { value, timer }

  return { ok: true, willAutoClear: true, clearInSeconds: clearAfterSeconds }
}

/** True while a copied secret is still sitting in the clipboard. */
export function hasPendingClear(): boolean {
  return activeTimer !== null
}

/**
 * Copies text without touching the clipboard lifecycle.
 *
 * Reserved for non-secret values such as usernames and hostnames, where
 * overwriting the user's clipboard would be actively annoying.
 */
export async function copyPlain(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}