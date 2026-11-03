# Features

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
  autosave, and sync one encrypted file per note. Folder names and hierarchy are
  encrypted in the local header and a separate GitHub manifest; GitHub paths
  contain only random IDs, never folder names.
- **Secret utilities:** Generate passwords with configurable character sets and
  estimate strength. Masked values can be revealed per field and copied with a
  configurable clipboard-clear delay.
- **Expiry tracking:** `Card Expiry (MM/YY)` and `Expiry Date (DD/MM/YYYY)` field
  types are tracked automatically. Ordinary date fields are not expiries; old
  saved templates with the retired expiry marker remain supported.
- **Locking and preferences:** Configure idle auto-lock, lock-on-blur, theme,
  clipboard clearing, and expiry warnings.
- **GitHub sync:** Optional manual or interval sync. See [sync.md](sync.md).
