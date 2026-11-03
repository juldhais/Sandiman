# Architecture

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
    shell/                Workspace sidebar and module navigation
    vault/                VaultModule, item list/detail/form, expiry dashboard
    notes/                NotesModule, folder tree/dialog, Markdown editor
    templates/            Template management and field builder
    sync/                 GitHub sync settings and controls
    settings/             Vault and application preferences
  screens/                Onboarding, Unlock, Workspace
  lib/                    Class names, clipboard, ids
```

Tests are colocated with their modules as `*.test.ts`. App entry points are
`src/main.tsx` and `src/App.tsx`; Vite and TypeScript configuration live at the
repository root.

## Layer rules

Roughly: `crypto` ← `storage` ← `sync`/`state` → `components` → `screens`. A
lower layer should not import from a higher one.

Two deliberate exceptions, both type-only so they cost nothing at runtime:

- `crypto/aes.ts` imports the `VaultPayload` type from `storage/types`.
- `storage/types.ts` and `storage/schema.ts` import `GitHubSyncConfig` from
  `sync/types` (a leaf module with no imports of its own).

Runtime imports are acyclic: `storage` uses `crypto`, `sync` uses `storage`, and
nothing in `crypto/` imports from `storage/` at runtime. Do not deepen these
edges. If a layer needs a shared type, move it down to the layer that already
owns it.

## Path alias

The `@/*` alias maps to `src/*` and is configured in both `vite.config.ts` and
`tsconfig.app.json`. Use it; do not write long relative import chains.
