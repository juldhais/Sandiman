# AGENTS.md

Guidance for agents working in this repository.

## What Sandiman is

A zero-knowledge password manager that runs entirely in the browser. No backend,
no account. The vault is encrypted on-device with AES-GCM-256 under a key
derived from the user's master password via PBKDF2-HMAC-SHA256, stored in
IndexedDB, and optionally synced as ciphertext to a GitHub repository the user
controls.

The zero-knowledge property is the product. Changes that weaken it are not
acceptable regardless of what they make easier.

## Commands

```bash
npm run dev         # dev server on :5173
npm run build       # tsc -b && vite build
npm run typecheck   # tsc -b
npm test            # vitest run
npm run lint        # oxlint
```

Run `typecheck`, `test`, and `build` before declaring work done. `build` already
runs `tsc -b`, so it catches type errors on its own.


## Layout

```
src/
  App.tsx                 Screen selection; no URL router
  crypto/                 PBKDF2 Web Worker, AES-GCM, envelope, secure randomness
  storage/                Vault/domain types, templates, expiry, schemas, IndexedDB
  generator/              Password generation and strength estimation
  sync/                   GitHub Octokit transport, config validation, merge, sync
  state/                  Zustand vault state, auto-lock, auto-sync, theme
  components/
    ui/                   Shared Radix/shadcn-style primitives
    vault/                Item list/detail/form, sidebar, expiry dashboard
    templates/            Template management and field builder
    sync/                 GitHub sync settings and controls
    settings/             Vault and application preferences
  screens/                Onboarding, Unlock, Vault
  lib/                    Class names, clipboard, ids
```

Tests are colocated with their modules as `*.test.ts`. App entry points are
`src/main.tsx` and `src/App.tsx`; Vite and TypeScript configuration live at the
repository root.

Roughly: `crypto` ← `storage` ← `sync`/`state` → `components` → `screens`. A
lower layer should not import from a higher one.

Two deliberate exceptions, both type-only so they cost nothing at runtime:
`crypto/aes.ts` imports the `VaultPayload` type from `storage/types`, and
`storage/types.ts` + `storage/schema.ts` import `GitHubSyncConfig` from
`sync/types` (a leaf module with no imports of its own). Runtime imports are
acyclic — `storage` uses `crypto`, `sync` uses `storage`, and nothing in
`crypto/` imports from `storage/` at runtime. Do not deepen these edges; if a
layer needs a shared type, move it down to the layer that already owns it.

The `@/*` alias maps to `src/*` and is configured in both `vite.config.ts` and
`tsconfig.app.json`. Use it; do not write long relative import chains.

## Conventions

- `verbatimModuleSyntax` is on: type-only imports must use `import type`.
- `erasableSyntaxOnly` is on: no parameter properties, no enums. Use plain types
  or `as const` objects.
- `strict`, `noUnusedLocals`, and `noUnusedParameters` are on.
- Use the `@/*` alias for imports from `src/`; keep relative imports within a
  feature/module rather than writing long paths across layers.
- Keep domain rules in pure modules under `storage/`, `crypto/`, `generator/`,
  or `sync/`; components should render and orchestrate those rules, not duplicate
  them.
- Keep runtime dependency flow acyclic and follow the layer boundaries above.
  Cross-layer shared types should be type-only imports; do not add runtime edges
  from a lower layer to a higher one.
- Follow existing React, Tailwind, and shared UI primitive patterns. Avoid adding
  dependencies or server-only APIs to this browser-only application without a
  clear need.
- Validate decrypted or external data at module boundaries with the existing
  Zod schemas. Do not treat TypeScript types alone as runtime validation.
- Never log secrets or put the master key, sync password, or storage account key
  in plaintext persistence. Keep user-facing warnings clear about access and
  consequences, especially for destructive actions.
- Comments explain *why*, especially where a choice looks wrong. Several
  non-obvious decisions in this repo are load-bearing; the comment is the only
  thing stopping someone from "fixing" them.
- UI text is written for the user and explains consequences — especially
  destructive and irreversible actions.

## IndexedDB schema

The fresh local database is `sandiman`, IndexedDB version 1, with four object
stores. Do not add backward-compatibility payload migrations or a local-format
discriminator unless the product explicitly starts supporting an earlier
released format. IndexedDB versions cannot be downgraded, so changing the open
version requires a fresh database or a deliberate upgrade path.

- **`vault`** uses `key` as its key path and contains one record:
  `{ key: 'primary', envelope: { v, kdf, iv, data }, updatedAt }`. The envelope
  encrypts the local header with AES-GCM under the master key. The header holds
  templates, settings (including the local GitHub PAT configuration), the
  encrypted note-folder tree, payload version/timestamp, and `localItemCount` /
  `localNoteCount`; its `items` and `notes` arrays are empty. Counts are encrypted
  so unlock can detect missing item/note rows. Envelope version, KDF descriptor,
  and IV are visible metadata, not secrets.
- **`items`** uses `id` as its key path and stores one record per item:
  `{ id, ciphertext: { v, iv, data } }`. The ciphertext contains the complete
  item, including its ID and tombstone state. Bind AES-GCM additional data to
  the item ID so a ciphertext cannot be moved to another record. IDs and
  ciphertext sizes are visible; item contents and other item metadata remain
  encrypted.
  Edits rewrite only that item. Add/remove-record operations update item rows
  and the encrypted header count in one IndexedDB transaction. A user delete is
  a soft-delete tombstone, so it remains stored until sync merge removes it.
- **`notes`** uses `id` as its key path and stores one authenticated ciphertext
  per standalone Markdown note. The complete note—including title, body, folder
  ID, and tombstone state—is encrypted with AES-GCM under the master key and
  bound to its ID. Folder names and hierarchy live in the encrypted `vault`
  header; note folder IDs are never used as storage keys.
- **`meta`** is a key/value store for bookkeeping only: `initialized`,
  `master-kdf` (non-secret KDF descriptor), `created-at`, and
  `last-local-write`. Never put passwords, keys, PATs, or item data here.

Prepare ciphertext before opening a transaction, then atomically commit related
header/item/note/meta writes. Unlock decrypts and validates the header and every
item and note before exposing them to the UI. Changing the master password
re-encrypts the header and all item/note records. This local layout is distinct
from GitHub sync, which stores the main encrypted payload at `vault.json`, one
encrypted file per note under `notes/`, and a separate encrypted folder manifest
at `notes/folders.json`; all GitHub files exclude the local PAT configuration.
The local last-sync timestamp is not part of that payload, so periodic sync does
not create commits solely for bookkeeping. The IndexedDB version number, AES
envelope version, and payload version are separate concepts; keep the initial
IndexedDB version at 1 for this schema.

## Features

- **Local encrypted vault:** Create/unlock a vault with a master password.
  PBKDF2-HMAC-SHA256 runs in a Web Worker and derives a non-extractable key;
  AES-GCM encrypts a local header and each item separately before IndexedDB
  writes. There is no backend, account, or password recovery service.
- **Items and templates:** Built-in and user-managed templates support typed
  fields, custom fields, tags, notes, and soft deletion/restoration. Items can be
  searched locally and have their fields reordered. Template edits preserve
  values for removed fields as orphans rather than discarding them.
- **Standalone Markdown notes:** Notes have nested folders, are stored as
  individually encrypted local records, use a Milkdown Markdown editor with
  autosave, and sync one encrypted file per note.
  Folder names/hierarchy are encrypted in the local header and a separate GitHub
  manifest; GitHub paths contain only random IDs, never folder names.
- **Secret utilities:** Generate passwords with configurable character sets and
  estimate strength. Masked values can be revealed per field and copied with a
  configurable clipboard-clear delay.
- **Expiry tracking:** `Card Expiry (MM/YY)` and `Expiry Date (DD/MM/YYYY)` field
  types are tracked automatically. Ordinary date fields are not expiries; old
  saved templates with the retired expiry marker remain supported.
- **Locking and preferences:** Configure idle auto-lock, lock-on-blur, theme,
  clipboard clearing, and expiry warnings.
- **GitHub sync:** Optional manual or interval sync stores the encrypted main
  payload, per-note files, and an encrypted note-folder manifest in a
  user-controlled repository. Octokit authenticates with a fine-grained PAT,
  stored only inside the locally encrypted vault and excluded from uploads.
  Updates use GitHub SHAs for optimistic concurrency and per-record merge
  semantics. Recommend private repositories; commit history retains older
  encrypted copies.

## Testing

Vitest, tests colocated as `*.test.ts` next to the module. The suite covers
crypto round-trips, item/note/folder merge semantics, expiry parsing, GitHub
config and transport, generation, schema validation, and storage lifecycle.

Two constraints when writing tests:

- The KDF dispatches to a Web Worker, which does not exist in Node. Derive keys
  inline via `crypto.subtle` with the *same* parameters as `kdf.worker.ts`, or
  the test does not exercise the real derivation. `aes.test.ts` shows the
  pattern.
- `fake-indexeddb/auto` must be imported to test anything touching `storage/db`.
