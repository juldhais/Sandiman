/**
 * Unlock screen.
 *
 * Derivation runs at 600,000 PBKDF2 iterations, which takes on the order of a
 * second. The progress state exists so that wait reads as work happening rather
 * than as a broken button.
 */
import { useState } from 'react'
import { AlertTriangle, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { useVaultStore } from '@/state/vaultStore'
import { useTheme } from '@/state/useTheme'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/PasswordInput'
import { ToggleThemeButton } from '@/components/ToggleThemeButton'

export function Unlock() {
  const unlockVault = useVaultStore((state) => state.unlockVault)
  const busy = useVaultStore((state) => state.busy)
  const error = useVaultStore((state) => state.error)
  const clearError = useVaultStore((state) => state.clearError)
  const lock = useVaultStore((state) => state.lock)

  const [password, setPassword] = useState('')
  const { resolved } = useTheme()

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (busy || password.length === 0) return

    const ok = await unlockVault(password)
    if (ok) setPassword('')
  }

  return (
    <main className="bg-muted/40 relative flex min-h-dvh items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ToggleThemeButton resolved={resolved} />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <div className="bg-primary/10 text-primary mx-auto flex size-12 items-center justify-center rounded-xl">
            <ShieldCheck className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Vault locked</h1>
          <p className="text-muted-foreground text-sm">
            Enter your master password to decrypt your vault.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="bg-card space-y-4 rounded-xl border p-6 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="unlock-password">Master password</Label>
            <PasswordInput
              id="unlock-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                if (error) clearError()
              }}
              autoComplete="current-password"
              autoFocus
              spellCheck={false}
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Could not unlock</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            disabled={password.length === 0}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Lock />}
            {busy ? 'Deriving key' : 'Unlock'}
          </Button>
        </form>

        {error?.includes('damaged') ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              lock()
              clearError()
            }}
          >
            Return to the start
          </Button>
        ) : null}
      </div>
    </main>
  )
}