# AGENTS.md

Guidance for agents working in this repository.

## What Sandiman is

A zero-knowledge password manager that runs entirely in the browser. No backend,
no account. The vault is encrypted on-device with AES-GCM-256 under a key
derived from the user's master password via PBKDF2-HMAC-SHA256, stored in
IndexedDB, and optionally synced as ciphertext to an Azure Blob Storage
container the user controls.

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
  sync/                   SAS URL parsing, Azure Blob SDK transport, merge, sync
  state/                  Zustand vault state, auto-lock, auto-sync, theme
  components/
    ui/                   Shared Radix/shadcn-style primitives
    vault/                Item list/detail/form, sidebar, expiry dashboard
    templates/            Template management and field builder
    sync/                 Azure sync settings and controls
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
`storage/types.ts` + `storage/schema.ts` import `AzureSyncConfig` from
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

## Features

- **Local encrypted vault:** Create/unlock a vault with a master password.
  PBKDF2-HMAC-SHA256 runs in a Web Worker and derives a non-extractable key;
  AES-GCM encrypts the vault before it is written to IndexedDB. There is no
  backend, account, or password recovery service.
- **Items and templates:** Built-in and user-managed templates support typed
  fields, custom fields, tags, notes, and soft deletion/restoration. Items can be
  searched locally and have their fields reordered. Template edits preserve
  values for removed fields as orphans rather than discarding them.
- **Secret utilities:** Generate passwords with configurable character sets and
  estimate strength. Masked values can be revealed per field and copied with a
  configurable clipboard-clear delay.
- **Expiry tracking:** Date fields can be marked as expirations; the dashboard
  parses common date formats, classifies urgency, and supports warning-window
  filters.
- **Locking and preferences:** Configure idle auto-lock, lock-on-blur, theme,
  clipboard clearing, and expiry warnings.
- **Azure Blob sync:** Optional manual or interval sync stores only encrypted
  vault data remotely. The browser authenticates with a Blob SAS URL; sync uses
  a master-password-derived key, a blob lease for concurrency, and per-record
  merge semantics. The SAS URL is stored inside the encrypted local vault and
  excluded from the uploaded payload. Users should scope SAS permissions and
  expiry as narrowly as practical.

## Testing

Vitest, tests colocated as `*.test.ts` next to the module. The suite covers
crypto round-trips, merge semantics, expiry parsing, credential parsing and
signing, generation, schema validation, and storage lifecycle.

Two constraints when writing tests:

- The KDF dispatches to a Web Worker, which does not exist in Node. Derive keys
  inline via `crypto.subtle` with the *same* parameters as `kdf.worker.ts`, or
  the test does not exercise the real derivation. `aes.test.ts` shows the
  pattern.
- `fake-indexeddb/auto` must be imported to test anything touching `storage/db`.

When changing security-relevant logic, write the test first and confirm it fails
before the fix. Three real bugs were caught this way: identical vaults reporting
as "diverged" on every sync, `MM/YYYY` (the most common card-expiry format)
failing to parse, and tombstoned items being dropped from the payload.
