/**
 * Root component and screen routing.
 *
 * There is no router: the app has exactly four screens and which one is shown
 * depends only on whether a vault exists, is unlocked, or not.
 */
import { useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useVaultStore } from '@/state/vaultStore'
import { useAutoLock } from '@/state/autoLock'
import { useAutoSync } from '@/state/autoSync'
import { Onboarding } from '@/screens/Onboarding'
import { Unlock } from '@/screens/Unlock'
import { Workspace } from '@/screens/Workspace'

export default function App() {
  const ready = useVaultStore((state) => state.ready)
  const initialize = useVaultStore((state) => state.initialize)

  // Probe IndexedDB once on mount to decide the opening screen.
  useEffect(() => {
    void initialize()
  }, [initialize])

  // Auto-lock is inert while the vault is locked; the hook itself only arms
  // timers while settings are readable.
  useAutoLock()
  useAutoSync()

  return (
    <TooltipProvider>
      {ready ? <Screen /> : <Booting />}
      <Toaster />
    </TooltipProvider>
  )
}

function Screen() {
  const screen = useVaultStore((state) => state.screen)

  switch (screen) {
    case 'onboarding':
      return <Onboarding />
    case 'unlock':
      return <Unlock />
    case 'vault':
      return <Workspace />
    default:
      return <Booting />
  }
}

/**
 * Placeholder for the first paint.
 *
 * Shown while IndexedDB is being read. Deliberately unstyled rather than a
 * spinner: a brief flash of the app shell is less jarring than a loading
 * animation on every reload.
 */
function Booting() {
  return (
    <div className="bg-background flex min-h-dvh items-center justify-center">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <span className="bg-primary size-2 animate-pulse rounded-full" />
        Opening vault
      </div>
    </div>
  )
}
