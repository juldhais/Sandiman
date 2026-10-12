/**
 * Onboarding: creates the vault and sets the master password.
 *
 * This screen is also where the zero-knowledge model is explained, because the
 * master password is the one thing the user can never lose and never change
 * their mind about easily.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, Eye, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { estimateStrength } from '@/generator/password'
import { useVaultStore } from '@/state/vaultStore'
import {
  DEFAULT_GITHUB_SYNC_CONFIG,
  isSyncConfigured,
  missingSyncFields,
  type GitHubSyncConfig,
} from '@/sync/types'
import { normaliseConfig } from '@/sync/githubConfig'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/PasswordInput'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'

const MIN_LENGTH = 8

export function Onboarding() {
  const createNewVault = useVaultStore((state) => state.createNewVault)
  const busy = useVaultStore((state) => state.busy)
  const error = useVaultStore((state) => state.error)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [githubSyncEnabled, setGithubSyncEnabled] = useState(false)
  const [githubConfig, setGithubConfig] = useState<GitHubSyncConfig>({
    ...DEFAULT_GITHUB_SYNC_CONFIG,
  })

  const strength = useMemo(() => estimateStrength(password), [password])
  const matches = password.length > 0 && password === confirm
  const longEnough = password.length >= MIN_LENGTH
  const syncError = useMemo(() => {
    if (!githubSyncEnabled) return null
    if (!isSyncConfigured(githubConfig)) {
      return `Still needed: ${missingSyncFields(githubConfig).join(', ')}`
    }
    try {
      normaliseConfig(githubConfig)
      return null
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Check the GitHub sync settings.'
    }
  }, [githubConfig, githubSyncEnabled])
  const canSubmit = longEnough && matches && !syncError && !busy

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSubmit) return

    const ok = await createNewVault(
      password,
      confirm,
      githubSyncEnabled ? normaliseConfig(githubConfig) : undefined,
    )
    if (ok) {
      toast.success('Vault created', {
        description: 'Your master password protects everything in it.',
      })
      // Cleared so the plaintext does not linger in component state.
      setPassword('')
      setConfirm('')
      setGithubConfig((config) => ({ ...config, token: '' }))
    }
  }

  return (
    <main className="bg-muted/40 flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <div className="bg-primary/10 text-primary mx-auto flex size-12 items-center justify-center rounded-xl">
            <ShieldCheck className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Sandiman</h1>
          <p className="text-muted-foreground text-sm">
            Create a master password to encrypt your vault. It never leaves this
            device and cannot be recovered.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="bg-card space-y-4 rounded-xl border p-6 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="master-password">Master password</Label>
            <PasswordInput
              id="master-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              autoFocus
              spellCheck={false}
              aria-describedby="strength-hint"
            />
            <div className="space-y-1">
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
              <p id="strength-hint" className="text-muted-foreground text-xs">
                {password.length === 0
                  ? `Use at least ${MIN_LENGTH} characters.`
                  : `${strength.label} · ${password.length} characters`}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm master password</Label>
            <PasswordInput
              id="confirm-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              aria-invalid={confirm.length > 0 && !matches}
            />
            {confirm.length > 0 && !matches ? (
              <p className="text-destructive text-xs">The two passwords do not match.</p>
            ) : null}
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="onboarding-github-sync" className="font-medium">
                  Set up GitHub sync (optional)
                </Label>
                <p className="text-muted-foreground text-xs">
                  Set up a destination for encrypted sync. Nothing is uploaded during onboarding; start
                  the first sync later from Settings.
                </p>
              </div>
              <Switch
                id="onboarding-github-sync"
                checked={githubSyncEnabled}
                onCheckedChange={setGithubSyncEnabled}
              />
            </div>

            {githubSyncEnabled ? (
              <div className="space-y-3 border-t pt-3">
                <Alert>
                  <AlertDescription>
                    Use a private repository. GitHub keeps old encrypted copies in commit history. Your
                    token is stored only inside this device’s encrypted vault and is never uploaded.
                  </AlertDescription>
                </Alert>
                <div className="space-y-2">
                  <Label htmlFor="onboarding-sync-owner">Repository owner</Label>
                  <Input
                    id="onboarding-sync-owner"
                    value={githubConfig.owner}
                    onChange={(event) =>
                      setGithubConfig((config) => ({ ...config, owner: event.target.value }))
                    }
                    placeholder="username or organisation"
                    autoComplete="off"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="onboarding-sync-repo">Repository</Label>
                    <Input
                      id="onboarding-sync-repo"
                      value={githubConfig.repo}
                      onChange={(event) =>
                        setGithubConfig((config) => ({ ...config, repo: event.target.value }))
                      }
                      placeholder="private-vault"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="onboarding-sync-branch">Branch (optional)</Label>
                    <Input
                      id="onboarding-sync-branch"
                      value={githubConfig.branch}
                      onChange={(event) =>
                        setGithubConfig((config) => ({ ...config, branch: event.target.value }))
                      }
                      placeholder="default branch"
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="onboarding-sync-path">Encrypted file path</Label>
                  <Input
                    id="onboarding-sync-path"
                    value={githubConfig.path}
                    onChange={(event) =>
                      setGithubConfig((config) => ({ ...config, path: event.target.value }))
                    }
                    placeholder="vault-encrypted.json"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="onboarding-sync-token">GitHub personal access token</Label>
                  <PasswordInput
                    id="onboarding-sync-token"
                    value={githubConfig.token}
                    onChange={(event) =>
                      setGithubConfig((config) => ({ ...config, token: event.target.value }))
                    }
                    placeholder="github_pat_…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-muted-foreground text-xs">
                    Use a fine-grained token with Contents read/write access, restricted to this repository.{' '}
                    <a
                      className="text-primary underline underline-offset-2"
                      href="https://github.com/settings/personal-access-tokens/new"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Create a token
                    </a>
                    .
                  </p>
                </div>
                {syncError ? <p className="text-destructive text-xs">{syncError}</p> : null}
              </div>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Could not create the vault</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={!canSubmit} loading={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Create vault
          </Button>
        </form>

        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>There is no password reset</AlertTitle>
          <AlertDescription className="space-y-1.5">
            <p>
              Your vault is encrypted before it is stored, and only this password
              can decrypt it. Losing it means losing the vault permanently.
            </p>
            <p className="flex items-center gap-1.5">
              <Eye className="inline size-3.5" />
              Keep a copy of this password somewhere safe and offline.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    </main>
  )
}
