/**
 * Asks for the master password when this vault's salt differs from the GitHub
 * copy's, which happens when the repository was first written by another
 * device. The password is only used to verify the GitHub copy and to re-key
 * this vault to its salt, and is discarded when the dialog closes.
 */
import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SyncPasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (password: string) => Promise<void>
}

export function SyncPasswordDialog({ open, onOpenChange, onSubmit }: SyncPasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean): void {
    if (busy) return
    if (!next) {
      setPassword('')
      setError(null)
    }
    onOpenChange(next)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(password)
      setPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not re-encrypt the GitHub copy.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect this vault to the GitHub copy</DialogTitle>
          <DialogDescription>
            The GitHub copy was encrypted with a different salt than this vault. Enter the master
            password for the GitHub copy. This vault will be re-encrypted with the GitHub copy's
            salt so all devices match. The password is not stored.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="sync-master-password">Master password</Label>
            <Input
              id="sync-master-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!password || busy}>
              {busy && <Loader2 className="animate-spin" />}
              Connect and sync
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
