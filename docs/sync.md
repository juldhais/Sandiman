# GitHub sync

Optional manual or interval sync stores the encrypted main payload, per-note
files, and an encrypted note-folder manifest in a user-controlled repository.

- **Storage layout:** `vault.json` (main payload), `notes/<id>.*` (one encrypted
  file per note), and `notes/folders.json` (encrypted folder manifest). GitHub
  paths contain only random IDs, never folder names. All files exclude the local
  PAT configuration.
- **Auth:** Octokit authenticates with a fine-grained PAT. The PAT is stored only
  inside the locally encrypted vault and is never uploaded.
- **Concurrency:** Updates use GitHub SHAs for optimistic concurrency and
  per-record merge semantics (items, notes, folders). See
  [storage.md](storage.md) for the local side.
- **Privacy guidance:** Recommend private repositories. Commit history retains
  older encrypted copies.
- **Bookkeeping:** The local last-sync timestamp is not part of the payload, so
  periodic sync does not create commits solely for bookkeeping.

Code lives in `src/sync/` (transport, config validation, merge, sync) with
settings UI in `src/components/sync/`.
