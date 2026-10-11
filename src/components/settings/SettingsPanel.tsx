/**
 * Settings panel: security preferences, master password change, and vault
 * deletion.
 *
 * Changing the master password re-encrypts the entire vault under a new salt.
 * There is no recovery path, which is why the form asks for the current
 * password and confirms the new one twice.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Lock, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useVaultStore } from '@/state/vaultStore'
import { changeMasterPassword, WrongPasswordError } from '@/storage/vaultService'
import { destroyDatabase } from '@/storage/db'
import { estimateStrength } from '@/generator/password'
import { DEFAULT_ITERATIONS } from '@/crypto/envelope'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { PasswordInput } from '@/components/PasswordInput'
import { ToggleThemeButton } from '@/components/ToggleThemeButton'
import { useTheme } from '@/state/useTheme'

export function SettingsPanel({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useVaultStore((state) => state.settings)
  const updateSettings = useVaultStore((state) => state.updateSettings)
  const lock = useVaultStore((state) => state.lock)
  const templates = useVaultStore((state) => state.templates)
  const items = useVaultStore((state) => state.items)
  const deletedItems = useVaultStore((state) => state.deletedItems)
  const { theme, resolved, setTheme } = useTheme()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [changing, setChanging] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState(false)

  // Clear password fields whenever the panel closes.
  useEffect(() => {
    if (!open) {
      setCurrent('')
      setNext('')
      setConfirm('')
      setChangeError(null)
      setConfirmDelete(false)
    }
  }, [open])

  const strength = estimateStrength(next)
  const canChange =
    current.length > 0 && next.length >= 8 && next === confirm && !changing

  async function handleChangePassword(): Promise<void> {
    if (!canChange) return
    setChanging(true)
    setChangeError(null)
    try {
      await changeMasterPassword(current, next)
      toast.success('Master password changed', {
        description: 'Your vault has been re-encrypted with a fresh salt.',
      })
      setCurrent('')
      setNext('')
      setConfirm('')
      // The session key no longer matches the stored envelope, so the vault
      // must be re-locked and re-unlocked with the new password.
      lock()
    } catch (cause) {
      setChangeError(
        cause instanceof WrongPasswordError
          ? 'The current master password is incorrect'
          : cause instanceof Error
            ? cause.message
            : 'Could not change the password',
      )
    } finally {
      setChanging(false)
    }
  }

  async function handleDeleteVault(): Promise<void> {
    try {
      await destroyDatabase()
      toast.success('Vault deleted from this device')
      // A full reload is the cleanest reset: it drops the in-memory key and
      // every derived view at once.
      window.location.reload()
    } catch {
      toast.error('Could not delete the vault', {
        description: 'Another tab may still be open. Close it and try again.',
      })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Preferences are stored encrypted inside your vault.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-slim flex-1 space-y-6 overflow-y-auto p-6">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Security</h3>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="auto-lock">Auto-lock after inactivity</Label>
                <p className="text-muted-foreground text-xs">
                  Zero keeps the vault unlocked until you lock it manually.
                </p>
              </div>
              <Input
                id="auto-lock"
                type="number"
                min={0}
                max={1440}
                className="w-20"
                value={settings.autoLockMinutes}
                onChange={(event) =>
                  updateSettings({ autoLockMinutes: Number(event.target.value) || 0 })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="lock-blur">Lock when the window loses focus</Label>
                <p className="text-muted-foreground text-xs">
                  Useful on shared machines.
                </p>
              </div>
              <Switch
                id="lock-blur"
                checked={settings.lockOnBlur}
                onCheckedChange={(lockOnBlur) => updateSettings({ lockOnBlur })}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="clipboard-clear">Clear clipboard after</Label>
                <span className="text-muted-foreground text-xs">
                  {settings.clipboardClearSeconds === 0
                    ? 'never'
                    : `${settings.clipboardClearSeconds}s`}
                </span>
              </div>
              <Input
                id="clipboard-clear"
                type="number"
                min={0}
                max={600}
                value={settings.clipboardClearSeconds}
                onChange={(event) =>
                  updateSettings({ clipboardClearSeconds: Number(event.target.value) || 0 })
                }
              />
              <p className="text-muted-foreground text-xs">
                Applies to secrets copied with a copy button.
              </p>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Appearance</h3>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="theme-select">Theme</Label>
              <div className="flex items-center gap-2">
                <select
                  id="theme-select"
                  value={theme}
                  onChange={(event) => setTheme(event.target.value as typeof theme)}
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
                <ToggleThemeButton resolved={resolved} />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Vault</h3>
            <dl className="text-muted-foreground space-y-1 text-xs">
              <div className="flex justify-between">
                <dt>Items</dt>
                <dd className="font-mono-numbers">{items.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Deleted items held for sync</dt>
                <dd className="font-mono-numbers">{deletedItems.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Templates</dt>
                <dd className="font-mono-numbers">
                  {templates.filter((template) => !template.deleted).length}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Key derivation</dt>
                <dd>PBKDF2-HMAC-SHA256</dd>
              </div>
              <div className="flex justify-between">
                <dt>Iterations</dt>
                <dd className="font-mono-numbers">{DEFAULT_ITERATIONS.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Encryption</dt>
                <dd>AES-GCM 256</dd>
              </div>
            </dl>
          </section>

          <Separator />

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Change master password</h3>

            <div className="space-y-2">
              <Label htmlFor="current-password">Current master password</Label>
              <PasswordInput
                id="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                autoComplete="current-password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="next-password">New master password</Label>
              <PasswordInput
                id="next-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                autoComplete="new-password"
              />
              {next.length > 0 ? (
                <>
                  <Progress
                    value={(strength.score + 1) * 20}
                    className="h-1.5"
                    indicatorClassName={
                      strength.score <= 1
                        ? 'bg-destructive'
                        : strength.score === 2
                          ? 'bg-warning'
                          : 'bg-success'
                    }
                  />
                  <p className="text-muted-foreground text-xs">{strength.label}</p>
                </>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <PasswordInput
                id="confirm-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                aria-invalid={confirm.length > 0 && confirm !== next}
              />
              {confirm.length > 0 && confirm !== next ? (
                <p className="text-destructive text-xs">The passwords do not match.</p>
              ) : null}
            </div>

            {changeError ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Could not change the password</AlertTitle>
                <AlertDescription>{changeError}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              onClick={() => void handleChangePassword()}
              disabled={!canChange}
              loading={changing}
            >
              {changing ? <Loader2 className="animate-spin" /> : <Lock />}
              Change password and re-lock
            </Button>

            <p className="text-muted-foreground text-xs">
              Your vault is decrypted and re-encrypted with a new salt. You will be
              asked for the new password immediately afterwards.
            </p>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Danger zone</h3>
            {confirmDelete ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>This cannot be undone</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    Deleting removes the encrypted vault from this browser. If it has
                    been synced to Azure, a copy may still exist there.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDeleteVault()}
                    >
                      Delete anyway
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 />
                Delete this vault
              </Button>
            )}
          </section>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}