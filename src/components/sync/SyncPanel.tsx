/**
 * Azure Blob Storage sync panel.
 *
 * Azure settings are stored inside the master-key-encrypted vault payload and
 * stripped before upload. Browser sync uses a Blob SAS URL.
 */
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
import { describeCredential, readAccountName } from '@/sync/credentialParsing'
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
  const [verifying, setVerifying] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [verification, setVerification] = useState<{ ok: boolean; text: string } | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(null)

  const missing = useMemo(() => missingSyncFields(config), [config])
  const credential = useMemo(() => describeCredential(config), [config])
  const account = useMemo(() => readAccountName(config), [config])

  async function handleVerify(): Promise<void> {
    setVerifying(true)
    setVerification(null)
    try {
      const result = await verifySyncCredentials(config)
      setVerification({ ok: result.ok, text: result.summary })
      if (result.ok) toast.success('Storage is reachable')
      else toast.error('Could not reach the vault', { description: result.summary })
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
        payload: {
          version: VAULT_PAYLOAD_VERSION,
          items: [...items, ...deletedItems],
          templates,
          settings,
          updatedAt: Date.now(),
          sync: { config },
        },
      })

      // Keep this device's own Azure configuration, which the remote blob never carried.
      await applyMergedPayload({
        ...result.mergedPayload,
        sync: { config },
      })
      await updateSettings({ lastSyncAt: result.outcome.completedAt })

      const { outcome, initialUpload } = result
      const summary = initialUpload
        ? 'First sync complete. The vault blob was created.'
        : outcome.itemsReceived > 0 || outcome.templatesReceived > 0
          ? `Pulled ${outcome.itemsReceived} item(s) from the remote and kept ${outcome.itemsSent} local change(s).`
          : 'Everything is already up to date.'

      setLastRun(summary)
      setMasterPassword('')
      toast.success(initialUpload ? 'Vault uploaded' : 'Sync complete', {
        description: summary,
      })
    } catch (cause) {
      const message =
        cause instanceof SyncError ? cause.message : 'The sync could not be completed'
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
        if (!nextOpen) setMasterPassword('')
        onOpenChange(nextOpen)
      }}
    >
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Sync to Azure Blob Storage</SheetTitle>
          <SheetDescription>
            Your vault is encrypted with a key derived from your master password
            before upload. Use the same master password on each device; Azure only
            receives ciphertext. Changing your master password makes existing remote
            data unreadable until it is migrated.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-slim flex-1 space-y-5 overflow-y-auto p-6">
          <div className="space-y-2">
            <Label htmlFor="sync-master-password">Master password</Label>
            <PasswordInput
              id="sync-master-password"
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
              autoComplete="current-password"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs">
              Needed when syncing for the first time on this device after unlocking.
              It is used only in memory and is never saved with sync settings.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync-sas-url">Blob SAS URL</Label>
            <TextareaLike
              id="sync-sas-url"
              value={config.sasUrl}
              onChange={(value) => updateSyncConfig({ sasUrl: value })}
              placeholder="https://<account>.blob.core.windows.net/?sv=...&sig=..."
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              Use a SAS URL with read, write, and lease permissions. Service-scoped
              URLs also need create permission if the container is missing. Container-
              or blob-scoped URLs must match the destination, and the container must exist.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sync-container">Container</Label>
              <Input
                id="sync-container"
                value={config.containerName}
                onChange={(event) => updateSyncConfig({ containerName: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sync-blob">Blob name</Label>
              <Input
                id="sync-blob"
                value={config.blobName}
                onChange={(event) => updateSyncConfig({ blobName: event.target.value })}
              />
            </div>
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
                  Automatic sync uses a temporary key after a successful manual sync.
                  Sync manually once after each unlock to enable it for that session.
                </p>
                <Label htmlFor="sync-interval">Every (minutes)</Label>
                <Input
                  id="sync-interval"
                  type="number"
                  min={1}
                  max={1440}
                  value={config.autoSyncMinutes}
                  onChange={(event) =>
                    updateSyncConfig({ autoSyncMinutes: Number(event.target.value) || 5 })
                  }
                />
              </div>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Connection</span>
              {credential.ok ? (
                <Badge variant="success">
                  <CheckCircle2 />
                  {account || 'configured'}
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle />
                  incomplete
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">{credential.summary}</p>

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
              toast.success('Sync settings saved')
            }}
          >
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** Multiline credential input, used because SAS URLs are long. */
function TextareaLike({
  id,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      spellCheck={false}
      className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
    />
  )
}
