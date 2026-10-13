import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileText, Folder, Trash2 } from 'lucide-react'
import type { VaultNote, VaultNoteFolder } from '@/storage/types'
import { useVaultStore } from '@/state/vaultStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NoteFolderTree, ALL_NOTES_FOLDER_ID } from '@/components/vault/NoteFolderTree'
import { NoteFolderDialog } from '@/components/vault/NoteFolderDialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const MilkdownMarkdownEditor = lazy(() =>
  import('@/components/vault/MilkdownMarkdownEditor').then((module) => ({
    default: module.MilkdownMarkdownEditor,
  })),
)

function folderPath(folder: VaultNoteFolder, folders: readonly VaultNoteFolder[]): string {
  const byId = new Map(folders.map((candidate) => [candidate.id, candidate]))
  const parts = [folder.name]
  let parentId = folder.parentId
  const seen = new Set([folder.id])
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    parts.push(parent.name)
    parentId = parent.parentId
  }
  return parts.reverse().join(' / ')
}

export function NoteWorkspace({
  selectedId,
  onSelect,
  createRequested,
  onCreateHandled,
}: {
  selectedId: string | null
  onSelect: (id: string | null) => void
  createRequested: boolean
  onCreateHandled: () => void
}) {
  const notes = useVaultStore((state) => state.notes)
  const folders = useVaultStore((state) => state.noteFolders)
  const addNote = useVaultStore((state) => state.addNote)
  const updateNote = useVaultStore((state) => state.updateNote)
  const deleteNote = useVaultStore((state) => state.deleteNote)
  const addNoteFolder = useVaultStore((state) => state.addNoteFolder)
  const updateNoteFolder = useVaultStore((state) => state.updateNoteFolder)
  const deleteNoteFolder = useVaultStore((state) => state.deleteNoteFolder)
  const [query, setQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(ALL_NOTES_FOLDER_ID)
  const [folderEditor, setFolderEditor] = useState<
    { kind: 'create'; parentId: string | null } | { kind: 'edit'; folder: VaultNoteFolder } | null
  >(null)
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<VaultNoteFolder | null>(null)
  const [pendingDelete, setPendingDelete] = useState<VaultNote | null>(null)
  const handledCreateRequest = useRef(false)
  const effectiveFolderId = selectedFolderId === null && !notes.some((note) => !note.folderId)
    ? ALL_NOTES_FOLDER_ID
    : selectedFolderId !== null && selectedFolderId !== ALL_NOTES_FOLDER_ID &&
        !folders.some((folder) => folder.id === selectedFolderId)
      ? ALL_NOTES_FOLDER_ID
      : selectedFolderId

  const createNote = useCallback(async (): Promise<void> => {
    const folderId = effectiveFolderId === ALL_NOTES_FOLDER_ID ? null : effectiveFolderId
    const note = await addNote('Untitled', '', folderId)
    setQuery('')
    onSelect(note.id)
  }, [addNote, effectiveFolderId, onSelect])

  useEffect(() => {
    if (!createRequested) {
      handledCreateRequest.current = false
      return
    }
    if (handledCreateRequest.current) return
    handledCreateRequest.current = true
    void createNote()
    onCreateHandled()
  }, [createNote, createRequested, onCreateHandled])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return notes
      .filter((note) => effectiveFolderId === ALL_NOTES_FOLDER_ID || (note.folderId ?? null) === effectiveFolderId)
      .filter((note) => !needle || note.title.toLocaleLowerCase().includes(needle) || note.markdown.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }, [notes, query, effectiveFolderId])
  const candidate = notes.find((note) => note.id === selectedId) ?? null
  const selected = candidate && (
    effectiveFolderId === ALL_NOTES_FOLDER_ID || (candidate.folderId ?? null) === effectiveFolderId
  ) ? candidate : null

  async function saveFolder(name: string, parentId: string | null): Promise<void> {
    if (folderEditor?.kind === 'edit') {
      await updateNoteFolder(folderEditor.folder.id, { name, parentId })
    } else {
      const folder = await addNoteFolder(name, parentId)
      setSelectedFolderId(folder.id)
    }
    setFolderEditor(null)
  }

  async function confirmDeleteFolder(): Promise<void> {
    if (!pendingDeleteFolder) return
    const parentId = await deleteNoteFolder(pendingDeleteFolder.id)
    setSelectedFolderId(parentId)
    setPendingDeleteFolder(null)
  }

  async function moveNoteToFolder(
    id: string,
    changes: Pick<VaultNote, 'title' | 'markdown' | 'folderId'>,
  ): Promise<void> {
    setSelectedFolderId(ALL_NOTES_FOLDER_ID)
    await updateNote(id, changes)
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[22rem_minmax(0,1fr)]">
      <section className={`min-h-0 flex-col border-r ${selected ? 'hidden md:flex' : 'flex'}`}>
        <NoteFolderTree
          folders={folders}
          notes={notes}
          selectedFolderId={effectiveFolderId}
          onSelect={setSelectedFolderId}
          onCreate={(parentId) => setFolderEditor({ kind: 'create', parentId })}
          onEdit={(folder) => setFolderEditor({ kind: 'edit', folder })}
          onDelete={setPendingDeleteFolder}
        />
        <div className="flex items-center gap-2 border-b p-3">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" type="search" />
        </div>
        {visible.length === 0 ? (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
            <FileText className="size-6" />
            <p>{query ? 'No notes match your search.' : notes.length === 0 ? 'No notes yet. Create a note to get started.' : 'No notes in this folder.'}</p>
          </div>
        ) : (
          <ul className="scrollbar-slim min-h-0 flex-1 divide-y overflow-y-auto">
            {visible.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onSelect(note.id)}
                  aria-current={selectedId === note.id ? 'true' : undefined}
                  className={`hover:bg-accent/50 w-full px-4 py-3 text-left ${selectedId === note.id ? 'bg-accent' : ''}`}
                >
                  <span className="block truncate text-sm font-medium">{note.title}</span>
                  <span className="text-muted-foreground mt-1 block truncate text-xs">{note.markdown.replace(/[#*`>()]/g, '').replaceAll('[', '').replaceAll(']', '').trim() || 'Empty note'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <footer className="text-muted-foreground border-t px-3 py-2 text-xs">
          {visible.length} note{visible.length === 1 ? '' : 's'}
        </footer>
      </section>

      <section className={`scrollbar-slim min-h-0 overflow-y-auto ${selected ? 'block' : 'hidden md:block'}`}>
        {selected ? (
          <NoteEditor
            key={selected.id}
            note={selected}
            folders={folders}
            onUpdate={updateNote}
            onMove={moveNoteToFolder}
            onBack={() => onSelect(null)}
            onDelete={() => setPendingDelete(selected)}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
            Select a note to read it, or create a new one.
          </div>
        )}
      </section>

      <NoteFolderDialog
        key={folderEditor?.kind === 'edit' ? `folder-${folderEditor.folder.id}` : folderEditor ? 'new-folder' : 'closed-folder'}
        folders={folders}
        folder={folderEditor?.kind === 'edit' ? folderEditor.folder : null}
        defaultParentId={folderEditor?.kind === 'create' ? folderEditor.parentId : null}
        open={folderEditor !== null}
        onOpenChange={(open) => { if (!open) setFolderEditor(null) }}
        onSave={saveFolder}
      />

      <Dialog open={pendingDeleteFolder !== null} onOpenChange={(open) => { if (!open) setPendingDeleteFolder(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this folder?</DialogTitle>
            <DialogDescription>
              Notes and subfolders will be moved to this folder’s parent, or to Unfiled if it has no parent. No notes will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteFolder(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void confirmDeleteFolder()}>Delete folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this note?</DialogTitle>
            <DialogDescription>
              “{pendingDelete?.title}” will be removed from this device. A deletion marker is kept so the deletion reaches other devices on the next sync.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (pendingDelete) {
                void deleteNote(pendingDelete.id)
                if (selectedId === pendingDelete.id) onSelect(null)
              }
              setPendingDelete(null)
            }}>Delete note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NoteEditor({
  note,
  folders,
  onUpdate,
  onMove,
  onBack,
  onDelete,
}: {
  note: VaultNote
  folders: readonly VaultNoteFolder[]
  onUpdate: (id: string, changes: Pick<VaultNote, 'title' | 'markdown' | 'folderId'>) => Promise<void>
  onMove: (id: string, changes: Pick<VaultNote, 'title' | 'markdown' | 'folderId'>) => Promise<void>
  onBack: () => void
  onDelete: () => void
}) {
  const [title, setTitle] = useState(note.title)
  const [markdown, setMarkdown] = useState(note.markdown)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState(note.folderId ?? '__unfiled__')
  const [moveError, setMoveError] = useState<string | null>(null)
  const lastSaved = useRef({ title: note.title, markdown: note.markdown, folderId: note.folderId ?? null })
  const pendingSave = useRef<(() => Promise<void>) | null>(null)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revision = useRef(0)
  const currentFolder = note.folderId
    ? folders.find((folder) => folder.id === note.folderId) ?? null
    : null

  function flushPendingSave(): Promise<void> {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = null
    return pendingSave.current?.() ?? Promise.resolve()
  }

  useEffect(() => {
    const draft = { title, markdown, folderId: note.folderId ?? null }
    if (
      draft.title === lastSaved.current.title &&
      draft.markdown === lastSaved.current.markdown &&
      draft.folderId === lastSaved.current.folderId
    ) return

    const currentRevision = ++revision.current
    const persistedDraft = { ...draft, title: draft.title.trim() || 'Untitled' }
    let savePromise: Promise<void> | null = null
    const save = (): Promise<void> => {
      if (savePromise) return savePromise
      savePromise = (async () => {
        if (currentRevision === revision.current) {
          pendingSave.current = null
          saveTimeout.current = null
        }
        try {
          await onUpdate(note.id, persistedDraft)
          lastSaved.current = persistedDraft
          if (currentRevision === revision.current) {
            if (title !== persistedDraft.title) setTitle(persistedDraft.title)
            setSaveStatus('saved')
          }
        } catch (cause) {
          if (currentRevision === revision.current) setSaveStatus('error')
          throw cause
        }
      })()
      return savePromise
    }
    pendingSave.current = save
    setSaveStatus('saving')
    const timeout = setTimeout(() => { void save().catch(() => undefined) }, 450)
    saveTimeout.current = timeout
    return () => {
      clearTimeout(timeout)
      if (saveTimeout.current === timeout) saveTimeout.current = null
    }
  }, [markdown, note.folderId, note.id, onUpdate, title])

  // If the user switches notes or locks the vault before the debounce expires,
  // flush the latest draft rather than abandoning typed text.
  useEffect(() => () => { void pendingSave.current?.() }, [])

  async function moveNote(): Promise<void> {
    const folderId = moveTarget === '__unfiled__' ? null : moveTarget
    const currentFolderId = note.folderId ?? null
    const currentDraft = { title: title.trim() || 'Untitled', markdown, folderId: currentFolderId }
    const movedDraft = { ...currentDraft, folderId }
    setMoveError(null)
    setSaveStatus('saving')
    try {
      // Flush any debounced text edit before changing its folder reference.
      await flushPendingSave()
      if (folderId !== currentFolderId) {
        await onMove(note.id, movedDraft)
        lastSaved.current = movedDraft
      }
      setSaveStatus('saved')
      setMoveOpen(false)
    } catch (cause) {
      setMoveError(cause instanceof Error ? cause.message : 'Could not move the note')
      setSaveStatus('error')
    }
  }

  async function leaveEditor(): Promise<void> {
    try {
      await flushPendingSave()
    } catch {
      return
    }
    onBack()
  }

  async function requestDelete(): Promise<void> {
    try {
      await flushPendingSave()
    } catch {
      return
    }
    onDelete()
  }

  return (
    <>
    <article className="mx-auto max-w-3xl p-5 sm:p-8">
      <header className="mb-5 flex items-center gap-2 border-b pb-4">
        <Button variant="ghost" size="icon" className="-ml-2 shrink-0 md:hidden" onClick={() => void leaveEditor()} aria-label="Back to notes">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Note title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={flushPendingSave}
            className="h-auto w-full border-transparent px-1 text-xl font-semibold shadow-none focus-visible:border-input"
            placeholder="Untitled"
          />
          <p className="text-muted-foreground truncate px-1 text-xs">
            {currentFolder ? folderPath(currentFolder, folders) : 'Unfiled'}
          </p>
        </div>
        <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline" role="status" aria-live="polite">
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Could not save' : 'Saved'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => {
            setMoveTarget(note.folderId ?? '__unfiled__')
            setMoveError(null)
            setMoveOpen(true)
          }}
          aria-label="Change note folder"
        >
          <Folder />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => void requestDelete()} aria-label="Delete note" className="text-destructive shrink-0">
          <Trash2 />
        </Button>
      </header>

      <div onBlur={flushPendingSave}>
        <Suspense fallback={<div className="text-muted-foreground min-h-[55dvh] py-3 text-sm">Loading editor…</div>}>
          <MilkdownMarkdownEditor value={markdown} onChange={setMarkdown} />
        </Suspense>
      </div>
    </article>
    <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change folder</DialogTitle>
          <DialogDescription>Choose where “{note.title}” is filed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="move-note-folder">Folder</Label>
          <Select value={moveTarget} onValueChange={setMoveTarget}>
            <SelectTrigger id="move-note-folder"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__unfiled__">Unfiled</SelectItem>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>{folderPath(folder, folders)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {moveError ? <p className="text-destructive text-sm">{moveError}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setMoveOpen(false)}>Cancel</Button>
          <Button onClick={() => void moveNote()}>Move note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
