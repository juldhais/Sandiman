/** GitHub repository sync settings and controls. */
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Info,
  Loader2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { describeDestination } from '@/sync/githubConfig'
import { SyncError, runSync, verifySyncCredentials } from '@/sync/syncEngine'
import { isSyncConfigured, missingSyncFields } from '@/sync/types'
import { useVaultStore } from '@/state/vaultStore'
import { VAULT_PAYLOAD_VERSION } from '@/storage/types'
import { verifyMasterPassword } from '@/storage/vaultService'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/PasswordInput'
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

export function SyncPanel({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const config = useVaultStore((state) => state.sync.config)
  const settings = useVaultStore((state) => state.settings)
  const items = useVaultStore((state) => state.items)
  const deletedItems = useVaultStore((state) => state.deletedItems)
  const templates = useVaultStore((state) => state.templates)
  const updateSyncConfig = useVaultStore((state) => state.updateSyncConfig)
  const updateSettings = useVaultStore((state) => state.updateSettings)
  const applyMergedPayload = useVaultStore((state) => state.applyMergedPayload)

  const [masterPassword, setMasterPassword] = useState('')
  const [previousMasterPassword, setPreviousMasterPassword] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [verification, setVerification] = useState<{ ok: boolean; text: string } | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(null)

  const missing = useMemo(() => missingSyncFields(config), [config])
  const destination = useMemo(() => describeDestination(config), [config])

  async function handleVerify(): Promise<void> {
    setVerifying(true)
    setVerification(null)
    try {
      const result = await verifySyncCredentials(config)
      setVerification({ ok: result.ok, text: result.summary })
      if (result.ok) toast.success('GitHub repository is reachable')
      else toast.error('Could not access the GitHub repository', { description: result.summary })
    } finally {
      setVerifying(false)
    }
  }

  async function handleSync(): Promise<void> {
    setSyncing(true)
    try {
      if (masterPassword && !(await verifyMasterPassword(masterPassword))) {
        throw new SyncError('wrong-master-password', 'That is not this vault’s master password.')
      }

      const result = await runSync({
        config,
        masterPassword,
        previousMasterPassword,
        payload: {
          version: VAULT_PAYLOAD_VERSION,
          items: [...items, ...deletedItems],
          templates,
          settings,
          updatedAt: Date.now(),
          sync: { config },
        },
      })

      // Keep this device's PAT and repository configuration; neither is uploaded.
      await applyMergedPayload({ ...result.mergedPayload, sync: { config } })
      await updateSettings({ lastSyncAt: result.outcome.completedAt })

      const { outcome, initialUpload } = result
      const summary = initialUpload
        ? 'First sync complete. The encrypted vault file was created in GitHub.'
        : outcome.itemsReceived > 0 || outcome.templatesReceived > 0
          ? `Pulled ${outcome.itemsReceived} item(s) from GitHub and kept ${outcome.itemsSent} local change(s).`
          : outcome.direction === 'push'
            ? 'Encrypted vault changes committed to GitHub.'
            : 'Everything is already up to date.'

      setLastRun(summary)
      setMasterPassword('')
      setPreviousMasterPassword('')
      toast.success(initialUpload ? 'Vault uploaded' : 'Sync complete', { description: summary })
    } catch (cause) {
      const message = cause instanceof SyncError ? cause.message : 'The sync could not be completed'
      toast.error('Sync failed', { description: message })
      setLastRun(message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setMasterPassword('')
          setPreviousMasterPassword('')
        }
        onOpenChange(nextOpen)
      }}
    >
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Sync to GitHub</SheetTitle>
          <SheetDescription>
            GitHub stores one encrypted vault file in your repository. Use a private repository;
            GitHub commit history retains older encrypted copies. Your PAT is encrypted inside
            this device’s vault and is never uploaded.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-slim flex-1 space-y-5 overflow-y-auto p-6">
          <div className="space-y-2">
            <Label htmlFor="sync-owner">Repository owner</Label>
            <Input
              id="sync-owner"
              value={config.owner}
              onChange={(event) => updateSyncConfig({ owner: event.target.value })}
              placeholder="username or organisation"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sync-repo">Repository</Label>
              <Input
                id="sync-repo"
                value={config.repo}
                onChange={(event) => updateSyncConfig({ repo: event.target.value })}
                placeholder="private-vault"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sync-branch">Branch (optional)</Label>
              <Input
                id="sync-branch"
                value={config.branch}
                onChange={(event) => updateSyncConfig({ branch: event.target.value })}
                placeholder="default branch"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync-path">Encrypted file path</Label>
            <Input
              id="sync-path"
              value={config.path}
              onChange={(event) => updateSyncConfig({ path: event.target.value })}
              placeholder="vault-encrypted.json"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync-token">GitHub personal access token</Label>
            <PasswordInput
              id="sync-token"
              value={config.token}
              onChange={(event) => updateSyncConfig({ token: event.target.value })}
              placeholder="github_pat_…"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs">
              Use a fine-grained token restricted to this repository with Contents read/write access.
              <a
                className="text-primary ml-1 underline underline-offset-2"
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
              >
                Create a token
              </a>
              . The token is stored only inside your encrypted local vault.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync-master-password">Vault master password</Label>
            <PasswordInput
              id="sync-master-password"
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
              autoComplete="current-password"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs">
              Needed for the first sync after unlock. It derives the remote encryption key and is
              used only in memory.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync-previous-password">Previous master password (if needed)</Label>
            <PasswordInput
              id="sync-previous-password"
              value={previousMasterPassword}
              onChange={(event) => setPreviousMasterPassword(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs">
              If this vault password was changed before GitHub was re-encrypted, enter the password
              that protected the GitHub copy. It is used once to migrate that copy to your current password.
            </p>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="sync-auto" className="font-normal">
                Sync automatically
              </Label>
              <Switch
                id="sync-auto"
                checked={config.autoSync}
                onCheckedChange={(autoSync) => updateSyncConfig({ autoSync })}
              />
            </div>

            {config.autoSync ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  Automatic sync uses the in-memory key after one successful manual sync each time
                  you unlock. A changed vault file creates a GitHub commit.
                </p>
                <Label htmlFor="sync-interval">Every (minutes)</Label>
                <Input
                  id="sync-interval"
                  type="number"
                  min={1}
                  max={1440}
                  value={config.autoSyncMinutes}
                  onChange={(event) =>
                    updateSyncConfig({ autoSyncMinutes: Number(event.target.value) || 15 })
                  }
                />
              </div>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Destination</span>
              {destination.ok ? (
                <Badge variant="success">
                  <CheckCircle2 />
                  configured
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle />
                  incomplete
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">{destination.summary}</p>

            {verification ? (
              <Alert variant={verification.ok ? 'success' : 'destructive'}>
                {verification.ok ? <CheckCircle2 /> : <XCircle />}
                <AlertTitle>{verification.ok ? 'Verified' : 'Failed'}</AlertTitle>
                <AlertDescription>{verification.text}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleVerify()}
                disabled={verifying || !isSyncConfigured(config)}
              >
                {verifying ? <Loader2 className="animate-spin" /> : null}
                Test connection
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSync()}
                disabled={syncing || missing.length > 0}
              >
                {syncing ? <Loader2 className="animate-spin" /> : <CloudUpload />}
                Sync now
              </Button>
            </div>

            {missing.length > 0 ? (
              <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Still needed: {missing.join(', ')}
              </p>
            ) : null}

            {lastRun ? (
              <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {lastRun}
              </p>
            ) : null}

            {settings.lastSyncAt ? (
              <p className="text-muted-foreground text-xs">
                Last successful sync {new Date(settings.lastSyncAt).toLocaleString()}
              </p>
            ) : null}
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <Button
            onClick={() => {
              setMasterPassword('')
              onOpenChange(false)
              toast.success('GitHub sync settings saved')
            }}
          >
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
