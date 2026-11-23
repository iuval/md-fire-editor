import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDown, ArrowDownWideNarrow, ArrowUp, Bot, Download, FileDown, FolderPlus, Hash, Link2, LogIn, LogOut, Move, Palette, Pencil, Trash2, Upload } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { SidebarRail } from './components/SidebarRail'
import { PaneBar } from './components/PaneBar'
import { SyncAnnouncer } from './components/SyncAnnouncer'
import { paneBarNeeded } from './lib/paneBar'
import { TabStrip } from './components/TabStrip'
import type { PaneTabDrop } from './components/NotePane'
import type { DropZone, TabDragSource } from './lib/tabDrag'
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
import { UsageDialog } from './components/UsageDialog'
import { ThemeDialog } from './components/ThemeDialog'
import { useAgents, useAuth, useIsAdmin, useWorkspace } from './hooks/useFirebase'
import type { AwarenessUser } from './lib/collab/awareness'
import { download, noteToMarkdown, safeFileName } from './lib/export'
import { buildVault, planVault, streamVaultNotes } from './lib/vault'
import {
  EMPTY_CANVAS_JSON,
  MAX_CANVAS_CHARS,
  canvasTagsOf,
  looksLikeCanvas,
} from './lib/canvas/model'
import type { CanvasFileRef } from './lib/canvas/files'
import { track } from './lib/analytics'
import { currentBrowser, embeddedBrowserHint } from './lib/browser'
import { memoryReport, pendingBodies, storageEstimate, type MemoryReport } from './lib/diagnostics'
import { buildTagTree, extractTags, matchesTagFilter, parseTagInput } from './lib/tags'
import { flattenFolders, folderPath, sharedFolderOf } from './lib/folders'
import { applyOrder, setFolderSort, setRootSort, subscribeUserSettings } from './lib/notes'
import {
  DEFAULT_SORT,
  sortLabel,
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
  moveTabToNewPane,
  moveTabToPane,
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
import { renameAgent } from './lib/agents'
import {
  recordUsage,
  setStorageUsage,
  subscribeCredits,
  subscribeUsage,
  type Credits,
  type UsageTotals,
} from './lib/usage'
import { requestTopUp, updateCreditSettings } from './lib/credits'
import { subscribeAllowance, type ServerAllowance } from './lib/allowance'
import { proxyEnabled, startCheckout } from './lib/proxy'
import { GuestDraftDialog } from './components/GuestDraftDialog'
import { clearGuestDraft, readGuestDraft, isMigratable, guestDraftTitle, type GuestDraft } from './lib/guestDraft'
import { migrateGuestDraft } from './lib/guestMigration'
import { shouldShowGuestView } from './lib/guestMode'
import { flushGuestEvents } from './lib/guestAnalytics'
import {
  LOCAL_UID,
  localStoreSummary,
  migrateLocalStore,
  setLocalMode,
} from './lib/localStore'
import { useT } from './i18n/index.ts'
import type { ProviderStatus, SyncStats } from './lib/collab/provider'
import {
  createFolder,
  createNote,
  fetchNoteBodies,
  importNotes,
  migrateNoteBodies,
  isAclOwner,
  optimisticFolder,
  moveNoteTo,
  noteCanEdit,
  renameFolder,
  reserveNoteId,
  saveNoteContent,
  subscribeNote,
  newNoteDraft,
  subscribeNoteBody,
  updateFolderSharing,
  updateFolderTags,
  updateNoteSharing,
  type Access,
  type Folder,
  type NewNoteInput,
  type Note,
  type NoteKind,
  type Role,
} from './lib/notes'

const ACTIVE_KEY = 'firemd-active'
const SIDEBAR_KEY = 'firemd-sidebar'
const EXPANDED_KEY = 'firemd-folders'
const PANES_KEY = 'firemd-panes'

/** Shown instead of a split action once the pane budget is spent. */
const SPLIT_LIMIT_LABEL = `Máximo de paneles (${MAX_PANES})`

/** Tabs and panes as one tree: a pane is a split node's first child. */
interface WorkspaceState {
  layout: PaneTree
  focusedPaneId: string
}

/** The pane a layout change left focused: the one asked for, else the first. */
function focusedOrFirst(layout: PaneTree, preferred: string): string {
  return findPane(layout, preferred)?.id ?? listPanes(layout)[0].id
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
  | { kind: 'rename-folder'; folderId: string }
  | { kind: 'folder-tags'; folderId: string }
  | { kind: 'agents' }
  | { kind: 'usage' }
  | { kind: 'sort'; folderId: string | null }
  | { kind: 'rename-tag' }
  | { kind: 'theme' }

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
  const t = useT()
  const { user, loading: authLoading, error: authError, doGoogleSignIn, doSignOut } = useAuth()
  const isAdmin = useIsAdmin(user)

  /**
   * The visitor's workspace: the same shell and the same editor as a signed-in
   * session, with localStorage instead of Firestore. A shared-note link still
   * needs a session, so the auth wall stays for that case only.
   */
  const guest = !user && shouldShowGuestView({ hasUser: false, hasSharedNote: noteFromUrl() !== null })
  const uid = user?.uid ?? LOCAL_UID
  /** The uid the workspace subscribes to: local store for a visitor. */
  const workspaceUid = guest ? LOCAL_UID : user?.uid
  /**
   * Who the tree renders for. A visitor is a real session as far as the shell is
   * concerned: same sidebar, same tabs, same panes — only the transport differs.
   * The fallback keeps the signed-in branches from reading `null`.
   */
  const viewer = user ?? { uid: LOCAL_UID, displayName: null, email: null, photoURL: null }
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
  } = useWorkspace(workspaceUid)
  const { agents, error: agentsError } = useAgents(user?.uid)

  /** The local workspace is migrated once per sign-in, not on every auth tick. */
  const guestMigrated = useRef(false)
  // Layout effects run before the data effects below, so the store dispatch is
  // already in place when the first subscription mounts.
  useLayoutEffect(() => setLocalMode(guest), [guest])

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
  /**
   * Every note as the vault path Obsidian would use. `file` cards store that
   * path, so this is what turns `GUIONES/Acto 1.md` into a note id.
   */
  const canvasFiles = useMemo<CanvasFileRef[]>(
    () =>
      notes.map((note) => ({
        id: note.id,
        title: note.title,
        path: `${
          note.folderId ? `${folderPath(note.folderId, foldersById)}/` : ''
        }${safeFileName(note.title || t('app.untitled'))}.md`,
      })),
    [notes, foldersById]
  )

  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  /** The folder that was just created: its row names it in place. */
  const [newFolderId, setNewFolderId] = useState<string | null>(null)
  /**
   * Where the panel's + buttons put new items: the folder you were last working
   * in. Creating a folder makes it the target, so the note you create next
   * lands inside it instead of at the root.
   */
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null)
  /** Names typed while their rename is still in flight, so the row never
   *  falls back to the placeholder name it was created with. */
  const [typedFolderNames, setTypedFolderNames] = useState<Record<string, string>>({})
  const [folderMenu, setFolderMenu] = useState<{ folder: Folder; x: number; y: number } | null>(null)
  /** The row's own menu: the tree is where a file's actions live. */
  const [noteMenu, setNoteMenu] = useState<{ note: Note; x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)
  const [presence, setPresence] = useState<AwarenessUser[]>([])
  const [status, setStatus] = useState<ProviderStatus>({
    connected: false,
    offline: false,
    pendingWrites: 0,
    updateCount: 0,
    error: null as string | null,
  })
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [rootSort, setRootSortState] = useState<SortMode>(DEFAULT_SORT)
  const [notice, setNotice] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageTotals | null>(null)
  const [credits, setCredits] = useState<Credits | null>(null)
  /** Cuota medida por el proxy; null hasta que el proxy escriba la del día. */
  const [serverAllowance, setServerAllowance] = useState<ServerAllowance | null>(null)
  /** A guest draft waiting to be offered after sign-in. */
  const [guestDraft, setGuestDraft] = useState<GuestDraft | null>(null)
  const [guestSaving, setGuestSaving] = useState(false)
  const [guestSaveError, setGuestSaveError] = useState<string | null>(null)
  /** The offer is one-shot per session, even if the auth token refreshes. */
  const guestOffered = useRef(false)
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
   * Where a new item lands: the folder you picked (created, or clicked), else
   * the folder of the note on screen — you are already working there. Null means
   * the root, and also covers a folder that was deleted in the meantime.
   */
  const targetFolder = useMemo(() => {
    const noteFolderId = activeId
      ? (notes.find((note) => note.id === activeId)?.folderId ?? null)
      : null
    const id = targetFolderId ?? noteFolderId
    return id ? (folders.find((folder) => folder.id === id) ?? null) : null
  }, [activeId, folders, notes, targetFolderId])

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

  /**
   * Opening a note also says where you are working: its folder is where the +
   * buttons will put the next note, canvas or folder.
   */
  const openNote = useCallback(
    (id: string) => {
      selectNote(id)
      setTargetFolderId(notes.find((note) => note.id === id)?.folderId ?? null)
    },
    [notes, selectNote]
  )

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!uid) return
    return subscribeUserSettings(uid, (settings) => setRootSortState(settings.rootSort))
  }, [uid])

  // Usage and credits are only read by the usage dialog: subscribe when it
  // opens instead of using two of the startup listeners.
  const usageOpen = dialog.kind === 'usage'
  useEffect(() => {
    if (!user) {
      setUsage(null)
      setCredits(null)
      setServerAllowance(null)
      return
    }
    if (!usageOpen) return
    const offUsage = subscribeUsage(user.uid, setUsage)
    const offCredits = subscribeCredits(user.uid, setCredits)
    const offAllowance = subscribeAllowance(user.uid, setServerAllowance)
    return () => {
      offUsage()
      offCredits()
      offAllowance()
    }
  }, [user, usageOpen])

  const handleStats = useCallback(
    (stats: SyncStats) => {
      if (!user) return
      const previous = lastStats.current
      lastStats.current = stats
      if (!previous) return
      const delta = (next: number, before: number) => Math.max(0, next - before)
      void recordUsage(user.uid, {
        writes:
          delta(stats.blocksWritten, previous.blocksWritten) +
          delta(stats.manifestWrites, previous.manifestWrites) +
          delta(stats.presenceWrites ?? 0, previous.presenceWrites ?? 0),
        reads: delta(stats.blocksApplied, previous.blocksApplied),
        deletes:
          delta(stats.blocksDeleted, previous.blocksDeleted) +
          delta(stats.presenceDeletes ?? 0, previous.presenceDeletes ?? 0),
        bytesWritten: delta(stats.bytesWritten, previous.bytesWritten),
        bytesRead: delta(stats.bytesApplied, previous.bytesApplied),
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
    if (!user) return
    track('app_open', user.uid, { platform: isMobile ? 'mobile' : 'desktop' })
  }, [user, isMobile])

  useEffect(() => {
    if (!user || presence.length === 0) return
    track('collab_session', user.uid, { peers: presence.length })
  }, [user, presence.length])

  // A visitor who signs in brings the workspace with them: the local notes and
  // folders are copied into Firestore once, and the local copy is cleared only
  // after the whole copy succeeds. The single-draft path stays as a fallback for
  // a draft saved before the workspace existed.
  useEffect(() => {
    if (!user) {
      setGuestDraft(null)
      guestOffered.current = false
      guestMigrated.current = false
      return
    }
    flushGuestEvents(user.uid)
    const summary = localStoreSummary()
    if (summary.notes > 0 && !guestMigrated.current) {
      guestMigrated.current = true
      void migrateLocalStore(user.uid, { createFolder, createNote, saveNoteContent })
        .then(({ notes: migratedNotes, folders: migratedFolders }) =>
          setNotice(
            t('guest.storeSaved', { notes: migratedNotes, folders: migratedFolders })
          )
        )
        .catch(() => setNotice(t('guest.storeSaveFailed')))
      return
    }
    if (guestOffered.current) return
    guestOffered.current = true
    const draft = readGuestDraft()
    if (isMigratable(draft)) setGuestDraft(draft)
  }, [user, t])

  // Only *visible* notes cost a subscription, and it is a body subscription: the
  // metadata already arrives with the workspace list, so a tab no longer holds a
  // second copy of the note document.
  const openIdsKey = activeNoteIds(layout)
    .filter((id) => !pendingNotes.has(id))
    .join('|')
  /** Every open note id, including the ones still being created. */
  const allOpenIdsKey = activeNoteIds(layout).join('|')
  useEffect(() => {
    if (!uid) {
      setBodies({})
      setNotesById({})
      setNoteErrors({})
      return
    }
    const ids = openIdsKey ? openIdsKey.split('|') : []
    // Keep the optimistic body of a note that is still being created: dropping
    // it would put the pane back to "Cargando…" right after it opened.
    const keep = allOpenIdsKey ? allOpenIdsKey.split('|') : []
    setBodies((prev) => keepIds(prev, keep))
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
  }, [openIdsKey, allOpenIdsKey, uid])

  /**
   * A note the list has never seen — a `?note=` deep link, or one just created
   * in another tab — still needs its metadata. This is the only place a whole
   * note document is subscribed, and only while the list does not know it.
   */
  const orphanIdsKey = activeNoteIds(layout)
    .filter((id) => !pendingNotes.has(id) && !notesByIdFromList.has(id))
    .join('|')
  /** Drafts of notes still being written are pruned by their own lifetime. */
  const pendingKey = Array.from(pendingNotes).join('|')
  useEffect(() => {
    if (!uid) return
    const ids = orphanIdsKey ? orphanIdsKey.split('|') : []
    const pendingIds = pendingKey ? pendingKey.split('|') : []
    setNotesById((prev) => keepIds(prev, [...ids, ...pendingIds]))
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
            return id in prev ? prev : { ...prev, [id]: t('app.noAccess') }
          })
        },
        (message) => setNoteErrors((prev) => ({ ...prev, [id]: message }))
      )
    )
    return () => offs.forEach((off) => off())
  }, [orphanIdsKey, pendingKey, uid])

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


  const handleSaveGuestDraft = useCallback(async () => {
    if (!user || !guestDraft) return
    setGuestSaving(true)
    setGuestSaveError(null)
    try {
      const noteId = await migrateGuestDraft(user.uid, guestDraft)
      clearGuestDraft()
      setGuestDraft(null)
      setNotice(t('guest.saved'))
      setWorkspace((current) => ({
        layout: openTab(current.layout, focusedPaneId, noteId, newId('tab')),
        focusedPaneId,
      }))
      track('guest_draft_saved', user.uid, { source: 'migration' })
    } catch {
      setGuestSaveError(t('guest.saveFailed'))
    } finally {
      setGuestSaving(false)
    }
  }, [user, guestDraft, focusedPaneId, t])

  const handleDiscardGuestDraft = useCallback(() => {
    clearGuestDraft()
    setGuestDraft(null)
    setGuestSaveError(null)
  }, [])

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
      if (note.kind === 'canvas') {
        // The JSON is the file: no title heading, no reformatting.
        download(markdown, `${safeFileName(note.title)}.canvas`, 'application/x-obsidian-canvas')
        track('export', user?.uid, { kind: 'canvas' })
        return
      }
      download(noteToMarkdown({ ...note, markdown }), `${safeFileName(note.title)}.md`, 'text/markdown')
      track('export', user?.uid, { kind: 'md' })
    },
    [user?.uid]
  )

  const handleImportFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !uid) return
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
        const { created, failed } = await importNotes(uid, pending, {
          onProgress: (done) => setNotice(`Importando… ${imported + done} notas`),
        })
        imported += created.length
        if (failed > 0) failedNotes += failed
        if (!first && created.length > 0) first = created[0]
      }

      const pushNote = async (
        title: string,
        markdown: string,
        folderName: string | null,
        kind: NoteKind = 'note'
      ) => {
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
          markdown: markdown.slice(0, kind === 'canvas' ? MAX_CANVAS_CHARS : 250_000),
          // A canvas has no frontmatter: its tags come from the cards.
          tags: kind === 'canvas' ? canvasTagsOf(markdown) : extractTags(markdown),
          folder: folder ?? null,
          ...(kind === 'canvas' ? { kind } : {}),
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
            await pushNote(entry.title, entry.markdown, entry.folder, entry.kind ?? 'note')
          }
          skippedAttachments += plan.skipped.filter((s) => s.reason === 'attachment').length
          skippedJunk += plan.skipped.filter((s) => s.reason === 'junk').length
          skippedLarge += plan.skipped.filter((s) => s.reason === 'too-large').length
          continue
        }

        const text = await file.text()
        if (/\.canvas$/i.test(file.name)) {
          if (!looksLikeCanvas(text)) {
            failedNotes++
            continue
          }
          await pushNote(file.name.replace(/\.canvas$/i, '').slice(0, 300), text, null, 'canvas')
          continue
        }
        const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
        await pushNote((heading || file.name.replace(/\.md$/i, '')).slice(0, 300), text, null)
      }

      await flush()
      track('import', uid, { count: imported })
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
    [addFolder, folders, selectNote, uid]
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

  /**
   * A tab dropped between two tabs of a strip — including its own, which is how
   * a drag reorders them. The pane under the pointer takes the focus, because it
   * now holds the tab you were just using.
   */
  const dropTabAt = useCallback((source: TabDragSource, paneId: string, index: number) => {
    setWorkspace((ws) => {
      const layout = moveTabToPane(ws.layout, source, paneId, index)
      if (layout === ws.layout) return ws
      return { layout, focusedPaneId: focusedOrFirst(layout, paneId) }
    })
  }, [])

  /**
   * A tab dropped on a pane's body: the centre moves it in, a side splits the
   * pane and leaves the tab alone in the new half.
   */
  const dropTabOnZone = useCallback((source: TabDragSource, paneId: string, zone: DropZone) => {
    setWorkspace((ws) => {
      if (zone === 'center') {
        const layout = moveTabToPane(ws.layout, source, paneId)
        if (layout === ws.layout) return ws
        return { layout, focusedPaneId: focusedOrFirst(layout, paneId) }
      }
      // Every pane holds an editor: a split has to fit the same budget the
      // split buttons respect.
      if (!canSplit(ws.layout)) return ws
      const ids = { paneId: newId('pane'), splitId: newId('split') }
      const layout = moveTabToNewPane(ws.layout, source, paneId, zone, ids)
      if (layout === ws.layout) return ws
      return { layout, focusedPaneId: focusedOrFirst(layout, ids.paneId) }
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
      if (!uid || dialog.kind !== 'sort') return
      if (dialog.folderId) await setFolderSort(dialog.folderId, mode)
      else {
        setRootSortState(mode)
        await setRootSort(uid, mode)
      }
    },
    [dialog, uid]
  )

  /** Moves a note one position inside its folder (manual order only). */
  const handleMoveNote = useCallback(
    async (note: Note, direction: -1 | 1) => {
      if (!uid) return
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
    [foldersById, notes, rootSort, uid]
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
      if (!uid) return
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
      track('note_shared', uid, { kind: 'tag-rename' })
    },
    [notes, uid]
  )

  const toggleFolder = useCallback((id: string) => {
    // Opening a folder is how you say "I am working here": new items follow.
    setTargetFolderId(id)
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
    async (folder?: Folder, paneId?: string, kind: NoteKind = 'note') => {
      const noteId = reserveNoteId()
      const target = paneId && findPane(layout, paneId) ? paneId : focusedPaneId

      if (!noteId) {
        // Firebase unavailable: fall back to the blocking path.
        const note = await addNote(folder, undefined, kind)
        if (!note) return
        if (folder) setExpanded((prev) => new Set(prev).add(folder.id))
        track('note_created', user?.uid, { folder: folder ? 'yes' : 'root', kind })
        setWorkspace((ws) => ({
          layout: openTab(ws.layout, target, note.id, newId('tab')),
          focusedPaneId: target,
        }))
        if (isMobile) setSidebarOpen(false)
        return
      }

      const tabId = newId('tab')
      // Everything the first frame needs is local: the tab, a note with the
      // fields the write will produce, and an empty body. The Firestore write
      // and the body subscription happen behind the open page.
      if (uid) {
        const draft = newNoteDraft(uid, folder, noteId, kind)
        setNotesById((prev) => ({ ...prev, [noteId]: draft }))
        // Same body `createNote` writes: a new canvas is a valid empty canvas.
        setBodies((prev) => ({ ...prev, [noteId]: kind === 'canvas' ? EMPTY_CANVAS_JSON : '' }))
      }
      setPendingNotes((prev) => new Set(prev).add(noteId))
      setWorkspace((ws) => ({
        layout: openTab(ws.layout, target, noteId, tabId),
        focusedPaneId: target,
      }))
      if (folder) setExpanded((prev) => new Set(prev).add(folder.id))
      if (isMobile) setSidebarOpen(false)

      try {
        const note = await addNote(folder, noteId, kind)
        if (!note) throw new Error('no note')
        track('note_created', user?.uid, { folder: folder ? 'yes' : 'root', kind })
        // Show the editor now instead of waiting for another snapshot round trip.
        setNotesById((prev) => ({ ...prev, [noteId]: note }))
      } catch {
        setNotesById((prev) => {
          if (!(noteId in prev)) return prev
          const next = { ...prev }
          delete next[noteId]
          return next
        })
        setBodies((prev) => {
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
    [addNote, focusedPaneId, isMobile, layout, uid]
  )

  /** Obsidian's "New canvas": an empty JSON Canvas document in a new tab. */
  const handleNewCanvas = useCallback(
    (folder?: Folder) => {
      void handleNewNote(folder, undefined, 'canvas')
    },
    [handleNewNote]
  )

  /**
   * The visitor's first frame: a blank note with the caret in it, plus the
   * "Welcome to FireMD" note that says what this is.
   *
   * A note taker first: the first thing on screen is a page waiting for the first
   * keystroke, not a brochure. Both are real notes in the local store, so the
   * visitor can type, keep them, delete the welcome one, and the whole workspace
   * travels to the account on sign-in. Seeded once per browser, so a returning
   * visitor gets their own notes back.
   */
  const guestSeeded = useRef(false)
  useEffect(() => {
    if (!guest || guestSeeded.current) return
    guestSeeded.current = true
    if (localStoreSummary().notes > 0) return
    void (async () => {
      try {
        const welcome = await createNote(LOCAL_UID)
        await saveNoteContent(welcome.id, {
          title: t('guest.welcomeTitle'),
          markdown: t('guest.welcomeBody'),
        })
        setWorkspace((ws) => ({
          layout: openTab(ws.layout, ws.focusedPaneId, welcome.id, newId('tab')),
          focusedPaneId: ws.focusedPaneId,
        }))
        // The blank note goes through the app's own "new note" path: it opens
        // on top with the caret in its title, exactly like pressing + does.
        await handleNewNote()
      } catch {
        // A failed seed leaves the empty workspace; the visitor can create a note.
      }
    })()
  }, [guest, handleNewNote, t])

  /**
   * Creates a folder on the first frame, under the parent it belongs to.
   *
   * No dialog: the row appears with an empty name and an input already focused,
   * so the button press *is* the first keystroke. The id is reserved on the
   * client and the row is shown immediately; the write and its snapshot used to
   * be two round trips with nothing on screen. If the write fails, the row
   * disappears and the user is told.
   */
  const handleNewFolder = useCallback(
    async (parentId: string | null = null) => {
      // The name is typed in the panel: a collapsed panel has to come back first.
      if (!isMobile && collapsed) {
        setCollapsed(false)
        try {
          localStorage.setItem(SIDEBAR_KEY, 'expanded')
        } catch {
          /* ignore */
        }
      }
      const inherited = parentId ? resolveSort(parentId, foldersById, rootSort) : rootSort
      const siblings = folders.filter((f) => (f.parentId ?? null) === parentId)
      const options = { sort: inherited, order: nextOrder(siblings) }
      const id = reserveFolderId()
      const optimistic = id && uid ? optimisticFolder(uid, id, '', parentId, options) : null
      if (optimistic) {
        addOptimisticFolder(optimistic)
        setNewFolderId(optimistic.id)
        setTargetFolderId(optimistic.id)
      }
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId))

      let folder: Folder | null = null
      try {
        folder = await addFolder('', parentId, options, id ?? undefined)
      } catch {
        folder = null
      }
      if (!folder) {
        if (optimistic) {
          const failedId = optimistic.id
          dropOptimisticFolder(failedId)
          setNewFolderId((current) => (current === failedId ? null : current))
        }
        setNotice('No se pudo crear la carpeta. Revisá la conexión.')
        return null
      }
      // Without a reserved id the row only exists now.
      if (!optimistic) {
        setNewFolderId(folder.id)
        setTargetFolderId(folder.id)
      }
      setExpanded((prev) => new Set(prev).add(folder.id))
      return folder
    },
    [
      addFolder,
      addOptimisticFolder,
      collapsed,
      dropOptimisticFolder,
      folders,
      foldersById,
      isMobile,
      reserveFolderId,
      rootSort,
      uid,
    ]
  )

  /** The new folder's row closed: keep the typed name, or the placeholder. */
  const commitNewFolderName = useCallback(
    (folderId: string, name: string) => {
      setNewFolderId((current) => (current === folderId ? null : current))
      const clean = name.trim()
      if (!clean) return
      // Shown right away: the rename is a round trip and the row would otherwise
      // fall back to the placeholder name it was created with.
      setTypedFolderNames((prev) => ({ ...prev, [folderId]: clean }))
      void renameFolder(folderId, clean)
    },
    []
  )

  const cancelNewFolderName = useCallback((folderId: string) => {
    setNewFolderId((current) => (current === folderId ? null : current))
  }, [])

  /**
   * A typed name stops counting the moment the document agrees with it, so the
   * row follows the folder again (an agent renaming it, another device).
   */
  const folderNameOverrides = useMemo(() => {
    const next: Record<string, string> = {}
    for (const [id, name] of Object.entries(typedFolderNames)) {
      const folder = folders.find((candidate) => candidate.id === id)
      if (!folder || folder.name !== name) next[id] = name
    }
    return next
  }, [folders, typedFolderNames])

  const handleDeleteNote = useCallback(
    async (note: Note) => {
      if (!window.confirm(t('note.deleteConfirm', { title: note.title || t('app.untitled') }))) return
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
        const owner = note.ownerId === viewer.uid
        const inherited = sharedFolderOf(note, folders)
        // Sharing needs a cloud account: a visitor's note lives in this browser.
        const canManageShare = owner && note.aclSource === 'own' && !guest
        const items: MenuItem[] = []
        if (canManageShare || inherited) {
          items.push({
            label: inherited ? 'Permisos de la carpeta…' : 'Compartir…',
            icon: <Link2 size={14} />,
            onSelect: () =>
              setDialog(
                inherited
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
          onSelect: () => {
            setTargetFolderId(folderMenu!.folder.id)
            void handleNewNote(folderMenu!.folder)
          },
        },
        {
          label: 'Nueva subcarpeta…',
          icon: <FolderPlus size={14} />,
          onSelect: () => void handleNewFolder(folderMenu!.folder.id),
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
          label: `${t('menu.sortOrder')}: ${sortLabel(folderMenu.folder.sort ?? resolveSort(folderMenu.folder.parentId ?? null, foldersById, rootSort))}…`,
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
                  setDialog({ kind: 'share-folder', folderId: folderMenu!.folder.id }),
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
  const titles = useMemo(() => {
    // The workspace list is the live source; a note created in this session is
    // not in it yet, and its tab must still have a name on the first frame.
    const map = new Map(notes.map((note) => [note.id, note.title]))
    for (const [id, note] of Object.entries(notesById)) {
      if (!map.has(id)) map.set(id, note.title)
    }
    return map
  }, [notes, notesById])

  /**
   * Rename from the tab strip. The title is one field on the note document, so a
   * rename from a tab and a rename from the pane land in the same place; the row
   * reads the live list, and the strip follows it without local state.
   */
  const renameNote = useCallback(
    (noteId: string, title: string) => {
      const note = notesByIdFromList.get(noteId) ?? notesById[noteId]
      const next = title.trim()
      if (!note || !next || next === note.title) return
      // A note still being created has no document to write to yet.
      if (pendingNotes.has(noteId)) return
      if (!noteCanEdit(note, folders, user?.uid)) {
        setNotice('No tenés permiso para renombrar esta nota.')
        return
      }
      void saveNoteContent(noteId, { title: next }).catch(() =>
        setNotice('No se pudo renombrar la nota. Revisá la conexión.')
      )
    },
    [folders, notesById, notesByIdFromList, pendingNotes, user?.uid]
  )

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
      paneId={inlinePane.id}
      tabs={inlinePane.tabs.map((tab) => ({ id: tab.id, title: titles.get(tab.noteId) ?? '' }))}
      activeTabId={inlinePane.activeTabId}
      onDropTab={isMobile ? undefined : (source, index) => dropTabAt(source, inlinePane.id, index)}
      onActivate={(tabId) => activateTab(inlinePane.id, tabId)}
      onClose={(tabId) => closePaneTab(inlinePane.id, tabId)}
      onNewNote={() => void handleNewNote(targetFolder ?? undefined, inlinePane.id)}
      onRename={(tabId, title) => {
        const tab = inlinePane.tabs.find((candidate) => candidate.id === tabId)
        if (tab) renameNote(tab.noteId, title)
      }}
      {...splitActions(inlinePane.id)}
    />
  ) : undefined

  // No tabs to host, no filter, nobody else editing: the panes start at the
  // top of the window (see `paneBarNeeded`).
  const barNeeded = paneBarNeeded({
    hasTabs: Boolean(inlineTabs),
    isMobile,
    selectedTags: selectedTags.length,
    presence: presence.length,
  })

  /**
   * The account menu. A visitor gets the same export, import and appearance as
   * anyone else — those work on the local store — plus the sign-in button where
   * a session would have "sign out". Nothing that needs a server is offered.
   */
  const accountMenuItems: MenuItem[] = guest
    ? [
        {
          label: t('guest.signIn'),
          icon: <LogIn size={14} />,
          onSelect: () => {
            setDialog({ kind: 'none' })
            void doGoogleSignIn()
          },
        },
        {
          label: 'Exportar vault (.zip)',
          icon: <Download size={14} />,
          onSelect: handleExportAll,
          separatorBefore: true,
        },
        {
          label: 'Importar vault (.zip o .md)…',
          icon: <Upload size={14} />,
          onSelect: () => importRef.current?.click(),
        },
        {
          label: 'Apariencia…',
          icon: <Palette size={14} />,
          onSelect: () => setDialog({ kind: 'theme' }),
          separatorBefore: true,
        },
        {
          label: `${t('menu.listOrder')}: ${sortLabel(rootSort)}…`,
          icon: <ArrowDownWideNarrow size={14} />,
          onSelect: () => setDialog({ kind: 'sort', folderId: null }),
        },
      ]
    : [
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
          label: 'Agentes de IA…',
          icon: <Bot size={14} />,
          onSelect: () => setDialog({ kind: 'agents' }),
          separatorBefore: true,
        },
        {
          label: 'Apariencia…',
          icon: <Palette size={14} />,
          onSelect: () => setDialog({ kind: 'theme' }),
          separatorBefore: true,
        },
        {
          label: `${t('menu.listOrder')}: ${sortLabel(rootSort)}…`,
          icon: <ArrowDownWideNarrow size={14} />,
          onSelect: () => setDialog({ kind: 'sort', folderId: null }),
        },
        {
          label: 'Cerrar sesión',
          icon: <LogOut size={14} />,
          separatorBefore: true,
          onSelect: () => void handleSignOut(),
        },
      ]

  if (authLoading) return <div className="empty">{t('app.loading')}</div>

  // A visitor without a session falls through to the real tree below: same
  // sidebar, same tabs, same panes, same editor, backed by the local store. The
  // auth wall stays for a shared-note link, which has no access without a
  // session.
  if (!user && !guest) {
    const browser = currentBrowser()
    const appUrl = typeof window !== 'undefined' ? window.location.origin : ''

    return (
      <div className="auth">
        <div className="auth-panel">
          <span className="auth-wordmark">
            <img className="auth-mark" src="/favicon.svg" alt="" width={20} height={20} />
            FireMD
          </span>
          <h1 className="auth-title">{t('auth.title')}</h1>
          <p className="auth-sub">
            {t('auth.subtitleBefore')}
            <code>.md</code>
            {t('auth.subtitleAfter')}
          </p>
          <button className="btn auth-btn" onClick={() => void doGoogleSignIn()}>
            {t('auth.signIn')}
          </button>

        {browser.embedded && (
          <div className="share-hint-box" style={{ maxWidth: 380, textAlign: 'left' }}>
            <strong>{t('auth.embeddedTitle')}</strong>
            <br />
            {embeddedBrowserHint(browser.reason)}
            <br />
            {t('auth.embeddedOpenIn')}
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

      {/* The panel's collapsed face. Always mounted on desktop: the open panel
          covers it, so the shell's width never jumps on collapse. */}
      {!isMobile && (
        <SidebarRail
          collapsed={collapsed}
          onExpand={toggleSidebar}
          onNewNote={() => void handleNewNote(targetFolder ?? undefined)}
          onNewFolder={() => void handleNewFolder(targetFolder?.id ?? null)}
          onNewCanvas={() => handleNewCanvas(targetFolder ?? undefined)}
          onAccountClick={() => setDialog({ kind: 'account-menu' })}
        />
      )}

      <Sidebar
        notes={visibleNotes}
        folders={folders}
        activeId={activeId}
        onSelect={(id) => {
          setPresence([])
          openNote(id)
          setSidebarOpen(false)
        }}
        onNewNote={() => void handleNewNote(targetFolder ?? undefined)}
        onNewFolder={() => void handleNewFolder(targetFolder?.id ?? null)}
        onNewCanvas={() => handleNewCanvas(targetFolder ?? undefined)}
        onNoteMenu={(note, pos) => setNoteMenu({ note, ...pos })}
        rootSort={rootSort}
        editingFolderId={newFolderId}
        targetFolderId={targetFolder?.id ?? null}
        nameOverrides={folderNameOverrides}
        onFolderNameCommit={commitNewFolderName}
        onFolderNameCancel={cancelNewFolderName}
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
        uid={viewer.uid}
        userName={userName}
        photoURL={viewer.photoURL}
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
                {t('app.loadingEditor')}
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
                uid={viewer.uid}
                userName={userName || 'Alguien'}
                folders={folders}
                isMobile={isMobile}
                canvasFiles={canvasFiles}
                onOpenNote={openNote}
                onFocus={() => focusPane(pane.id)}
                onActivateTab={(tabId) => activateTab(pane.id, tabId)}
                onCloseTab={(tabId) => closePaneTab(pane.id, tabId)}
                onNewNote={() => void handleNewNote(targetFolder ?? undefined, pane.id)}
                onRenameNote={renameNote}
                onClosePane={panes.length > 1 ? () => closePaneAt(pane.id) : undefined}
                hideTabs={pane.id === inlinePane?.id}
                tabDrop={
                  isMobile
                    ? undefined
                    : ({
                        onDropAt: (source, index) => dropTabAt(source, pane.id, index),
                        onDropZone: (source, zone) => dropTabOnZone(source, pane.id, zone),
                        canSplit: splitAllowed,
                      } satisfies PaneTabDrop)
                }
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

      {folderMenu && (
        <Menu
          items={folderMenuItems}
          anchor="pointer"
          pos={{ x: folderMenu.x, y: folderMenu.y }}
          onClose={() => setFolderMenu(null)}
        />
      )}

      {dialog.kind === 'theme' && <ThemeDialog onClose={() => setDialog({ kind: 'none' })} />}

      {dialog.kind === 'account-menu' && (
        <>
          <div
            className="scrim"
            style={{ background: 'transparent' }}
            onClick={() => setDialog({ kind: 'none' })}
          />
          <Menu
            items={accountMenuItems}
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
          currentUid={viewer.uid}
          onClose={() => setDialog({ kind: 'none' })}
          onChangeAccess={(access: Access) => {
            track('note_shared', viewer.uid, { kind: 'note', access })
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
          currentUid={viewer.uid}
          onClose={() => setDialog({ kind: 'none' })}
          onChangeAccess={(access: Access) => {
            track('note_shared', viewer.uid, { kind: 'folder', access })
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

      {guestDraft && (
        <GuestDraftDialog
          title={guestDraftTitle(guestDraft)}
          busy={guestSaving}
          error={guestSaveError}
          onSave={() => void handleSaveGuestDraft()}
          onDiscard={handleDiscardGuestDraft}
          onClose={() => setGuestDraft(null)}
        />
      )}

      {dialog.kind === 'usage' && (
        <UsageDialog
          usage={usage}
          credits={credits}
          serverAllowance={serverAllowance}
          isAdmin={isAdmin}
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
          onUpdateCredits={async (settings) => {
            if (user) await updateCreditSettings(user.uid, settings)
          }}
          onRequestTopUp={async (amountUsd) => {
            // Con el proxy, cargar saldo es una sesión de checkout del MoR: el
            // saldo se acredita cuando el webhook firmado confirma el pago.
            if (proxyEnabled) {
              const session = await startCheckout(amountUsd)
              location.assign(session.url)
              return
            }
            if (user) await requestTopUp(user.uid, amountUsd)
          }}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      <input
        ref={importRef}
        type="file"
        accept=".md,.markdown,.canvas,.zip,text/markdown,text/plain,application/zip,application/x-obsidian-canvas"
        multiple
        hidden
        onChange={(e) => {
          void handleImportFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {dialog.kind === 'agents' && (
        <AgentsDialog
          agents={agents}
          error={agentsError}
          folders={folders}
          onClose={() => setDialog({ kind: 'none' })}
          onRename={renameAgent}
          onLink={async (agentUid, folder, role) => {
            await updateFolderSharing(folder, { addMember: { uid: agentUid, role } })
            track('agent_linked', viewer.uid, { role })
          }}
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
