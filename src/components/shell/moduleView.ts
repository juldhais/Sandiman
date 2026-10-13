export type VaultView =
  | { kind: 'all' }
  | { kind: 'expiring' }
  | { kind: 'tags' }
  | { kind: 'template'; id: string }

export type ModuleView =
  | { module: 'vault'; view: VaultView }
  | { module: 'notes'; folderId: string | null }
