# Local storage (IndexedDB)

The fresh local database is `sandiman`, IndexedDB version 1, with four object
stores. Do not add backward-compatibility payload migrations or a local-format
discriminator unless the product explicitly starts supporting an earlier
released format. IndexedDB versions cannot be downgraded, so changing the open
version requires a fresh database or a deliberate upgrade path.

## Object stores

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
  per standalone Markdown note. The complete note, including title, body, folder
  ID, and tombstone state, is encrypted with AES-GCM under the master key and
  bound to its ID. Folder names and hierarchy live in the encrypted `vault`
  header; note folder IDs are never used as storage keys.
- **`meta`** is a key/value store for bookkeeping only: `initialized`,
  `master-kdf` (non-secret KDF descriptor), `created-at`, and
  `last-local-write`. Never put passwords, keys, PATs, or item data here.

## Write and unlock rules

- Prepare ciphertext before opening a transaction, then atomically commit related
  header/item/note/meta writes.
- Unlock decrypts and validates the header and every item and note before
  exposing them to the UI.
- Changing the master password re-encrypts the header and all item/note records.

## Relation to GitHub sync

This local layout is distinct from GitHub sync, which stores the main encrypted
payload at `vault.json`, one encrypted file per note under `notes/`, and a
separate encrypted folder manifest at `notes/folders.json`. All GitHub files
exclude the local PAT configuration. See [sync.md](sync.md).

The local last-sync timestamp is not part of that payload, so periodic sync does
not create commits solely for bookkeeping.

## Version numbers

The IndexedDB version number, AES envelope version, and payload version are
separate concepts. Keep the initial IndexedDB version at 1 for this schema.
