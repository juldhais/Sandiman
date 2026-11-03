# Code conventions

## TypeScript

- `verbatimModuleSyntax` is on: type-only imports must use `import type`.
- `erasableSyntaxOnly` is on: no parameter properties, no enums. Use plain types
  or `as const` objects.
- `strict`, `noUnusedLocals`, and `noUnusedParameters` are on.

## Imports and layers

- Use the `@/*` alias for imports from `src/`. Keep relative imports within a
  feature/module rather than writing long paths across layers.
- Keep runtime dependency flow acyclic and follow the layer boundaries in
  [architecture.md](architecture.md). Cross-layer shared types should be
  type-only imports.

## Where logic lives

- Keep domain rules in pure modules under `storage/`, `crypto/`, `generator/`,
  or `sync/`. Components should render and orchestrate those rules, not
  duplicate them.
- Follow existing React, Tailwind, and shared UI primitive patterns.
- Avoid adding dependencies or server-only APIs to this browser-only application
  without a clear need.
- Validate decrypted or external data at module boundaries with the existing Zod
  schemas. Do not treat TypeScript types alone as runtime validation.

## Security and secrets

- Never log secrets, and never persist the master key, sync password, or storage
  account key in plaintext.
- Keep user-facing warnings clear about access and consequences, especially for
  destructive actions.
- UI text is written for the user and explains consequences, especially for
  destructive and irreversible actions.

## Comments

Comments explain *why*, especially where a choice looks wrong. Several
non-obvious decisions in this repo are load-bearing; the comment is the only
thing stopping someone from "fixing" them.
