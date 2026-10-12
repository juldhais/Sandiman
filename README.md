# Sandiman

A zero-knowledge password manager that runs entirely in the browser. There is no
backend and no account: your vault is encrypted on your device, stored in
IndexedDB, and optionally synced as ciphertext to a GitHub repository you
control.

Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Zustand · Zod

## Contents

- [What "zero knowledge" means here](#what-zero-knowledge-means-here)
- [IndexedDB layout](#indexeddb-layout)
- [Getting started](#getting-started)
- [Deploying to Azure Static Web Apps](#deploying-to-azure-static-web-apps)
- [Project structure](#project-structure)
- [Business logic](#business-logic)
  - [Vault lifecycle](#vault-lifecycle)
  - [Templates and fields](#templates-and-fields)
  - [Items](#items)
  - [Expiry tracking](#expiry-tracking)
  - [Copying secrets](#copying-secrets)
  - [Password generation](#password-generation)
  - [Locking](#locking)
  - [Sync](#sync)
- [GitHub credentials](#github-credentials)
- [Design decisions](#design-decisions)
- [Threat model](#threat-model)

## What "zero knowledge" means here

The master password never leaves the browser. It is stretched with
PBKDF2-HMAC-SHA256 (600,000 iterations) into a non-extractable AES-GCM-256 key,
and vault data is encrypted under that key before anything touches disk. Local
IndexedDB stores an encrypted header and one authenticated ciphertext per item;
GitHub sync still uses a single encrypted payload envelope. The local header and
sync envelope contain only:

- the KDF descriptor (algorithm, iteration count, salt) — not secret
- the envelope version — format metadata, not secret
- the 12-byte IV — not secret
- the ciphertext — the only protected part

Losing the master password means losing the vault. There is no recovery key and
no reset path, by design.

## IndexedDB layout

The local database is named `sandiman` (initial IndexedDB version 1) and has
three object stores. Secret-bearing content is encrypted before it is written;
the database does not store item titles, values, tags, or notes as plaintext.

### `vault` — encrypted header

One record, keyed by `key: "primary"`:

```ts
{
  key: 'primary',
  envelope: { v, kdf: { name, iterations, salt }, iv, data },
  updatedAt, // write timestamp
}
```

`envelope.data` is AES-GCM ciphertext for the small local header JSON. That
header contains the payload version, templates, settings (including local GitHub
sync configuration), the timestamp, and `localItemCount`. Its `items` array is
empty: item contents live in the `items` store below. `localItemCount` is
encrypted and lets unlock detect missing item records. The envelope's KDF
descriptor and IV are visible, but are not secret.

### `items` — one encrypted record per item

The object store uses `id` as its key path. Each record has this shape:

```ts
{
  id: 'random-item-id',
  ciphertext: { v, iv, data },
}
```

`ciphertext.data` contains the serialized complete item (including its ID,
title, values, custom fields, tags, notes, and deletion state), encrypted with
AES-GCM under the master key. The random item ID is also authenticated as
additional data, binding ciphertext to its store key and preventing records
from being swapped. The ID and approximate ciphertext size remain visible to
someone inspecting IndexedDB; the item's other fields do not. Ordinary item
edits rewrite only that item's ciphertext. Adding or physically removing a
record also updates the encrypted header's item count in the same IndexedDB
transaction. A user delete is a soft-delete tombstone kept for sync, so it
rewrites that item's ciphertext without reducing the record count.

### `meta` — unencrypted bookkeeping

This key/value store contains:

| Key | Value | Purpose |
| --- | --- | --- |
| `initialized` | boolean | Distinguishes a new database from a created vault |
| `master-kdf` | KDF name, iteration count, and salt | Non-secret KDF bookkeeping; also present in the header envelope |
| `created-at` | epoch milliseconds | Vault creation time |
| `last-local-write` | epoch milliseconds | Last successful local write |

The KDF values and timestamps do not reveal the vault contents. The master
password and raw encryption key are never stored.

Local edits update the affected encrypted records and bookkeeping atomically.
Unlock decrypts the header and all item records into memory. Changing the master
password re-encrypts all of them under the new key. This is the initial storage
layout; no migration from an earlier single-envelope layout is provided.

This local layout is separate from GitHub sync: sync still uploads one
master-key-encrypted payload containing the shareable items, templates, and
settings, without the local header markers or GitHub credentials.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed URL and create a master password.

```bash
npm run build       # typecheck + production bundle
npm run typecheck   # types only
npm run test        # unit tests
npm run lint        # oxlint
```

On Windows, use `npm.cmd` — PowerShell's execution policy blocks `npm.ps1`.

### Install as an app

After opening the production site over HTTPS, use the browser's install option
to add Sandiman to your device. The service worker caches the static app shell
for offline startup; vault data remains in IndexedDB and is never added to the
service-worker cache.

## Deploying to Azure Static Web Apps

Run `./scripts/deploy-swa.ps1` from PowerShell. The script builds the app,
prompts for the Static Web Apps deployment token without echoing it, and deploys
`dist` to the production environment using the SWA CLI. It uses an installed
`swa` command when available, otherwise it runs the CLI through `npx`. The token
is passed through a temporary process environment variable and is not saved.

## Project structure

Roughly 8,200 lines of application code, plus 1,200 lines of shadcn/ui
primitives and 1,300 lines of tests colocated next to the modules they cover.

```
src/
├── crypto/          Encryption primitives. Knows nothing about items.
│   ├── kdf.worker.ts      PBKDF2, off the main thread
│   ├── kdf.ts             Worker client + KDF descriptor creation
│   ├── aes.ts             AES-GCM-256 seal/open over an envelope
│   ├── envelope.ts        Envelope shape and version history
│   ├── secureRandom.ts    Unbiased random ints (rejection sampling)
│   └── base64.ts          Encoding helpers
│
├── storage/         The domain. Where the business rules live.
│   ├── types.ts           FieldDef, VaultTemplate, VaultItem, VaultPayload
│   ├── builtins.ts        Eight seeded templates
│   ├── templateEngine.ts  Field resolution + runtime zod schemas
│   ├── expiry.ts          Date parsing and urgency classification
│   ├── schema.ts          zod schemas for decrypted payloads
│   ├── db.ts              IndexedDB stores (via idb)
│   └── vaultService.ts    create / unlock / save / change password
│
├── generator/       Password generation and strength estimation
│   └── password.ts
│
├── sync/            GitHub API transport and merge semantics
│   ├── githubConfig.ts        Validate repository/token settings
│   ├── github.ts              Octokit transport for encrypted file
│   ├── merge.ts               Per-record conflict resolution
│   ├── syncEngine.ts          read/SHA-check → merge → conditional commit
│   └── types.ts               Sync config and outcome types
│
├── state/           Runtime session state
│   ├── vaultStore.ts    Zustand store; holds the master key
│   ├── autoLock.ts      Idle and blur timers
│   ├── autoSync.ts      Background sync interval
│   └── useTheme.ts      Light/dark/system
│
├── components/
│   ├── ui/                 21 shadcn/ui primitives (Radix-based)
│   ├── vault/              Sidebar, ItemList, ItemDetail, ItemForm, ExpiryDashboard
│   ├── templates/          TemplateManager — list and field builder
│   ├── sync/               SyncPanel
│   ├── settings/           SettingsPanel
│   └── FieldControl.tsx    One component per field type
│
├── screens/         Onboarding, Unlock, Vault
├── lib/             cn, clipboard, id helpers
└── App.tsx          Screen routing (there is no router)
```

**Layering.** Dependencies flow roughly `crypto` ← `storage` ← `sync`/`state` →
`components` → `screens`. Two exceptions are type-only and cost nothing at
runtime: `crypto/aes.ts` borrows the `VaultPayload` type from `storage/types`,
and `storage/types.ts` borrows `GitHubSyncConfig` from `sync/types`. Runtime
imports are acyclic.

**Why it is split this way.** `storage/` is where the rules are, and it is the
only layer that matters for correctness. UI code renders whatever those modules
return, so a change to merge semantics or expiry classification happens in one
place rather than in every view that displays the result.

## Business logic

### Vault lifecycle

The app has exactly four screens, and which one is shown depends only on
whether a vault exists and whether it is unlocked. `App.tsx` switches on a
single field rather than routing URLs.

| Screen | Condition |
| --- | --- |
| Onboarding | No vault has been created on this device |
| Unlock | A vault exists and is locked |
| Vault | Unlocked |

**Creating** (`Onboarding` → `createVault`) generates a 16-byte salt, derives a
key, seeds the built-in templates, and writes an encrypted header. The vault
starts with zero items.

**Unlocking** (`Unlock` → `unlock`) reads the encrypted header, derives a key
from the supplied password and stored salt, then decrypts and validates every
item record. A header authentication failure is reported as a *wrong password*;
a damaged or missing item record is reported as corruption.

**Locking** clears the key material from module scope and empties the decrypted
state. Not just hiding it: leaving items rendered after a lock would defeat the
purpose of having one.

**Changing the master password** re-encrypts the entire vault under a fresh
salt, then forces a re-lock so the new password is exercised immediately.

### Templates and fields

A template is a list of field definitions. Each field has an id, a label, a
type, and three flags — `required`, `copyable`, and `expiry`.

Eight templates are seeded: **Login, Credit Card, ID Card, Secure Note,
Wireless Key, API Key, Software License, Database.** The first four come from
the original spec; the rest exist because a password manager with only logins
and cards is not much use, and between them they exercise every field type.

Seven field types are supported — `text`, `masked`, `number`, `date`,
`boolean`, `url`, `note` — each rendering a different control.

Built-in templates cannot be deleted, only edited or duplicated. Duplicating
assigns **fresh field ids** so the copy and the original never share identity.

**Editing a template never destroys data.** Values are keyed by field id, never
by label. Removing a field orphans the values behind it rather than dropping
them; `resolveFields()` returns them flagged `orphaned`, and the item detail
view shows them under a "not in this template" marker. Reordering fields is safe
for the same reason. The template builder states this explicitly so it does not
look like an oversight.

**Items can carry ad-hoc custom fields** regardless of their template, for the
one-off case a template does not cover.

### Items

An item's values live in a flat `values` map keyed by field id, alongside its
custom fields, tags, and free-text notes.

**Blank is not the same as absent.** Empty strings are removed from the value
map rather than stored, so "the user cleared this field" stays distinguishable
from "this field was never set".

### Expiry tracking

Any `date` field can be flagged `expiry`, which pulls every item using that
field into the expiry dashboard.

Dates are stored as **free text**, because that is what documents actually show:
`04/2028`, `2028-04`, `28/04/2028`. Parsing accepts several formats and treats a
bare month/year as the *end* of that month — a card with expiry `04/2028` is
still usable through April. Impossible dates like `31 February` are rejected
rather than silently rolled forward, and anything unparseable is reported as
`unparseable` instead of being quietly treated as "not expiring".

Each entry is classified relative to a configurable warning window (default 30
days), with the tiers scaled to that window so the badges read the same
whatever the setting:

| Status | Meaning |
| --- | --- |
| `expired` | Past date |
| `critical` | Within a quarter of the warning window |
| `warning` | Within the warning window |
| `ok` | Beyond it |
| `unparseable` | The stored value is not a date this app recognises |

The sidebar shows a count of items needing attention; the dashboard offers
30/60/90-day filters.

### Copying secrets

`CopyButton` distinguishes two cases. **Masked fields are treated as secrets**:
they go through `copyWithAutoClear()`, which overwrites the clipboard after a
configurable delay (default 30s, settable to never). **Everything else —
usernames, cardholder names, hostnames — is copied plainly**, because wiping a
clipboard to clear `alice@example.com` is pure friction.

Copying a new secret cancels any pending clear first, so two secrets are never
queued to overwrite each other. Toasts confirm a copy but **never echo the
value**: notifications can be captured by screen recorders and notification
history.

In the detail view, masked fields stay masked until individually revealed, and
the reveal state resets when you switch items — so opening a second item cannot
leave the previous one's secrets exposed.

> **Known issue.** Locking the vault cancels any pending clipboard clear, which
> means a secret copied just before locking stays on the system clipboard with
> nothing left to remove it. Locking should clear the clipboard outright rather
> than disarm the timer.

### Password generation

Generation draws from `crypto.getRandomValues` through a helper that **rejects
rather than reduces**. Taking `value % poolLength` would quietly favour the
first `256 % length` characters of a set, which is a small but real bias in
exactly the code path that produces passwords.

Options: length (8–128), the four character classes, exclusion of visually
ambiguous characters (`Il1O0o` and friends), and whether every enabled class is
guaranteed at least one character. When it is, the result is **shuffled** —
leaving the guaranteed characters in the first positions would leak them to
anyone who could see which positions were constrained.

Strength is estimated from character-set entropy, penalising repetition,
common sequences, and digits-only strings. It is an estimate for onboarding
feedback, not a breach lookup.

### Locking

Two independent, configurable triggers:

- **Idle timeout** — a debounce, not a polling loop. Activity re-arms a single
  timer, so an idle tab does no work. Default 5 minutes; `0` disables it.
- **Window blur** — for shared machines. Off by default.

Locking clears key material and decrypted state from memory.

### Sync

Sync is optional and off by default. It stores one encrypted JSON file in a
GitHub repository; changed syncs create commits. A run skips if one is already
in flight.

A run reads the remote file and its Git blob SHA, decrypts it, merges records
per-item, and writes the encrypted merged payload back using that SHA. If another
device updates the file between the read and write, the stale SHA is rejected
and the sync reports a retryable conflict instead of silently overwriting it.
An unchanged vault does not create an empty commit.

**Merging is per record, not wholesale.** Each item and template resolves
independently by `updatedAt`, with two refinements:

- a delete beats an edit from the same instant (ties in milliseconds are real
  when two devices save together)
- a delete beats any *strictly older* version, so an edit made on a device that
  was offline before the delete cannot resurrect the item

A genuinely *newer* edit still wins, because that is a real user action rather
than a stale replica. Records both sides agree on are counted separately as
`unchanged`, so two identical vaults do not report a spurious merge every time.

**Settings are not merged per key.** The whole settings object comes from the
newer payload. Per-key merging would produce a combination of settings that
nobody ever chose.

**Remote encryption still uses the vault master password.** A KDF descriptor is
included in the remote envelope, and the derived sync key is held in memory only
for the unlocked session. The GitHub PAT is a separate repository credential;
it authorizes file access but cannot decrypt the vault.

### GitHub credentials

Use a **private repository** and a fine-grained personal access token scoped to
that repository with **Contents: read and write** permission. Configure the
owner, repository, optional branch, encrypted-file path, and PAT in Sync
settings. The PAT is stored only inside the locally encrypted vault and is
removed by `toSyncPayload()` before upload. The local last-sync timestamp is
also excluded, so a routine sync does not create a commit just to record that
it ran. The PAT is never logged or placed in the remote file.

GitHub commit history retains older encrypted copies even after a new version
is committed or the current file is deleted. The Contents API has file-size
limits; Sandiman rejects encrypted files over 70 MiB rather than attempting an
unsupported upload. Repository and branch must already exist.

## Design decisions

**Key derivation runs in a Web Worker.** 600,000 PBKDF2 iterations take on the
order of a second; inline on the main thread that freezes the tab and makes the
unlock button look broken. The derived key is transferred back as a
non-extractable `CryptoKey`, which structured clone carries by reference — raw
key material never crosses the boundary and cannot be read back even from the
returned handle.

**Local item records are encrypted independently.** This keeps ordinary saves
proportional to the changed item rather than the full vault. The tradeoff is
that someone inspecting IndexedDB can observe the number and approximate sizes
of encrypted records, and notice which record changes. Random item IDs are the
only item fields used as storage keys; content and labels stay encrypted.
GitHub sync remains a single encrypted payload and does not use this local
record layout.

**Tombstones are retained across saves.** This one is subtle and was a real bug.
The store keeps deleted items in `deletedItems` separately from the visible
`items`, and `toPayload()` re-includes them. Had it been written to filter
deleted items out of the payload, the next save would rewrite the vault without
them and sync would read the absent record as "never deleted" — silently
undoing every delete on every other device.

**A fresh IV per encryption.** Reusing an IV under the same key would be
catastrophic for GCM. Both `encryptVault` and `encryptRecord` draw a fresh
random 96-bit IV per call.

**Dates are free text, not `type="date"`.** Stored dates are frequently partial
or non-ISO, and a native date input cannot represent that without silently
discarding what the user typed.

## Threat model

What this defends against:

- someone reading your IndexedDB
- a leaked backup or disk image
- the GitHub repository, or anyone with access to it, seeing your data

All three get ciphertext.

What it does **not** defend against:

- script execution in the page
- a malicious browser extension
- a compromised browser profile

Anything that can run JavaScript while the vault is unlocked can read the
decrypted state. This is inherent to a client-only design; a browser extension
is the practical weak point. There is no server to put between you and the
attacker, which is also why the app can promise zero knowledge and cannot
promise safety from the device itself.

## Development status

The build, the dev server, and the domain logic are verified — unit tests cover
crypto round-trips, merge semantics, expiry parsing, GitHub configuration and
transport, generation, and the storage lifecycle.

**The UI has not yet been exercised in a browser.** The rendered screens are
unverified; treat them as untested. See `AGENTS.md` for the invariants a change
must not break, and for the known gaps.
