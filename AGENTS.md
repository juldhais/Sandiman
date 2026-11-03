# AGENTS.md

Guidance for agents working in this repository.

## What Sandiman is

A zero-knowledge password manager that runs entirely in the browser. No backend,
no account. The zero-knowledge property is the product: changes that weaken it
are not acceptable, whatever they make easier.

## Commands

```bash
npm run dev         # dev server on :5173
npm run build       # tsc -b && vite build
npm run typecheck   # tsc -b
npm test            # vitest run
npm run lint        # oxlint
```

Run `typecheck`, `test`, and `build` before declaring work done.

## Rules of thumb

- Never log secrets or persist the master key, sync password, or storage account
  key in plaintext.
- Keep domain rules in pure modules; components render and orchestrate them.
- Validate decrypted or external data with the Zod schemas.
- Comments explain *why*. Several decisions here are load-bearing.

## Reference docs

Read the relevant doc before changing that area:

- [docs/architecture.md](docs/architecture.md): source layout, layer rules, `@/*` alias
- [docs/conventions.md](docs/conventions.md): TypeScript settings, imports, code style
- [docs/storage.md](docs/storage.md): IndexedDB schema, encryption layout, write rules
- [docs/features.md](docs/features.md): product features and behavior
- [docs/sync.md](docs/sync.md): GitHub sync layout, auth, and concurrency
- [docs/testing.md](docs/testing.md): test suite, required test setup
