import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDown, ArrowDownWideNarrow, ArrowUp, Bot, Download, FileDown, FolderPlus, Hash, Link2, LogOut, Move, Pencil, Trash2, Upload } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { PaneBar } from './components/PaneBar'
import { SyncAnnouncer } from './components/SyncAnnouncer'
import { paneBarNeeded } from './lib/paneBar'
import { TabStrip } from './components/TabStrip'
import { Menu, type MenuItem } from './components/Menu'
import { Workspace } from './components/Workspace'

/**
 * The editor stack (Tiptap + ProseMirror + Yjs + the markdown serializer) is
 * half the bundle and is useless until a note is open, so it loads as its own
 * chunk instead of being parsed on the login screen.
 */
const NotePane = lazy(() =>
  import('./components/NotePane').then((module) => ({ default: module.NotePane }))
)
import { ShareDialog } from './components/ShareDialog'
import { MoveDialog } from './components/MoveDialog'
import { InputDialog } from './components/InputDialog'
import { AgentsDialog } from './components/AgentsDialog'
import { UpgradeDialog } from './components/UpgradeDialog'
import { UsageDialog } from './components/UsageDialog'
import { useAuth, useWorkspace } from './hooks/useFirebase'
import type { AwarenessUser } from './lib/collab/awareness'
import { download, noteToMarkdown, safeFileName } from './lib/export'
import { buildVault, planVault, streamVaultNotes } from './lib/vault'
import { track } from './lib/analytics'
import { currentBrowser, embeddedBrowserHint } from './lib/browser'
import { memoryReport, pendingBodies, storageEstimate, type MemoryReport } from './lib/diagnostics'
import { buildTagTree, extractTags, matchesTagFilter, parseTagInput } from './lib/tags'
import { flattenFolders, folderPath, sharedFolderOf } from './lib/folders'
import { applyOrder, setFolderSort, setRootSort, subscribeUserSettings } from './lib/notes'
import {
  DEFAULT_SORT,
  SORT_LABELS,
  moveOrder,
  nextOrder,
  orderKey,
  resolveSort,
  sortFolders,
  sortNotes,
  type SortMode,
} from './lib/sorting'
import { SortDialog } from './components/SortDialog'
import { MAX_FOLDER_DEPTH } from './lib/folders'
import {
  activeNoteId,
  activeNoteIds,
  activeTab,
  closeNote,
  closePane,
  canSplit,
  closeTab,
  findNote,
  findPane,
  listPanes,
  MAX_PANES,
  mergeIntoPane,
  openTab,
  replaceActiveTab,
  sanitizeLayout,
  setActiveTab,
  setRatio,
  singlePane,
  splitPaneWithActiveTab,
  type PaneTree,
  type SplitDirection,
} from './lib/panes'
import { RenameTagDialog } from './components/RenameTagDialog'
import { isPaid, subscribeEntitlement } from './lib/entitlements'
import {
  recordUsage,
  setStorageUsage,
  subscribeCredits,
  subscribeUsage,
  type Credits,
  type UsageTotals,
} from './lib/usage'
import type { SyncStats } from './lib/collab/provider'
import {
  fetchNoteBodies,
  importNotes,
  migrateNoteBodies,
  isAclOwner,
  optimisticFolder,
  moveNoteTo,
  renameFolder,
  reserveNoteId,
  saveNoteContent,
  subscribeNote,
  subscribeNoteBody,
  updateFolderSharing,
  updateFolderTags,
  updateNoteSharing,
  type Access,
  type Folder,
  type NewNoteInput,
  type Note,
  type Role,
} from './lib/notes'

const ACTIVE_KEY = 'mdfire-active'
const SIDEBAR_KEY = 'mdfire-sidebar'
const EXPANDED_KEY = 'mdfire-folders'
const PANES_KEY = 'mdfire-panes'

/** Shown instead of a split action once the pane budget is spent. */
const SPLIT_LIMIT_LABEL = `Máximo de paneles (${MAX_PANES})`

/** Tabs and panes as one tree: a pane is a split node's first child. */
interface WorkspaceState {
  layout: PaneTree
  focusedPaneId: string
}

function newId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${suffix}`
}

/** Drops cached documents whose tab was closed (unsubscribed) or note removed. */
function keepIds<T>(map: Record<string, T>, ids: string[]): Record<string, T> {
  const keys = Object.keys(map)
  if (keys.length === ids.length && ids.every((id) => id in map)) return map
  const next: Record<string, T> = {}
  for (const id of ids) {
    if (id in map) next[id] = map[id]
  }
  return next
}

type Dialog =
  | { kind: 'none' }
  | { kind: 'account-menu' }
  | { kind: 'share-note'; noteId: string }
  | { kind: 'share-folder'; folderId: string }
  | { kind: 'move'; noteId: string }
  | { kind: 'new-folder'; parentId: string | null }
  | { kind: 'rename-folder'; folderId: string }
  | { kind: 'folder-tags'; folderId: string }
  | { kind: 'agents' }
  | { kind: 'upgrade' }
  | { kind: 'usage' }
  | { kind: 'sort'; folderId: string | null }
  | { kind: 'rename-tag' }

function noteFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('note')
}

function initialNoteId(): string | null {
  return noteFromUrl() ?? storedActiveNote()
}

function storedActiveNote(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function initialExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set<string>()
  }
}

/** Restores tabs and splits, falling back to one pane with the last note. */
function initialWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(PANES_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { layout?: unknown; focusedPaneId?: unknown }
      const layout = sanitizeLayout(saved.layout)
      if (layout) {
        const panes = listPanes(layout)
        const focused =
          panes.find((pane) => pane.id === saved.focusedPaneId)?.id ?? panes[0].id
        // A `?note=` deep link still wins over whatever was open last time.
        const linked = noteFromUrl()
        if (!linked) return { layout, focusedPaneId: focused }
        const where = findNote(layout, linked)
        if (where) {
          return {
            layout: setActiveTab(layout, where.paneId, where.tabId),
            focusedPaneId: where.paneId,
          }
        }
        return {
          layout: replaceActiveTab(layout, focused, linked, newId('tab')),
          focusedPaneId: focused,
        }
      }
    }
  } catch {
    /* ignore: a corrupt layout is the same as none */
  }
  const paneId = newId('pane')
  return { layout: singlePane(paneId, initialNoteId(), newId('tab')), focusedPaneId: paneId }
}

function AppTree() {
  const { user, loading: authLoading, error: authError, doGoogleSignIn, doSignOut } = useAuth()
  const {
    notes,
    folders,
    loading: dataLoading,
    addNote,
    addFolder,
    addOptimisticFolder,
    dropOptimisticFolder,
    reserveFolderId,
    removeNote,
    removeFolder,
  } = useWorkspace(user?.uid)

  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace)
  const { layout, focusedPaneId } = workspace
  const focusedPane = findPane(layout, focusedPaneId)
  /** The focused pane's current tab is what every menu and dialog acts on. */
  const activeId = focusedPane ? (activeTab(focusedPane)?.noteId ?? null) : null
  /** Metadata of the open notes; the body arrives through `bodies`. */
  const [notesById, setNotesById] = useState<Record<string, Note>>({})
  /** Bodies of the open notes only: the list never downloads them. */
  const [bodies, setBodies] = useState<Record<string, string>>({})
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({})
  /**
   * Manual moves shown before the server confirms them. A reorder is a write plus
   * a round trip; the row used to sit still until the snapshot came back.
   */
  const [orderOverrides, setOrderOverrides] = useState<Record<string, string[]>>({})
  /**
   * Notes whose document is still being created. Their tab is already open, but
   * subscribing to the doc before it exists would hit "permission denied".
   */
  const [pendingNotes, setPendingNotes] = useState<Set<string>>(new Set())
  const notesByIdFromList = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes]
  )
  /**
   * One note, assembled from three cheap places: metadata from the workspace
   * list (already live), the body from its own document, and — for a note the
   * list has never seen, like a `?note=` deep link — its document.
   */
  /**
   * A note ready to render: metadata from the list plus its body document.
   * Null while the body is in flight, which shows "Cargando…" for one frame
   * instead of seeding the editor with an empty document and replacing it.
   */
  const noteFor = useCallback(
    (noteId: string | null): Note | null => {
      if (!noteId) return null
      const meta = notesByIdFromList.get(noteId) ?? notesById[noteId]
      if (!meta) return null
      const body = bodies[noteId]
      const inline = meta.markdown ?? ''
      // A note from before the split still carries its text on the document, so
      // it renders without waiting for (or being able to read) its body.
      if (body === undefined) return inline ? meta : null
      // An empty body document never wins over inline text: that is a note whose
      // migration has not run yet, or whose body read was rejected. Showing it
      // empty would look like the note lost its content.
      if (body === '' && inline) return meta
      return body === inline ? meta : { ...meta, markdown: body }
    },
    [bodies, notesById, notesByIdFromList]
  )
  const foldersById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])

  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [folderMenu, setFolderMenu] = useState<{ folder: Folder; x: number; y: number } | null>(null)
  /** The row's own menu: the tree is where a file's actions live. */
  const [noteMenu, setNoteMenu] = useState<{ note: Note; x: number; y: number } | null>(null)
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)
  const [presence, setPresence] = useState<AwarenessUser[]>([])
  const [status, setStatus] = useState({
    connected: false,
    pendingWrites: 0,
    updateCount: 0,
    error: null as string | null,
  })
  const [paid, setPaid] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [rootSort, setRootSortState] = useState<SortMode>(DEFAULT_SORT)
  const [notice, setNotice] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageTotals | null>(null)
  const [credits, setCredits] = useState<Credits | null>(null)
  /** Read from inside the tab, so "the app uses 1 GB" can be checked. */
  const [memory, setMemory] = useState<MemoryReport | null>(null)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const lastStats = useRef<SyncStats | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  // Once the server order matches what the move asked for, the override is done.
  useEffect(() => {
    const keys = Object.keys(orderOverrides)
    if (keys.length === 0) return
    const serverOrder = (kind: 'notes' | 'folders', parentId: string | null): string[] => {
      const mode = resolveSort(parentId, foldersById, rootSort)
      return kind === 'notes'
        ? sortNotes(notes.filter((note) => (note.folderId ?? null) === parentId), mode).map((n) => n.id)
        : sortFolders(folders.filter((folder) => (folder.parentId ?? null) === parentId), mode).map((f) => f.id)
    }
    const pending = keys.filter((key) => {
      const separator = key.indexOf(':')
      const kind = key.slice(0, separator) as 'notes' | 'folders'
      const raw = key.slice(separator + 1)
      const parentId = raw === 'root' ? null : raw
      const current = serverOrder(kind, parentId)
      return current.join('|') !== orderOverrides[key].join('|')
    })
    if (pending.length !== keys.length) {
      const next: Record<string, string[]> = {}
      pending.forEach((key) => {
        next[key] = orderOverrides[key]
      })
      setOrderOverrides(next)
    }
  }, [folders, foldersById, notes, orderOverrides, rootSort])

  /**
   * With a single pane there is no reason for a second bar: its tabs move into
   * the top bar and the panel actions join that bar's menu. Splits keep a slim
   * strip per pane, because each pane owns its tabs.
   */
  const panes = listPanes(layout)
  const inlinePane = panes.length === 1 ? panes[0] : null
  /** Splitting is what costs memory (one editor per pane), so it is budgeted. */
  const splitAllowed = canSplit(layout)

  /**
   * A note click opens in the focused pane's current tab — the tab model. When
   * the note is already open elsewhere, the pane that has it is focused instead
   * of opening it a second time in a third place.
   */
  const selectNote = useCallback((id: string | null) => {
    setWorkspace((ws) => {
      if (!id) {
        const pane = findPane(ws.layout, ws.focusedPaneId)
        const tab = pane ? activeTab(pane) : null
        if (!pane || !tab) return ws
        return { ...ws, layout: closeTab(ws.layout, pane.id, tab.id) }
      }
      // Already here (both panes can show the same note): just activate it.
      const here = findPane(ws.layout, ws.focusedPaneId)
      const mine = here?.tabs.find((tab) => tab.noteId === id)
      if (here && mine) {
        const next = setActiveTab(ws.layout, here.id, mine.id)
        return next === ws.layout ? ws : { ...ws, layout: next }
      }
      const where = findNote(ws.layout, id)
      if (where) {
        const next = setActiveTab(ws.layout, where.paneId, where.tabId)
        if (next === ws.layout && where.paneId === ws.focusedPaneId) return ws
        return { layout: next, focusedPaneId: where.paneId }
      }
      return { ...ws, layout: replaceActiveTab(ws.layout, ws.focusedPaneId, id, newId('tab')) }
    })
  }, [])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!user) return
    return subscribeUserSettings(user.uid, (settings) => setRootSortState(settings.rootSort))
  }, [user])

  // Usage and credits are only read by the usage dialog: subscribe when it
  // opens instead of using two of the startup listeners.
  const usageOpen = dialog.kind === 'usage'
  useEffect(() => {
    if (!user) {
      setUsage(null)
      setCredits(null)
      return
    }
    if (!usageOpen) return
    const offUsage = subscribeUsage(user.uid, setUsage)
    const offCredits = subscribeCredits(user.uid, setCredits)
    return () => {
      offUsage()
      offCredits()
    }
  }, [user, usageOpen])

  const handleStats = useCallback(
    (stats: SyncStats) => {
      if (!user) return
      const previous = lastStats.current
      lastStats.current = stats
      if (!previous) return
      void recordUsage(user.uid, {
        writes: Math.max(0, stats.blocksWritten - previous.blocksWritten),
        reads: Math.max(0, stats.blocksApplied - previous.blocksApplied),
        bytesWritten: Math.max(0, stats.bytesWritten - previous.bytesWritten),
        bytesRead: Math.max(0, stats.bytesApplied - previous.bytesApplied),
      }).catch(() => undefined)
    },
    [user]
  )

  // `notes` changes on every save (typing included). Writing the storage total
  // on each one was a Firestore write per second; the number is only read by the
  // account panel, so settle first.
  useEffect(() => {
    if (!user) return
    // Bodies are not in the list any more, so the size travels with the note.
    const storage = notes.reduce((sum, note) => sum + (note.markdownBytes ?? 0), 0)
    const timer = setTimeout(() => {
      void setStorageUsage(user.uid, storage).catch(() => undefined)
    }, 5000)
    return () => clearTimeout(timer)
  }, [user, notes])

  useEffect(() => {
    if (!user) {
      setPaid(false)
      return
    }
    return subscribeEntitlement(user.uid, (entitlement) => setPaid(isPaid(entitlement)))
  }, [user])

  useEffect(() => {
    if (!user) return
    track('app_open', user.uid, { platform: isMobile ? 'mobile' : 'desktop' })
  }, [user, isMobile])

  useEffect(() => {
    if (!user || presence.length === 0) return
    track('collab_session', user.uid, { peers: presence.length })
  }, [user, presence.length])

  // Only *visible* notes cost a subscription, and it is a body subscription: the
  // metadata already arrives with the workspace list, so a tab no longer holds a
  // second copy of the note document.
  const openIdsKey = activeNoteIds(layout)
    .filter((id) => !pendingNotes.has(id))
    .join('|')
  useEffect(() => {
    if (!user) {
      setBodies({})
      setNotesById({})
      setNoteErrors({})
      return
    }
    const ids = openIdsKey ? openIdsKey.split('|') : []
    setBodies((prev) => keepIds(prev, ids))
    const offs = ids.map((id) =>
      subscribeNoteBody(
        id,
        (body) => {
          // A note created moments ago may not have its body document yet.
          setBodies((prev) => ({ ...prev, [id]: body ?? '' }))
          setNoteErrors((prev) => {
            if (!(id in prev)) return prev
            const next = { ...prev }
            delete next[id]
            return next
          })
        },
        (message) => setNoteErrors((prev) => ({ ...prev, [id]: message }))
      )
    )
    return () => offs.forEach((off) => off())
  }, [openIdsKey, user])

  /**
   * A note the list has never seen — a `?note=` deep link, or one just created
   * in another tab — still needs its metadata. This is the only place a whole
   * note document is subscribed, and only while the list does not know it.
   */
  const orphanIdsKey = activeNoteIds(layout)
    .filter((id) => !pendingNotes.has(id) && !notesByIdFromList.has(id))
    .join('|')
  useEffect(() => {
    if (!user) return
    const ids = orphanIdsKey ? orphanIdsKey.split('|') : []
    setNotesById((prev) => keepIds(prev, ids))
    if (ids.length === 0) return
    const offs = ids.map((id) =>
      subscribeNote(
        id,
        (note) => {
          setNotesById((prev) => {
            if (!note) {
              if (!(id in prev)) return prev
              const next = { ...prev }
              delete next[id]
              return next
            }
            return { ...prev, [id]: note }
          })
          setNoteErrors((prev) => {
            if (note) return prev
            return id in prev ? prev : { ...prev, [id]: 'La nota no existe o no tenés acceso.' }
          })
        },
        (message) => setNoteErrors((prev) => ({ ...prev, [id]: message }))
      )
    )
    return () => offs.forEach((off) => off())
  }, [orphanIdsKey, user])

  useEffect(() => {
    setPresence([])
  }, [focusedPaneId])

  // Splits are a desktop feature; on a phone every open file becomes a tab of the
  // single visible pane instead of being hidden behind the tree.
  useEffect(() => {
    if (!isMobile) return
    setWorkspace((ws) => {
      if (listPanes(ws.layout).length === 1) return ws
      const pane = mergeIntoPane(ws.layout, ws.focusedPaneId)
      return { layout: pane, focusedPaneId: pane.id }
    })
  }, [isMobile])

  useEffect(() => {
    if (!activeId && focusedPane && focusedPane.tabs.length === 0 && notes.length > 0) {
      selectNote(notes[0].id)
    }
  }, [notes, activeId, focusedPane, selectNote])

  // Tabs and splits survive a reload; ACTIVE_KEY stays as a migration fallback.
  useEffect(() => {
    try {
      localStorage.setItem(PANES_KEY, JSON.stringify(workspace))
      const noteId = activeNoteId(workspace.layout, workspace.focusedPaneId)
      if (noteId) localStorage.setItem(ACTIVE_KEY, noteId)
      else localStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* ignore */
    }
  }, [workspace])

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(expanded)))
    } catch {
      /* ignore */
    }
  }, [expanded])

  const refreshDiagnostics = useCallback(() => {
    setMemory(memoryReport())
    void storageEstimate().then(setStorage)
  }, [])

  const handleMigrateBodies = useCallback(async () => {
    const legacy = notes.filter(
      (note) => (note.markdown ?? '') !== '' && note.markdownBytes === undefined
    )
    if (legacy.length === 0) return
    setNotice(`Migrando ${legacy.length} cuerpos…`)
    try {
      const { migrated, failed } = await migrateNoteBodies(legacy)
      setNotice(
        failed.length === 0
          ? `Migrados ${migrated.length} cuerpos.`
          : `Migrados ${migrated.length}. Fallaron ${failed.length}: revisá que las reglas estén desplegadas.`
      )
    } catch {
      setNotice('No se pudo migrar los cuerpos.')
    }
    refreshDiagnostics()
  }, [notes, refreshDiagnostics])

  useEffect(() => {
    if (dialog.kind === 'usage') refreshDiagnostics()
  }, [dialog.kind, refreshDiagnostics])


  const handleExportAll = useCallback(async () => {
    if (notes.length === 0) return
    // The list carries no bodies: an export reads them once, at export time.
    setNotice(`Preparando ${notes.length} notas…`)
    try {
      const bodies = await fetchNoteBodies(
        notes.map((note) => note.id),
        { onProgress: (done) => setNotice(`Preparando… ${done}/${notes.length} notas`) }
      )
      const withBodies = notes.map((note) => ({ ...note, markdown: bodies.get(note.id) ?? note.markdown }))
      const vault = buildVault(withBodies, folders)
      download(vault.blob, vault.fileName, 'application/zip')
      setNotice(`Exportadas ${vault.notes} notas en ${vault.fileName} (listo para abrir en Obsidian).`)
      track('export', user?.uid, { kind: 'vault' })
    } catch {
      setNotice('No se pudo exportar el vault. Revisá la conexión.')
    }
  }, [notes, folders, user?.uid])

  const handleExportNote = useCallback(
    async (note: Note) => {
      // A row can export a note that was never opened, and only open notes keep
      // their body in the workspace list: read the one we are about to write.
      let markdown = note.markdown ?? ''
      if (markdown === '') {
        const bodies = await fetchNoteBodies([note.id])
        markdown = bodies.get(note.id) ?? ''
      }
      download(noteToMarkdown({ ...note, markdown }), `${safeFileName(note.title)}.md`, 'text/markdown')
      track('export', user?.uid, { kind: 'md' })
    },
    [user?.uid]
  )

  const handleImportFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !user) return
      const list = Array.from(files)
      // Keyed by lower-case path: the props array does not contain folders created
      // during this import, so the cache is the source of truth (this used to
      // create one folder per note).
      const normalizeKey = (name: string) => name.normalize('NFC').trim().toLowerCase()
      const folderCache = new Map<string, Folder>()
      for (const folder of folders) {
        const parentChain: string[] = []
        let cursor: Folder | undefined = folder
        while (cursor) {
          parentChain.unshift(normalizeKey(cursor.name))
          cursor = cursor.parentId ? folders.find((f) => f.id === cursor!.parentId) : undefined
        }
        folderCache.set(`/${parentChain.join('/')}`, folder)
      }
      // Title of the first imported note, so the import can open something.
      let first: string | null = null
      let imported = 0
      let failedNotes = 0
      let skippedAttachments = 0
      let skippedJunk = 0
      let skippedLarge = 0

      // One write per note, committed in chunks: the create-then-content pair was
      // two round trips per note (1.000 of them for a 500-note vault).
      const queue: NewNoteInput[] = []
      const flush = async () => {
        if (queue.length === 0) return
        const pending = queue.splice(0, queue.length)
        const { created, failed } = await importNotes(user.uid, pending, {
          onProgress: (done) => setNotice(`Importando… ${imported + done} notas`),
        })
        imported += created.length
        if (failed > 0) failedNotes += failed
        if (!first && created.length > 0) first = created[0]
      }

      const pushNote = async (title: string, markdown: string, folderName: string | null) => {
        let folder: Folder | undefined
        if (folderName) {
          // `GUIONES/V3` becomes V3 inside GUIONES, one folder per segment.
          const segments = folderName.split('/').filter(Boolean).slice(0, MAX_FOLDER_DEPTH)
          let parentId: string | null = null
          for (const segment of segments) {
            const key = `${parentId ?? ''}/${normalizeKey(segment)}`
            folder = folderCache.get(key)
            if (!folder) {
              // Imported folders inherit the ordering of their parent too.
              const inherited: SortMode = parentId
                ? resolveSort(parentId, foldersById, rootSort)
                : rootSort
              folder = (await addFolder(segment, parentId, { sort: inherited })) ?? undefined
              if (folder) folderCache.set(key, folder)
            }
            if (!folder) break
            parentId = folder.id
          }
        }
        queue.push({
          title,
          markdown: markdown.slice(0, 250_000),
          tags: extractTags(markdown),
          folder: folder ?? null,
        })
        if (queue.length >= 50) await flush()
      }

      for (const file of list) {
        if (/\.zip$/i.test(file.name)) {
          const zipBytes = new Uint8Array(await file.arrayBuffer())
          // Two passes: the plan reads only the ZIP directory (paths and sizes),
          // then the bodies stream one at a time. Inflating and decoding the
          // whole vault up front held 2-3× its size while importing.
          const plan = planVault(zipBytes)
          for await (const entry of streamVaultNotes(zipBytes, plan)) {
            await pushNote(entry.title, entry.markdown, entry.folder)
          }
          skippedAttachments += plan.skipped.filter((s) => s.reason === 'attachment').length
          skippedJunk += plan.skipped.filter((s) => s.reason === 'junk').length
          skippedLarge += plan.skipped.filter((s) => s.reason === 'too-large').length
          continue
        }

        const text = await file.text()
        const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
        await pushNote((heading || file.name.replace(/\.md$/i, '')).slice(0, 300), text, null)
      }

      await flush()
      track('import', user.uid, { count: imported })
      const details: string[] = []
      if (skippedJunk > 0) details.push(`${skippedJunk} archivos de sistema de macOS`)
      if (skippedAttachments > 0) details.push(`${skippedAttachments} adjuntos (todavía no se guardan imágenes)`)
      if (skippedLarge > 0) details.push(`${skippedLarge} notas de más de 250 KB`)
      if (failedNotes > 0) details.push(`${failedNotes} no se pudieron guardar`)
      setNotice(
        details.length > 0
          ? `Importadas ${imported} notas. Omitidos: ${details.join(', ')}.`
          : `Importadas ${imported} notas.`
      )
      if (first) selectNote(first)
    },
    [addFolder, folders, selectNote, user]
  )

  const focusPane = useCallback((paneId: string) => {
    setWorkspace((ws) =>
      ws.focusedPaneId === paneId || !findPane(ws.layout, paneId)
        ? ws
        : { ...ws, focusedPaneId: paneId }
    )
  }, [])

  const activateTab = useCallback((paneId: string, tabId: string) => {
    setWorkspace((ws) => {
      const layout = setActiveTab(ws.layout, paneId, tabId)
      if (layout === ws.layout && ws.focusedPaneId === paneId) return ws
      return { layout, focusedPaneId: paneId }
    })
  }, [])

  const closePaneTab = useCallback((paneId: string, tabId: string) => {
    setWorkspace((ws) => {
      const layout = closeTab(ws.layout, paneId, tabId)
      if (layout === ws.layout) return ws
      const panes = listPanes(layout)
      const focused = panes.some((pane) => pane.id === ws.focusedPaneId)
        ? ws.focusedPaneId
        : panes[0].id
      return { layout, focusedPaneId: focused }
    })
  }, [])

  /** The X in the tab bar: closes the pane itself, tabs and all. */
  const closePaneAt = useCallback((paneId: string) => {
    setWorkspace((ws) => {
      const layout = closePane(ws.layout, paneId)
      if (layout === ws.layout) return ws
      const panes = listPanes(layout)
      const focused = panes.some((pane) => pane.id === ws.focusedPaneId)
        ? ws.focusedPaneId
        : panes[0].id
      return { layout, focusedPaneId: focused }
    })
  }, [])

  /**
   * Splits a pane and focuses the new half, which opens with a copy of the page
   * you were reading: the next file click replaces it there.
   */
  const splitPaneAt = useCallback((paneId: string, direction: SplitDirection) => {
    setWorkspace((ws) => {
      // Every pane holds an editor: the budget is what keeps memory bounded.
      if (!canSplit(ws.layout)) return ws
      const ids = { paneId: newId('pane'), tabId: newId('tab'), splitId: newId('split') }
      const layout = splitPaneWithActiveTab(ws.layout, paneId, direction, ids)
      if (layout === ws.layout) return ws
      return { layout, focusedPaneId: ids.paneId }
    })
  }, [])

  const resizeSplit = useCallback((splitId: string, ratio: number) => {
    setWorkspace((ws) => {
      const layout = setRatio(ws.layout, splitId, ratio)
      return layout === ws.layout ? ws : { ...ws, layout }
    })
  }, [])

  const handleChooseSort = useCallback(
    async (mode: SortMode) => {
      if (!user || dialog.kind !== 'sort') return
      if (dialog.folderId) await setFolderSort(dialog.folderId, mode)
      else {
        setRootSortState(mode)
        await setRootSort(user.uid, mode)
      }
    },
    [dialog, user]
  )

  /** Moves a note one position inside its folder (manual order only). */
  const handleMoveNote = useCallback(
    async (note: Note, direction: -1 | 1) => {
      if (!user) return
      const parentId = note.folderId ?? null
      const mode = resolveSort(parentId, foldersById, rootSort)
      if (mode !== 'manual') {
        setNotice('Poné el orden de la carpeta en «Manual» para mover notas.')
        return
      }
      const siblings = sortNotes(notes.filter((n) => (n.folderId ?? null) === parentId), 'manual')
      // One write in the common case, a renumber only when the gap ran out.
      const move = moveOrder(siblings.map((n) => ({ id: n.id, order: n.order })), note.id, direction)
      if (!move) return
      const key = orderKey('notes', parentId)
      setOrderOverrides((prev) => ({ ...prev, [key]: move.ids }))
      try {
        await applyOrder('notes', move.updates)
      } catch {
        // The local order would be a lie: drop it and say so.
        setOrderOverrides((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        setNotice('No se pudo guardar el orden. Revisá la conexión.')
      }
    },
    [foldersById, notes, rootSort, user]
  )

  const handleMoveFolder = useCallback(
    async (folder: Folder, direction: -1 | 1) => {
      const parentId = folder.parentId ?? null
      const mode = resolveSort(parentId, foldersById, rootSort)
      if (mode !== 'manual') {
        setNotice('Poné el orden del nivel en «Manual» para mover carpetas.')
        return
      }
      const siblings = sortFolders(folders.filter((f) => (f.parentId ?? null) === parentId), 'manual')
      const move = moveOrder(siblings.map((f) => ({ id: f.id, order: f.order })), folder.id, direction)
      if (!move) return
      const key = orderKey('folders', parentId)
      setOrderOverrides((prev) => ({ ...prev, [key]: move.ids }))
      try {
        await applyOrder('folders', move.updates)
      } catch {
        setOrderOverrides((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        setNotice('No se pudo guardar el orden. Revisá la conexión.')
      }
    },
    [folders, foldersById, rootSort]
  )

  const handleRenameTag = useCallback(
    async (from: string, to: string) => {
      if (!user) return
      const source = from.replace(/^#/, '')
      const target = to.replace(/^#/, '')
      const affected = notes.filter((note) =>
        note.tags.some((tag) => tag.toLowerCase() === source.toLowerCase())
      )
      // Tags live on the note, the text lives in its body: read the affected
      // bodies (only those) before rewriting them.
      const bodies = await fetchNoteBodies(affected.map((note) => note.id))
      const pattern = new RegExp(`#${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w/.-])`, 'gi')
      const updates: { id: string; markdown: string; version: number }[] = []
      for (const note of affected) {
        const markdown = bodies.get(note.id) ?? note.markdown ?? ''
        let next = markdown.replace(pattern, `#${target}`)
        // frontmatter list / array entries
        next = next.replace(
          /^(tags?:\s*\[)([^\]]*)(\])$/gim,
          (_match, open: string, body: string, close: string) =>
            `${open}${body
              .split(',')
              .map((item) =>
                item.trim().toLowerCase() === source.toLowerCase() ? target : item.trim()
              )
              .join(', ')}${close}`
        )
        next = next.replace(
          /^([ \t]*-[ \t]*)([^\n#]+)$/gm,
          (match: string, prefix: string, value: string) =>
            value.trim().toLowerCase() === source.toLowerCase() ? `${prefix}${target}` : match
        )
        if (next === markdown) continue
        updates.push({ id: note.id, markdown: next, version: note.version + 1 })
      }
      // One write per affected note, in small parallel batches: sequential
      // awaits made renaming a common tag wait for every round trip.
      for (let i = 0; i < updates.length; i += 10) {
        await Promise.all(
          updates.slice(i, i + 10).map((update) =>
            saveNoteContent(update.id, {
              markdown: update.markdown,
              tags: extractTags(update.markdown),
              version: update.version,
            })
          )
        )
      }
      const changed = updates.length
      setSelectedTags((current) =>
        current.map((tag) => (tag === source.toLowerCase() ? target.toLowerCase() : tag))
      )
      setNotice(`Etiqueta renombrada en ${changed} ${changed === 1 ? 'nota' : 'notas'}.`)
      track('note_shared', user.uid, { kind: 'tag-rename' })
    },
    [notes, user]
  )

  const toggleFolder = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /**
   * New notes open in their own tab, so they never replace a file you have open.
   *
   * The tab opens on the first frame with a reserved document id; the Firestore
   * write happens in the background and its result is injected straight into
   * `notesById`, so opening a note costs one round trip instead of two (or a
   * frozen UI while the dialog waits).
   */
  const handleNewNote = useCallback(
    async (folder?: Folder, paneId?: string) => {
      const noteId = reserveNoteId()
      const target = paneId && findPane(layout, paneId) ? paneId : focusedPaneId

      if (!noteId) {
        // Firebase unavailable: fall back to the blocking path.
        const note = await addNote(folder)
        if (!note) return
        if (folder) setExpanded((prev) => new Set(prev).add(folder.id))
        track('note_created', user?.uid, { folder: folder ? 'yes' : 'root' })
        setWorkspace((ws) => ({
          layout: openTab(ws.layout, target, note.id, newId('tab')),
          focusedPaneId: target,
        }))
        if (isMobile) setSidebarOpen(false)
        return
      }

      const tabId = newId('tab')
      setPendingNotes((prev) => new Set(prev).add(noteId))
      setWorkspace((ws) => ({
        layout: openTab(ws.layout, target, noteId, tabId),
        focusedPaneId: target,
      }))
      if (folder) setExpanded((prev) => new Set(prev).add(folder.id))
      if (isMobile) setSidebarOpen(false)

      try {
        const note = await addNote(folder, noteId)
        if (!note) throw new Error('no note')
        track('note_created', user?.uid, { folder: folder ? 'yes' : 'root' })
        // Show the editor now instead of waiting for another snapshot round trip.
        setNotesById((prev) => ({ ...prev, [noteId]: note }))
      } catch {
        setNotesById((prev) => {
          if (!(noteId in prev)) return prev
          const next = { ...prev }
          delete next[noteId]
          return next
        })
        setWorkspace((ws) => {
          const next = closeTab(ws.layout, target, tabId)
          if (next === ws.layout) return ws
          const panes = listPanes(next)
          const focused = panes.some((pane) => pane.id === ws.focusedPaneId)
            ? ws.focusedPaneId
            : panes[0].id
          return { layout: next, focusedPaneId: focused }
        })
        setNotice('No se pudo crear la nota. Revisá la conexión.')
      } finally {
        setPendingNotes((prev) => {
          if (!prev.has(noteId)) return prev
          const next = new Set(prev)
          next.delete(noteId)
          return next
        })
      }
    },
    [addNote, focusedPaneId, isMobile, layout, user]
  )

  /**
   * Creates a folder on the first frame.
   *
   * The id is reserved on the client and the row is shown immediately; the write
   * and its snapshot used to be two round trips with nothing on screen. If the
   * write fails, the row disappears and the user is told.
   */
  const handleNewFolder = useCallback(
    async (name: string, parentId: string | null = null) => {
      const inherited = parentId ? resolveSort(parentId, foldersById, rootSort) : rootSort
      const siblings = folders.filter((f) => (f.parentId ?? null) === parentId)
      const options = { sort: inherited, order: nextOrder(siblings) }
      const id = reserveFolderId()
      const optimistic = id && user ? optimisticFolder(user.uid, id, name, parentId, options) : null
      if (optimistic) addOptimisticFolder(optimistic)
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId))

      let folder: Folder | null = null
      try {
        folder = await addFolder(name, parentId, options, id ?? undefined)
      } catch {
        folder = null
      }
      if (!folder) {
        if (optimistic) dropOptimisticFolder(optimistic.id)
        setNotice('No se pudo crear la carpeta. Revisá la conexión.')
        return null
      }
      setExpanded((prev) => new Set(prev).add(folder.id))
      return folder
    },
    [
      addFolder,
      addOptimisticFolder,
      dropOptimisticFolder,
      folders,
      foldersById,
      reserveFolderId,
      rootSort,
      user,
    ]
  )

  const handleDeleteNote = useCallback(
    async (note: Note) => {
      if (!window.confirm(`¿Eliminar "${note.title || 'Sin título'}"?`)) return
      // Every tab showing it goes away immediately (it can be open in both
      // panes); the delete finishes in the background.
      setWorkspace((ws) => {
        const layout = closeNote(ws.layout, note.id)
        return layout === ws.layout ? ws : { ...ws, layout }
      })
      try {
        await removeNote(note.id)
      } catch {
        setNotice('No se pudo eliminar la nota. Revisá la conexión.')
      }
    },
    [removeNote]
  )

  const handleDeleteFolder = useCallback(
    async (folder: Folder) => {
      if (
        !window.confirm(
          `¿Eliminar la carpeta "${folder.name}"? Sus notas vuelven a "Sin carpeta" y quedan privadas.`
        )
      ) {
        return
      }
      await removeFolder(folder.id)
    },
    [removeFolder]
  )

  const handleSignOut = useCallback(async () => {
    await doSignOut()
    // Another account's notes must not come back as tabs.
    const paneId = newId('pane')
    setWorkspace({ layout: singlePane(paneId), focusedPaneId: paneId })
  }, [doSignOut])

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setSidebarOpen((v) => !v)
      return
    }
    setCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [isMobile])

  const shareFolderTarget =
    dialog.kind === 'share-folder' ? folders.find((f) => f.id === dialog.folderId) : undefined
  const shareNote = dialog.kind === 'share-note' ? noteFor(dialog.noteId) : null
  const shareNoteFolder = shareNote ? sharedFolderOf(shareNote, folders) : null
  const moveNote = dialog.kind === 'move' ? noteFor(dialog.noteId) : null

  /**
   * A file's actions belong to the file, so they open from its row in the tree
   * (the ⋯ beside it, or a right click) instead of a bar button that only ever
   * acted on whichever tab happened to be focused.
   */
  const noteMenuItems: MenuItem[] = noteMenu
    ? (() => {
        const note = noteMenu.note
        const owner = !!user && note.ownerId === user.uid
        const inherited = sharedFolderOf(note, folders)
        const canManageShare = owner && note.aclSource === 'own'
        const items: MenuItem[] = []
        if (canManageShare || inherited) {
          items.push({
            label: inherited ? 'Permisos de la carpeta…' : 'Compartir…',
            icon: <Link2 size={14} />,
            onSelect: () =>
              setDialog(
                !paid
                  ? { kind: 'upgrade' }
                  : inherited
                    ? { kind: 'share-folder', folderId: inherited.id }
                    : { kind: 'share-note', noteId: note.id }
              ),
          })
        }
        if (resolveSort(note.folderId ?? null, foldersById, rootSort) === 'manual') {
          items.push({
            label: 'Subir',
            icon: <ArrowUp size={14} />,
            onSelect: () => void handleMoveNote(note, -1),
          })
          items.push({
            label: 'Bajar',
            icon: <ArrowDown size={14} />,
            onSelect: () => void handleMoveNote(note, 1),
          })
        }
        items.push({
          label: 'Exportar .md',
          icon: <FileDown size={14} />,
          onSelect: () => void handleExportNote(note),
        })
        if (owner) {
          items.push({
            label: 'Mover a…',
            icon: <Move size={14} />,
            onSelect: () => setDialog({ kind: 'move', noteId: note.id }),
          })
          items.push({
            label: 'Eliminar nota',
            icon: <Trash2 size={14} />,
            danger: true,
            separatorBefore: true,
            onSelect: () => void handleDeleteNote(note),
          })
        }
        return items
      })()
    : []

  const folderMenuItems: MenuItem[] = folderMenu
    ? [
        {
          label: 'Nueva nota acá',
          icon: <FolderPlus size={14} />,
          onSelect: () => void handleNewNote(folderMenu.folder),
        },
        {
          label: 'Nueva subcarpeta…',
          icon: <FolderPlus size={14} />,
          onSelect: () => setDialog({ kind: 'new-folder', parentId: folderMenu!.folder.id }),
        },
        {
          label: 'Renombrar…',
          icon: <Pencil size={14} />,
          onSelect: () => setDialog({ kind: 'rename-folder', folderId: folderMenu.folder.id }),
        },
        {
          label: 'Etiquetas…',
          icon: <Hash size={14} />,
          onSelect: () => setDialog({ kind: 'folder-tags', folderId: folderMenu.folder.id }),
        },
        {
          label: `Orden: ${SORT_LABELS[folderMenu.folder.sort ?? resolveSort(folderMenu.folder.parentId ?? null, foldersById, rootSort)]}…`,
          icon: <ArrowDownWideNarrow size={14} />,
          onSelect: () => setDialog({ kind: 'sort', folderId: folderMenu!.folder.id }),
        },
        ...(resolveSort(folderMenu.folder.parentId ?? null, foldersById, rootSort) === 'manual'
          ? [
              {
                label: 'Subir',
                icon: <ArrowUp size={14} />,
                onSelect: () => void handleMoveFolder(folderMenu!.folder, -1),
              },
              {
                label: 'Bajar',
                icon: <ArrowDown size={14} />,
                onSelect: () => void handleMoveFolder(folderMenu!.folder, 1),
              },
            ]
          : []),
        ...(isAclOwner(folderMenu.folder, user?.uid)
          ? [
              {
                label: 'Compartir…',
                icon: <Link2 size={14} />,
                onSelect: () =>
                  setDialog(
                    paid ? { kind: 'share-folder', folderId: folderMenu!.folder.id } : { kind: 'upgrade' }
                  ),
              },
            ]
          : []),
        ...(isAclOwner(folderMenu.folder, user?.uid)
          ? [
              {
                label: 'Eliminar carpeta',
                icon: <Trash2 size={14} />,
                danger: true,
                separatorBefore: true,
                onSelect: () => void handleDeleteFolder(folderMenu.folder),
              },
            ]
          : []),
      ]
    : []

  const userName = user?.displayName || user?.email?.split('@')[0] || ''

  const tagTree = useMemo(() => buildTagTree(notes), [notes])
  const visibleNotes = selectedTags.length
    ? notes.filter((note) => matchesTagFilter(note.tags, selectedTags))
    : notes
  /** Inactive tabs take their label from the workspace list: no subscription each. */
  const titles = useMemo(() => new Map(notes.map((note) => [note.id, note.title])), [notes])

  /**
   * The pane's whole action set: split right, split down, close. Three buttons
   * and no menu — a new note already has its `+`, so nothing is duplicated here.
   * A phone shows one pane at a time, so it gets no split buttons at all.
   */
  const splitActions = (paneId: string) => ({
    onSplitRight: isMobile ? undefined : () => splitPaneAt(paneId, 'row'),
    onSplitDown: isMobile ? undefined : () => splitPaneAt(paneId, 'column'),
    splitLimitLabel: splitAllowed ? undefined : SPLIT_LIMIT_LABEL,
  })

  /**
   * With a single pane there is no reason for a second bar: its tabs move into
   * the top bar (see `panes`/`inlinePane` above).
   */
  const inlineTabs = inlinePane ? (
    <TabStrip
      compact
      tabs={inlinePane.tabs.map((tab) => ({ id: tab.id, title: titles.get(tab.noteId) ?? '' }))}
      activeTabId={inlinePane.activeTabId}
      onActivate={(tabId) => activateTab(inlinePane.id, tabId)}
      onClose={(tabId) => closePaneTab(inlinePane.id, tabId)}
      onNewNote={() => void handleNewNote(undefined, inlinePane.id)}
      {...splitActions(inlinePane.id)}
    />
  ) : undefined

  // No tabs to host, no toggle to show, no filter, nobody else editing: the
  // panes start at the top of the window (see `paneBarNeeded`).
  const barNeeded = paneBarNeeded({
    hasTabs: Boolean(inlineTabs),
    isMobile,
    sidebarCollapsed: !isMobile && collapsed,
    selectedTags: selectedTags.length,
    presence: presence.length,
  })

  if (authLoading) return <div className="empty">Cargando…</div>

  if (!user) {
    const browser = currentBrowser()
    const appUrl = typeof window !== 'undefined' ? window.location.origin : ''

    return (
      <div className="auth">
        <div className="auth-panel">
          <span className="auth-wordmark">
            <img className="auth-mark" src="/favicon.svg" alt="" width={20} height={20} />
            FireMD
          </span>
          <h1 className="auth-title">Tus notas en Markdown, en carpetas, compartidas.</h1>
          <p className="auth-sub">
            Edición en tiempo real sobre tu vault de Obsidian. Lo que escribís sigue siendo un{' '}
            <code>.md</code>.
          </p>
          <button className="btn auth-btn" onClick={() => void doGoogleSignIn()}>
            Entrar con Google
          </button>

        {browser.embedded && (
          <div className="share-hint-box" style={{ maxWidth: 380, textAlign: 'left' }}>
            <strong>Google va a rechazar este navegador.</strong>
            <br />
            {embeddedBrowserHint(browser.reason)}
            <br />
            Abrí esta dirección en Chrome o Safari:
            <br />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{appUrl}</span>
          </div>
        )}

          {authError && <p className="hint tone-danger">{authError}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      {isMobile && sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <Sidebar
        notes={visibleNotes}
        folders={folders}
        activeId={activeId}
        onSelect={(id) => {
          setPresence([])
          selectNote(id)
          setSidebarOpen(false)
        }}
        onNewNote={(folder) => void handleNewNote(folder)}
        onHeaderMenu={(pos) => setHeaderMenu(pos)}
        onNoteMenu={(note, pos) => setNoteMenu({ note, ...pos })}
        rootSort={rootSort}
        onFolderMenu={(folder, pos) => setFolderMenu({ folder, ...pos })}
        expanded={expanded}
        onToggleFolder={toggleFolder}
        onClose={() => setSidebarOpen(false)}
        onCollapse={toggleSidebar}
        isMobile={isMobile}
        isOpen={isMobile ? sidebarOpen : !collapsed}
        status={status}
        loading={dataLoading}
        tagTree={tagTree}
        selectedTags={selectedTags}
        onToggleTag={(key) =>
          setSelectedTags((current) =>
            current.includes(key) ? current.filter((t) => t !== key) : [...current, key]
          )
        }
        uid={user.uid}
        userName={userName}
        photoURL={user.photoURL}
        onAccountClick={() => setDialog({ kind: 'account-menu' })}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />

      <main className="pane">
        {/* Always mounted, never painted: the words the dot in the sidebar
            footer stands for, announced wherever the layout is. */}
        <SyncAnnouncer status={status} />
        {/* Same split as the sync dot: the bell in the sidebar footer is the
            painted half, this is what a screen reader hears when the panel is
            collapsed or closed behind the phone drawer. */}
        <span className="sr-only" role="status">
          {notice ?? ''}
        </span>

        {/* The bar exists only when it carries something. With more than one
            pane the tabs live in each pane's own strip, so an empty row above
            them would only cost height. */}
        {barNeeded && (
          <PaneBar
            presence={presence}
            sidebarCollapsed={!isMobile && collapsed}
            isMobile={isMobile}
            onToggleSidebar={toggleSidebar}
            selectedTags={selectedTags}
            onClearTags={() => setSelectedTags([])}
            tabs={inlineTabs}
          />
        )}

        <Suspense
          fallback={
            <div className="workspace">
              <p className="hint" style={{ padding: '16px 24px' }}>
                Cargando editor…
              </p>
            </div>
          }
        >
        <Workspace
          tree={layout}
          focusedPaneId={focusedPaneId}
          isMobile={isMobile}
          onFocusPane={focusPane}
          onRatio={resizeSplit}
          renderPane={(pane) => {
            const currentTab = activeTab(pane)
            const noteId = currentTab?.noteId ?? null
            return (
              <NotePane
                key={pane.id}
                pane={pane}
                titles={titles}
                note={
                  noteId
                    ? noteFor(noteId)
                    : null
                }
                noteError={noteId ? (noteErrors[noteId] ?? null) : null}
                creating={noteId ? pendingNotes.has(noteId) : false}
                focused={pane.id === focusedPaneId}
                uid={user.uid}
                userName={userName || 'Alguien'}
                folders={folders}
                isMobile={isMobile}
                onFocus={() => focusPane(pane.id)}
                onActivateTab={(tabId) => activateTab(pane.id, tabId)}
                onCloseTab={(tabId) => closePaneTab(pane.id, tabId)}
                onNewNote={() => void handleNewNote(undefined, pane.id)}
                onClosePane={panes.length > 1 ? () => closePaneAt(pane.id) : undefined}
                hideTabs={pane.id === inlinePane?.id}
                onImport={() => importRef.current?.click()}
                emptyWorkspace={notes.length === 0}
                {...splitActions(pane.id)}
                onTagClick={(tag) =>
                  setSelectedTags((current) =>
                    current.includes(tag.toLowerCase()) ? current : [...current, tag.toLowerCase()]
                  )
                }
                onRenameTag={() => setDialog({ kind: 'rename-tag' })}
                onPresence={setPresence}
                onStatus={setStatus}
                onStats={handleStats}
              />
            )
          }}
        />
        </Suspense>
      </main>

      {noteMenu && noteMenuItems.length > 0 && (
        <Menu
          items={noteMenuItems}
          anchor="pointer"
          pos={{ x: noteMenu.x, y: noteMenu.y }}
          onClose={() => setNoteMenu(null)}
        />
      )}

      {headerMenu && (
        <Menu
          anchor="pointer"
          pos={headerMenu}
          onClose={() => setHeaderMenu(null)}
          items={[
            {
              label: 'Nueva carpeta',
              icon: <FolderPlus size={14} />,
              onSelect: () => setDialog({ kind: 'new-folder', parentId: null }),
            },
            {
              label: `Orden de la lista: ${SORT_LABELS[rootSort]}…`,
              icon: <ArrowDownWideNarrow size={14} />,
              separatorBefore: true,
              onSelect: () => setDialog({ kind: 'sort', folderId: null }),
            },
          ]}
        />
      )}

      {folderMenu && (
        <Menu
          items={folderMenuItems}
          anchor="pointer"
          pos={{ x: folderMenu.x, y: folderMenu.y }}
          onClose={() => setFolderMenu(null)}
        />
      )}

      {dialog.kind === 'account-menu' && (
        <>
          <div
            className="scrim"
            style={{ background: 'transparent' }}
            onClick={() => setDialog({ kind: 'none' })}
          />
          <Menu
            items={[
              {
                label: 'Exportar vault (.zip)',
                icon: <Download size={14} />,
                onSelect: handleExportAll,
              },
              {
                label: 'Uso y facturación…',
                icon: <Activity size={14} />,
                onSelect: () => setDialog({ kind: 'usage' }),
                separatorBefore: true,
              },
              {
                label: 'Importar vault (.zip o .md)…',
                icon: <Upload size={14} />,
                onSelect: () => importRef.current?.click(),
              },
              {
                label: paid ? 'Agentes de IA…' : 'Agentes de IA (plan pago)…',
                icon: <Bot size={14} />,
                onSelect: () => setDialog(paid ? { kind: 'agents' } : { kind: 'upgrade' }),
                separatorBefore: true,
              },
              {
                label: 'Cerrar sesión',
                icon: <LogOut size={14} />,
                separatorBefore: true,
                onSelect: () => void handleSignOut(),
              },
            ]}
            onClose={() => setDialog({ kind: 'none' })}
            anchor="bottom-left"
          />
        </>
      )}

      {dialog.kind === 'share-note' && shareNote && (
        <ShareDialog
          target={{
            kind: 'note',
            id: shareNote.id,
            name: shareNote.title,
            acl: { memberIds: shareNote.memberIds, roles: shareNote.roles, access: shareNote.access },
            ownerId: shareNote.ownerId,
            inheritedFrom: shareNoteFolder
              ? { id: shareNoteFolder.id, name: shareNoteFolder.name }
              : null,
          }}
          currentUid={user.uid}
          onClose={() => setDialog({ kind: 'none' })}
          onChangeAccess={(access: Access) => {
            track('note_shared', user.uid, { kind: 'note', access })
            return updateNoteSharing(shareNote, { access })
          }}
          onAddMember={(uid: string, role: Role) =>
            updateNoteSharing(shareNote, { addMember: { uid, role } })
          }
          onSetRole={(uid: string, role: Role) =>
            updateNoteSharing(shareNote, { setRole: { uid, role } })
          }
          onRemoveMember={(uid: string) => updateNoteSharing(shareNote, { removeMember: uid })}
          onOpenFolder={(folderId) => setDialog({ kind: 'share-folder', folderId })}
        />
      )}

      {dialog.kind === 'share-folder' && shareFolderTarget && (
        <ShareDialog
          target={{
            kind: 'folder',
            id: shareFolderTarget.id,
            name: shareFolderTarget.name,
            acl: {
              memberIds: shareFolderTarget.memberIds,
              roles: shareFolderTarget.roles,
              access: shareFolderTarget.access,
            },
            ownerId: shareFolderTarget.ownerId,
          }}
          currentUid={user.uid}
          onClose={() => setDialog({ kind: 'none' })}
          onChangeAccess={(access: Access) => {
            track('note_shared', user.uid, { kind: 'folder', access })
            return updateFolderSharing(shareFolderTarget, { access })
          }}
          onAddMember={(uid: string, role: Role) =>
            updateFolderSharing(shareFolderTarget, { addMember: { uid, role } })
          }
          onSetRole={(uid: string, role: Role) =>
            updateFolderSharing(shareFolderTarget, { setRole: { uid, role } })
          }
          onRemoveMember={(uid: string) =>
            updateFolderSharing(shareFolderTarget, { removeMember: uid })
          }
        />
      )}

      {dialog.kind === 'move' && moveNote && (
        <MoveDialog
          noteTitle={moveNote.title}
          folders={flattenFolders(folders).map((node) => ({
            ...node.folder,
            name: `${'\u00a0\u00a0'.repeat(node.depth)}${node.folder.name}`,
          }))}
          currentFolderId={moveNote.folderId}
          onMove={(folder) => void moveNoteTo(moveNote, folder)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      {dialog.kind === 'sort' && (
        <SortDialog
          target={
            dialog.folderId
              ? folderPath(dialog.folderId, foldersById) || 'Carpeta'
              : 'Sin carpeta'
          }
          current={
            dialog.folderId
              ? resolveSort(dialog.folderId, foldersById, rootSort)
              : rootSort
          }
          onChoose={(mode) => void handleChooseSort(mode)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      {dialog.kind === 'rename-tag' && (
        <RenameTagDialog
          current={selectedTags[0] ?? ''}
          knownTags={tagTree.map((node) => node.display)}
          onRename={(from, to) => void handleRenameTag(from, to)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      {dialog.kind === 'usage' && (
        <UsageDialog
          usage={usage}
          credits={credits}
          paid={paid}
          notes={notes.length}
          folders={folders.length}
          diagnostics={{
            usedHeap: memory?.usedHeap ?? null,
            heapLimit: memory?.heapLimit ?? null,
            domNodes: memory?.domNodes ?? 0,
            openNoteSessions: memory?.openNoteSessions ?? 0,
            pendingBodies: pendingBodies(notes),
            storage,
          }}
          onRefreshDiagnostics={refreshDiagnostics}
          onMigrateBodies={() => void handleMigrateBodies()}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      {dialog.kind === 'upgrade' && (
        <UpgradeDialog onClose={() => setDialog({ kind: 'none' })} onExport={handleExportAll} />
      )}

      <input
        ref={importRef}
        type="file"
        accept=".md,.markdown,.zip,text/markdown,text/plain,application/zip"
        multiple
        hidden
        onChange={(e) => {
          void handleImportFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {dialog.kind === 'agents' && (
        <AgentsDialog
          folders={folders}
          onClose={() => setDialog({ kind: 'none' })}
          onLink={async (agentUid, folder, role) => {
            await updateFolderSharing(folder, { addMember: { uid: agentUid, role } })
            track('agent_linked', user.uid, { role })
          }}
        />
      )}

      {dialog.kind === 'new-folder' && (
        <InputDialog
          title={
            dialog.parentId
              ? `Nueva subcarpeta en «${folderPath(dialog.parentId, foldersById)}»`
              : 'Nueva carpeta'
          }
          label="Nombre"
          confirmLabel="Crear"
          onConfirm={(name) => void handleNewFolder(name, dialog.parentId)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      {dialog.kind === 'folder-tags' && (
        <InputDialog
          title="Etiquetas de la carpeta"
          label="Separadas por coma o espacio (ej. trabajo, clientes/acme)"
          initialValue={folders.find((f) => f.id === dialog.folderId)?.tags.join(', ') ?? ''}
          confirmLabel="Guardar"
          maxLength={200}
          onConfirm={(value) => void updateFolderTags(dialog.folderId, parseTagInput(value))}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      {dialog.kind === 'rename-folder' && (
        <InputDialog
          title="Renombrar carpeta"
          label="Nombre"
          initialValue={folders.find((f) => f.id === dialog.folderId)?.name ?? ''}
          onConfirm={(name) => void renameFolder(dialog.folderId, name)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}
    </div>
  )
}

export default AppTree
