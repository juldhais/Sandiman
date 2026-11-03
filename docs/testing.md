# Testing

Vitest, with tests colocated as `*.test.ts` next to the module. The suite covers
crypto round-trips, item/note/folder merge semantics, expiry parsing, GitHub
config and transport, generation, schema validation, and storage lifecycle.

Before declaring work done, run `npm run typecheck`, `npm test`, and
`npm run build`. `build` already runs `tsc -b`, so it catches type errors on its
own.

## Constraints when writing tests

- The KDF dispatches to a Web Worker, which does not exist in Node. Derive keys
  inline via `crypto.subtle` with the *same* parameters as `kdf.worker.ts`, or
  the test does not exercise the real derivation. `aes.test.ts` shows the
  pattern.
- `fake-indexeddb/auto` must be imported to test anything touching `storage/db`.
