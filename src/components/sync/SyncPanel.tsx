/**
 * Azure Blob Storage sync panel.
 *
 * The credential is stored inside the master-key-encrypted vault payload, never
 * in plaintext storage, and is stripped before upload. The panel warns about
 * connection strings specifically, because they grant account-wide access.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Info,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { describeCredential, readAccountName } from '@/sync/credentialParsing'
import { SyncError, runSync, verifySyncCredentials } from '@/sync/syncEngine'
import {
  isSyncConfigured,
  missingSyncFields,
  type SyncCredentialKind,
} from '@/sync/types'
import { useVaultStore } from '@/state/vaultStore'
import { VAULT_PAYLOAD_VERSION } from '@/storage/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/PasswordInput'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  const syncPassword = useVaultStore((state) => state.sync.password)
  const settings = useVaultStore((state) => state.settings)
  const items = useVaultStore((state) => state.items)
  const deletedItems = useVaultStore((state) => state.deletedItems)
  const templates = useVaultStore((state) => state.templates)
  const updateSyncConfig = useVaultStore((state) => state.updateSyncConfig)
  const setSyncPassword = useVaultStore((state) => state.setSyncPassword)
  const updateSettings = useVaultStore((state) => state.updateSettings)
  const applyMergedPayload = useVaultStore((state) => state.applyMergedPayload)

  const [passwordDraft, setPasswordDraft] = useState(syncPassword)
  const [verifying, setVerifying] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [verification, setVerification] = useState<{ ok: boolean; text: string } | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(null)

  // Reset the draft when the panel closes so an abandoned edit is discarded.
  useEffect(() => {
    if (!open) setPasswordDraft(syncPassword)
  }, [open, syncPassword])

  const missing = useMemo(() => missingSyncFields(config), [config])
  const credential = useMemo(() => describeCredential(config), [config])
  const account = useMemo(() => readAccountName(config), [config])

  function setKind(kind: SyncCredentialKind): void {
    updateSyncConfig({ kind, accountName: kind === 'connection-string' ? '' : account })
  }

  async function handleVerify(): Promise<void> {
    setVerifying(true)
    setVerification(null)
    try {
      const result = await verifySyncCredentials(config, passwordDraft)
      setVerification({ ok: result.ok, text: result.summary })
      if (result.ok) toast.success('Storage is reachable')
      else toast.error('Could not reach the vault', { description: result.summary })
    } finally {
      setVerifying(false)
    }
  }

  async function handleSync(): Promise<void> {
    if (passwordDraft !== syncPassword) {
      await setSyncPassword(passwordDraft)
    }

    setSyncing(true)
    try {
      const result = await runSync({
        config,
        syncPassword: passwordDraft,
        payload: {
          version: VAULT_PAYLOAD_VERSION,
          items: [...items, ...deletedItems],
          templates,
          settings,
          updatedAt: Date.now(),
          sync: { config, password: passwordDraft },
        },
      })

      // Adopt the merged result locally, keeping this device's own sync
      // credentials, which the remote blob never carried.
      await applyMergedPayload({
        ...result.mergedPayload,
        sync: { config, password: passwordDraft },
      })
      await updateSettings({ lastSyncAt: result.outcome.completedAt })

      const { outcome, initialUpload } = result
      const summary = initialUpload
        ? 'First sync complete. The vault blob was created.'
        : outcome.itemsReceived > 0 || outcome.templatesReceived > 0
          ? `Pulled ${outcome.itemsReceived} item(s) from the remote and kept ${outcome.itemsSent} local change(s).`
          : 'Everything is already up to date.'

      setLastRun(summary)
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Sync to Azure Blob Storage</SheetTitle>
          <SheetDescription>
            Your vault is encrypted with a key derived from the sync password before
            it is uploaded. Azure only ever sees ciphertext.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-slim flex-1 space-y-5 overflow-y-auto p-6">
          {config.kind === 'connection-string' ? (
            <Alert variant="warning">
              <ShieldAlert />
              <AlertTitle>Connection strings grant account-wide access</AlertTitle>
              <AlertDescription>
                A connection string contains the storage account key. Anything able to
                read this browser's storage can act on your entire account, not just
                this vault. A SAS token scoped to one container is the safer option.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="sync-kind">Credential type</Label>
            <Select value={config.kind} onValueChange={(value: SyncCredentialKind) => setKind(value)}>
              <SelectTrigger id="sync-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sas">SAS token (recommended)</SelectItem>
                <SelectItem value="connection-string">Connection string</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync-email">Sync email</Label>
            <Input
              id="sync-email"
              type="email"
              value={config.email}
              onChange={(event) => updateSyncConfig({ email: event.target.value })}
              placeholder="you@example.com"
              autoComplete="username"
            />
            <p className="text-muted-foreground text-xs">
              Combined with the sync password to derive the upload key. It must match
              on every device.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync-password">Sync password</Label>
            <PasswordInput
              id="sync-password"
              value={passwordDraft}
              onChange={(event) => setPasswordDraft(event.target.value)}
              autoComplete="current-password"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs">
              This is a separate password from your master password. It can differ from
              it, and should.
            </p>
          </div>

          {config.kind === 'sas' ? (
            <div className="space-y-2">
              <Label htmlFor="sync-sas">SAS token or URL</Label>
              <TextareaLike
                id="sync-sas"
                value={config.sasToken}
                onChange={(value) => updateSyncConfig({ sasToken: value })}
                placeholder="https://myaccount.blob.core.windows.net/sandiman-vault/vault-encrypted.json?sv=..."
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="sync-conn">Connection string</Label>
              <TextareaLike
                id="sync-conn"
                value={config.connectionString}
                onChange={(value) => updateSyncConfig({ connectionString: value })}
                placeholder="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=..."
                rows={3}
              />
            </div>
          )}

          {config.kind === 'sas' && !config.sasToken.includes('://') ? (
            <div className="space-y-2">
              <Label htmlFor="sync-account">Storage account name</Label>
              <Input
                id="sync-account"
                value={config.accountName}
                onChange={(event) => updateSyncConfig({ accountName: event.target.value })}
                placeholder="myaccount"
              />
              <p className="text-muted-foreground text-xs">
                Only needed when using a bare token rather than a full URL.
              </p>
            </div>
          ) : null}

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
                disabled={syncing || missing.length > 0 || passwordDraft.length === 0}
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
              void setSyncPassword(passwordDraft)
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

/** Multiline credential input, used because SAS URLs and keys are long. */
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