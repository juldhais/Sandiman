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

## Environment

Windows, PowerShell. **`npm` is blocked by the execution policy** — always use
`npm.cmd` (e.g. `npm.cmd run dev`). `npx` likewise needs `npx.cmd`.

Git is initialised on `main`. `.gitattributes` normalises line endings to LF,
so do not add `core.autocrlf` overrides on top of it — that combination is what
produces whole-file diffs.

## Commands

```bash
npm.cmd run dev         # dev server on :5173
npm.cmd run build       # tsc -b && vite build
npm.cmd run typecheck   # tsc -b
npm.cmd test            # vitest run
npm.cmd run lint        # oxlint
```

Run `typecheck`, `test`, and `build` before declaring work done. `build` already
runs `tsc -b`, so it catches type errors on its own.

Note: `npm.cmd run build` can exit non-zero on PowerShell because Vite writes
warnings to stderr. Check for `✓ built in` rather than trusting the exit code.

## Layout

```
src/
  crypto/       PBKDF2 (Web Worker), AES-GCM, CSPRNG, envelope format
  storage/      Domain model, templates, expiry, zod schemas, IndexedDB, lifecycle
  generator/    Password generation and strength estimation
  sync/         Azure credential parsing, merge engine, sync runs
  state/        Zustand store, auto-lock, auto-sync, theme
  components/   ui/ primitives plus vault, templates, sync, settings
  screens/      Onboarding, Unlock, Vault
  lib/          cn, clipboard, id helpers
  assets/       unused Vite boilerplate, safe to delete
```

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

## Invariants

These are load-bearing. Breaking one silently corrupts user data or weakens the
security model.

**The master key lives in memory only.** It is held in module scope in
`state/vaultStore.ts`, never in the store itself (so it cannot land in a
devtools snapshot or a persisted store), and never in storage. `lock()` must
clear it and wipe decrypted items from the tree.

**Derivation stays in the worker.** 600,000 PBKDF2 iterations take about a
second. Never call `crypto.subtle.deriveKey` on the main thread for user-facing
key material. The derived key crosses the worker boundary as a non-extractable
`CryptoKey`; do not set `extractable: true`.

**The vault is one ciphertext.** Encrypt per item and you leak structure through
index and timing side channels. Every mutation re-encrypts the whole payload.

**Tombstones must survive saves.** Deleted items live in `deletedItems` on the
store, separate from the visible `items`. `toPayload()` re-includes them. If you
filter them out, the next save writes a vault without them and deletes silently
un-happen on every other device. Templates are tombstoned the same way
(`deleted: true`) rather than removed.

**Template edits are non-destructive.** Item values are keyed by field id, never
by label. Removing a field from a template orphans its data; `resolveFields()`
surfaces orphans explicitly and the item views show them. Never write a code path
that drops values for fields the template no longer declares.

**Merge is per-record, not wholesale.** `sync/merge.ts` resolves conflicts by
`updatedAt` with two refinements: a delete beats an edit from the same instant,
and a delete beats any strictly older version. A genuinely newer edit still
wins. Settings are taken wholesale from the newer payload, never merged per key.
Do not "simplify" this into a timestamp comparison.

**Sync takes a lease.** Without optimistic concurrency two devices syncing
simultaneously each merge their own edits and the second upload discards the
first's work. Keep the `409` path as a user-visible retryable conflict.

**Sync credentials never reach the blob.** `toSyncPayload()` strips the `sync`
key. The sync password lives inside the master-key-encrypted payload. Verify
this stays true before adding anything to the payload — it is covered by a test.

**Fresh IV per encryption.** Non-negotiable for GCM. `encryptVault` draws one
per call; do not reuse.

## Conventions

- `verbatimModuleSyntax` is on: type-only imports must use `import type`.
- `erasableSyntaxOnly` is on: no parameter properties, no enums. Use plain types
  or `as const` objects.
- `strict`, `noUnusedLocals`, and `noUnusedParameters` are on.
- Comments explain *why*, especially where a choice looks wrong. Several
  non-obvious decisions in this repo are load-bearing; the comment is the only
  thing stopping someone from "fixing" them.
- UI text is written for the user and explains consequences — especially
  destructive and irreversible actions.

## Testing

Vitest, tests colocated as `*.test.ts` next to the module. The current suite
covers crypto round-trips, merge semantics, expiry parsing, credential parsing,
generation, and storage lifecycle.

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

## Azure specifics

Azure's `@azure/storage-blob` **browser** bundle deliberately omits
`StorageSharedKeyCredential` — their docs list Shared Key authorization as
Node-only. So the credential kinds take different paths:

- **SAS tokens** → the Azure SDK (`sync/azure.ts`, `wrapSdkClients`).
- **Connection strings** → `sync/sharedKeyTransport.ts`, a hand-written Blob
  REST client with WebCrypto HMAC signing.

The shared-key signing is unit-tested but has never been exercised against a
live storage account. The `StringToSign` construction in that file is the part
to check first if connection-string sync misbehaves.

The SDK is imported dynamically by `sync/syncEngine.ts` (`loadBlobHandle`) so it
stays out of the main bundle. Credential parsing lives in
`sync/credentialParsing.ts`, deliberately SDK-free, so the settings panel can
validate a credential without pulling the ~450 kB Azure chunk into the initial
load. Keep it that way — do not import `sync/azure.ts` from a component.

## Known gaps

- **The UI has not been exercised in a browser.** The build, the dev server, and
  the pure logic are all verified; the rendered screens are not. Check them
  before claiming a feature works.
- Leftover Vite template boilerplate, unused: `src/assets/` (`hero.png`,
  `react.svg`, `vite.svg`), `components/ui/card.tsx`, `components/ui/tabs.tsx`,
  and the `@radix-ui/react-popover` / `@radix-ui/react-scroll-area` packages.
  Remove them or use them; do not accumulate more.
- `oxlint` reports 8 warnings, 0 errors. Mostly `only-export-components`
  (inherent to the shadcn pattern) and `set-state-in-effect`. Fix them if you
  are already touching the file; do not contort code to silence one.
- The main bundle is ~659 kB (207 kB gzipped). Mostly React, Radix, zod, and
  lucide. Not urgent, but if it grows, look at lucide imports before anything
  else.
