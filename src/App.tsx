import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDown, ArrowDownWideNarrow, ArrowUp, Bot, Columns2, Download, FileDown, FolderPlus, Hash, Link2, LogOut, Move, Pencil, Plus, Rows2, Trash2, Upload, X } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { PaneBar } from './components/PaneBar'
import { Menu, type MenuItem } from './components/Menu'
import { NotePane } from './components/NotePane'
import { Workspace } from './components/Workspace'
import { ShareDialog } from './components/ShareDialog'
import { MoveDialog } from './components/MoveDialog'
import { InputDialog } from './components/InputDialog'
import { AgentsDialog } from './components/AgentsDialog'
import { UpgradeDialog } from './components/UpgradeDialog'
import { UsageDialog } from './components/UsageDialog'
import { useAuth, useWorkspace } from './hooks/useFirebase'
import type { AwarenessUser } from './lib/collab/awareness'
import { download, noteToMarkdown, safeFileName } from './lib/export'
import { buildVault, readVault } from './lib/vault'
import { track } from './lib/analytics'
import { currentBrowser, embeddedBrowserHint } from './lib/browser'
import { buildTagTree, extractTags, matchesTagFilter, parseTagInput } from './lib/tags'
import { flattenFolders, folderPath, sharedFolderOf } from './lib/folders'
import { applyOrder, setFolderSort, setRootSort, subscribeUserSettings } from './lib/notes'
import { DEFAULT_SORT, nextOrder, renumbered, resolveSort, sortFolders, sortNotes, SORT_LABELS, type SortMode } from './lib/sorting'
import { SortDialog } from './components/SortDialog'
import { MAX_FOLDER_DEPTH } from './lib/folders'
import {
  activeNoteId,
  activeNoteIds,
  activeTab,
  closeOtherTabs,
  closePane,
  closeTab,
  findNote,
  findPane,
  listPanes,
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
  isAclOwner,
  moveNoteTo,
  renameFolder,
  saveNoteContent,
  subscribeNote,
  updateFolderSharing,
  updateFolderTags,
  updateNoteSharing,
  type Access,
  type Folder,
  type Note,
  type Role,
} from './lib/notes'

const ACTIVE_KEY = 'mdfire-active'
const SIDEBAR_KEY = 'mdfire-sidebar'
const EXPANDED_KEY = 'mdfire-folders'
const PANES_KEY = 'mdfire-panes'

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
  | { kind: 'note-menu' }
  | { kind: 'account-menu' }
  | { kind: 'share-note' }
  | { kind: 'share-folder'; folderId: string }
  | { kind: 'move' }
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

function App() {
  const { user, loading: authLoading, error: authError, doGoogleSignIn, doSignOut } = useAuth()
  const {
    notes,
    folders,
    loading: dataLoading,
    addNote,
    addFolder,
    removeNote,
    removeFolder,
  } = useWorkspace(user?.uid)

  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace)
  const { layout, focusedPaneId } = workspace
  const focusedPane = findPane(layout, focusedPaneId)
  /** The focused pane's current tab is what every menu and dialog acts on. */
  const activeId = focusedPane ? (activeTab(focusedPane)?.noteId ?? null) : null
  const [notesById, setNotesById] = useState<Record<string, Note>>({})
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({})
  const activeNote = activeId ? (notesById[activeId] ?? null) : null
  const foldersById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [folderMenu, setFolderMenu] = useState<{ folder: Folder; x: number; y: number } | null>(null)
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null)
  const [tabMenu, setTabMenu] = useState<
    { paneId: string; tabId: string | null; x: number; y: number } | null
  >(null)
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
  const lastStats = useRef<SyncStats | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (!user) {
      setUsage(null)
      setCredits(null)
      return
    }
    const offUsage = subscribeUsage(user.uid, setUsage)
    const offCredits = subscribeCredits(user.uid, setCredits)
    return () => {
      offUsage()
      offCredits()
    }
  }, [user])

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

  useEffect(() => {
    if (!user) return
    const storage = notes.reduce((sum, note) => sum + (note.markdown?.length ?? 0), 0)
    void setStorageUsage(user.uid, storage).catch(() => undefined)
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

  // One subscription per *visible* note: inactive tabs read their title from the
  // workspace list instead of keeping a document (and a Yjs session) open.
  const openIdsKey = activeNoteIds(layout).join('|')
  useEffect(() => {
    if (!user) {
      setNotesById({})
      setNoteErrors({})
      return
    }
    const ids = openIdsKey ? openIdsKey.split('|') : []
    setNotesById((prev) => keepIds(prev, ids))
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
            if (note) {
              if (!(id in prev)) return prev
              const next = { ...prev }
              delete next[id]
              return next
            }
            return id in prev ? prev : { ...prev, [id]: 'La nota no existe o no tenés acceso.' }
          })
        },
        (message) => setNoteErrors((prev) => ({ ...prev, [id]: message }))
      )
    )
    return () => offs.forEach((off) => off())
  }, [openIdsKey, user])

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

  const noteOwner = !!user && !!activeNote && activeNote.ownerId === user.uid

  const handleExportAll = useCallback(() => {
    if (notes.length === 0) return
    const vault = buildVault(notes, folders)
    download(vault.bytes, vault.fileName, 'application/zip')
    setNotice(`Exportadas ${vault.notes} notas en ${vault.fileName} (listo para abrir en Obsidian).`)
    track('export', user?.uid, { kind: 'vault' })
  }, [notes, folders, user?.uid])

  const handleExportNote = useCallback(() => {
    if (!activeNote) return
    download(noteToMarkdown(activeNote), `${safeFileName(activeNote.title)}.md`, 'text/markdown')
    track('export', user?.uid, { kind: 'md' })
  }, [activeNote, user?.uid])

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
      let first: string | null = null
      let imported = 0
      let skippedAttachments = 0
      let skippedJunk = 0
      let skippedLarge = 0

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
        const note = await addNote(folder)
        if (!note) return
        await saveNoteContent(note.id, {
          title,
          markdown: markdown.slice(0, 250_000),
          tags: extractTags(markdown),
          version: 1,
        })
        imported++
        if (!first) first = note.id
      }

      for (const file of list) {
        if (/\.zip$/i.test(file.name)) {
          const vault = await readVault(new Uint8Array(await file.arrayBuffer()))
          for (const entry of vault.entries) {
            await pushNote(entry.title, entry.markdown, entry.folder)
          }
          skippedAttachments += vault.skipped.filter((s) => s.reason === 'attachment').length
          skippedJunk += vault.skipped.filter((s) => s.reason === 'junk').length
          skippedLarge += vault.skipped.filter((s) => s.reason === 'too-large').length
          continue
        }

        const text = await file.text()
        const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
        await pushNote((heading || file.name.replace(/\.md$/i, '')).slice(0, 300), text, null)
      }

      track('import', user.uid, { count: imported })
      const details: string[] = []
      if (skippedJunk > 0) details.push(`${skippedJunk} archivos de sistema de macOS`)
      if (skippedAttachments > 0) details.push(`${skippedAttachments} adjuntos (todavía no se guardan imágenes)`)
      if (skippedLarge > 0) details.push(`${skippedLarge} notas de más de 250 KB`)
      setNotice(
        details.length > 0
          ? `Importadas ${imported} notas. Omitidos: ${details.join(', ')}.`
          : `Importadas ${imported} notas.`
      )
      if (first) selectNote(first)
    },
    [addFolder, addNote, folders, selectNote, user]
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

  const closeSiblingTabs = useCallback((paneId: string, tabId: string) => {
    setWorkspace((ws) => {
      const layout = closeOtherTabs(ws.layout, paneId, tabId)
      return layout === ws.layout ? ws : { ...ws, layout }
    })
  }, [])

  /**
   * Splits a pane and focuses the new half, which opens with a copy of the page
   * you were reading: the next file click replaces it there.
   */
  const splitPaneAt = useCallback((paneId: string, direction: SplitDirection) => {
    setWorkspace((ws) => {
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
    async (direction: -1 | 1) => {
      if (!activeNote || !user) return
      const parentId = activeNote.folderId ?? null
      const mode = resolveSort(parentId, foldersById, rootSort)
      if (mode !== 'manual') {
        setNotice('Poné el orden de la carpeta en «Manual» para mover notas.')
        return
      }
      const siblings = sortNotes(notes.filter((n) => (n.folderId ?? null) === parentId), 'manual')
      const index = siblings.findIndex((n) => n.id === activeNote.id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= siblings.length) return
      const ids = siblings.map((n) => n.id)
      ;[ids[index], ids[target]] = [ids[target], ids[index]]
      await applyOrder('notes', renumbered(ids))
    },
    [activeNote, foldersById, notes, rootSort, user]
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
      const index = siblings.findIndex((f) => f.id === folder.id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= siblings.length) return
      const ids = siblings.map((f) => f.id)
      ;[ids[index], ids[target]] = [ids[target], ids[index]]
      await applyOrder('folders', renumbered(ids))
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
      let changed = 0
      for (const note of affected) {
        const pattern = new RegExp(`#${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w/.-])`, 'gi')
        let next = (note.markdown ?? '').replace(pattern, `#${target}`)
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
        if (next === note.markdown) continue
        await saveNoteContent(note.id, {
          markdown: next,
          tags: extractTags(next),
          version: note.version + 1,
        })
        changed++
      }
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

  /** New notes open in their own tab, so they never replace a file you have open. */
  const handleNewNote = useCallback(
    async (folder?: Folder, paneId?: string) => {
      const note = await addNote(folder)
      if (!note) return
      if (folder) setExpanded((prev) => new Set(prev).add(folder.id))
      track('note_created', user?.uid, { folder: folder ? 'yes' : 'root' })
      setWorkspace((ws) => {
        const target = paneId && findPane(ws.layout, paneId) ? paneId : ws.focusedPaneId
        return { layout: openTab(ws.layout, target, note.id, newId('tab')), focusedPaneId: target }
      })
      if (isMobile) setSidebarOpen(false)
    },
    [addNote, isMobile]
  )

  const handleNewFolder = useCallback(
    async (name: string, parentId: string | null = null) => {
      const inherited = parentId ? resolveSort(parentId, foldersById, rootSort) : rootSort
      const siblings = folders.filter((f) => (f.parentId ?? null) === parentId)
      const folder = await addFolder(name, parentId, {
        sort: inherited,
        order: nextOrder(siblings),
      })
      if (folder) {
        setExpanded((prev) => new Set(prev).add(folder.id))
        if (parentId) setExpanded((prev) => new Set(prev).add(parentId))
      }
      return folder
    },
    [addFolder, folders, foldersById, rootSort]
  )

  const handleDeleteNote = useCallback(async () => {
    if (!activeNote) return
    if (!window.confirm(`¿Eliminar "${activeNote.title || 'Sin título'}"?`)) return
    await removeNote(activeNote.id)
    selectNote(null)
  }, [activeNote, removeNote, selectNote])

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

  const sharedFolder = activeNote ? sharedFolderOf(activeNote, folders) : null
  const canManageNoteShare = noteOwner && activeNote?.aclSource === 'own'
  const shareFolderTarget =
    dialog.kind === 'share-folder' ? folders.find((f) => f.id === dialog.folderId) : undefined

  const noteMenu: MenuItem[] = []
  if (activeNote) {
    if (canManageNoteShare || sharedFolder) {
      noteMenu.push({
        label: sharedFolder ? 'Permisos de la carpeta…' : 'Compartir…',
        icon: <Link2 size={14} />,
        onSelect: () =>
          setDialog(
            !paid
              ? { kind: 'upgrade' }
              : sharedFolder
                ? { kind: 'share-folder', folderId: sharedFolder.id }
                : { kind: 'share-note' }
          ),
      })
    }
    if (resolveSort(activeNote.folderId ?? null, foldersById, rootSort) === 'manual') {
      noteMenu.push({
        label: 'Subir',
        icon: <ArrowUp size={14} />,
        onSelect: () => void handleMoveNote(-1),
      })
      noteMenu.push({
        label: 'Bajar',
        icon: <ArrowDown size={14} />,
        onSelect: () => void handleMoveNote(1),
      })
    }
    noteMenu.push({
      label: 'Exportar .md',
      icon: <FileDown size={14} />,
      onSelect: handleExportNote,
    })
    if (noteOwner) {
      noteMenu.push({
        label: 'Mover a…',
        icon: <Move size={14} />,
        onSelect: () => setDialog({ kind: 'move' }),
      })
      noteMenu.push({
        label: 'Eliminar nota',
        icon: <Trash2 size={14} />,
        danger: true,
        separatorBefore: true,
        onSelect: () => void handleDeleteNote(),
      })
    }
  }

  /** The tab menu: every "open this page beside/below me" lives here. */
  const tabMenuItems: MenuItem[] = tabMenu
    ? [
        {
          label: 'Nueva nota acá',
          icon: <Plus size={14} />,
          onSelect: () => void handleNewNote(undefined, tabMenu.paneId),
        },
        // A phone shows one pane at a time, so offering a split it cannot show
        // would only lose the user's file behind the tree.
        ...(isMobile
          ? []
          : [
              {
                label: 'Dividir a la derecha',
                icon: <Columns2 size={14} />,
                separatorBefore: true,
                onSelect: () => splitPaneAt(tabMenu.paneId, 'row'),
              },
              {
                label: 'Dividir abajo',
                icon: <Rows2 size={14} />,
                onSelect: () => splitPaneAt(tabMenu.paneId, 'column'),
              },
            ]),
        ...(tabMenu.tabId
          ? [
              {
                label: 'Cerrar pestaña',
                icon: <X size={14} />,
                separatorBefore: true,
                onSelect: () => closePaneTab(tabMenu.paneId, tabMenu.tabId!),
              },
              {
                label: 'Cerrar las demás',
                onSelect: () => closeSiblingTabs(tabMenu.paneId, tabMenu.tabId!),
              },
            ]
          : []),
      ]
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

  const tagTree = buildTagTree(notes)
  const visibleNotes = selectedTags.length
    ? notes.filter((note) => matchesTagFilter(note.tags, selectedTags))
    : notes
  /** Inactive tabs take their label from the workspace list: no subscription each. */
  const titles = useMemo(() => new Map(notes.map((note) => [note.id, note.title])), [notes])

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
        rootSort={rootSort}
        onFolderMenu={(folder, pos) => setFolderMenu({ folder, ...pos })}
        expanded={expanded}
        onToggleFolder={toggleFolder}
        onClose={() => setSidebarOpen(false)}
        onCollapse={toggleSidebar}
        isMobile={isMobile}
        isOpen={isMobile ? sidebarOpen : !collapsed}
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
      />

      <main className="pane">
        <PaneBar
          status={status}
          presence={presence}
          sidebarCollapsed={!isMobile && collapsed}
          isMobile={isMobile}
          onToggleSidebar={toggleSidebar}
          onMenu={() =>
            setDialog(dialog.kind === 'note-menu' ? { kind: 'none' } : { kind: 'note-menu' })
          }
          menuOpen={dialog.kind === 'note-menu'}
          selectedTags={selectedTags}
          onClearTags={() => setSelectedTags([])}
        />

        {notice && (
          <div className="banner">
            <span style={{ flex: 1 }}>{notice}</span>
            <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Cerrar aviso">
              ✕
            </button>
          </div>
        )}

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
                note={noteId ? (notesById[noteId] ?? null) : null}
                noteError={noteId ? (noteErrors[noteId] ?? null) : null}
                focused={pane.id === focusedPaneId}
                uid={user.uid}
                userName={userName || 'Alguien'}
                folders={folders}
                isMobile={isMobile}
                onFocus={() => focusPane(pane.id)}
                onActivateTab={(tabId) => activateTab(pane.id, tabId)}
                onCloseTab={(tabId) => closePaneTab(pane.id, tabId)}
                onNewNote={() => void handleNewNote(undefined, pane.id)}
                onClosePane={
                  listPanes(layout).length > 1 ? () => closePaneAt(pane.id) : undefined
                }
                onImport={() => importRef.current?.click()}
                emptyWorkspace={notes.length === 0}
                onMenu={(pos) =>
                  setTabMenu({ paneId: pane.id, tabId: currentTab?.id ?? null, ...pos })
                }
                menuOpen={tabMenu?.paneId === pane.id}
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
      </main>

      {dialog.kind === 'note-menu' && noteMenu.length > 0 && (
        <Menu items={noteMenu} onClose={() => setDialog({ kind: 'none' })} />
      )}

      {tabMenu && (
        <Menu
          anchor="pointer"
          pos={{ x: tabMenu.x, y: tabMenu.y }}
          items={tabMenuItems}
          onClose={() => setTabMenu(null)}
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

      {dialog.kind === 'share-note' && activeNote && (
        <ShareDialog
          target={{
            kind: 'note',
            id: activeNote.id,
            name: activeNote.title,
            acl: { memberIds: activeNote.memberIds, roles: activeNote.roles, access: activeNote.access },
            ownerId: activeNote.ownerId,
            inheritedFrom: sharedFolder ? { id: sharedFolder.id, name: sharedFolder.name } : null,
          }}
          currentUid={user.uid}
          onClose={() => setDialog({ kind: 'none' })}
          onChangeAccess={(access: Access) => {
            track('note_shared', user.uid, { kind: 'note', access })
            return updateNoteSharing(activeNote, { access })
          }}
          onAddMember={(uid: string, role: Role) =>
            updateNoteSharing(activeNote, { addMember: { uid, role } })
          }
          onSetRole={(uid: string, role: Role) =>
            updateNoteSharing(activeNote, { setRole: { uid, role } })
          }
          onRemoveMember={(uid: string) => updateNoteSharing(activeNote, { removeMember: uid })}
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

      {dialog.kind === 'move' && activeNote && (
        <MoveDialog
          noteTitle={activeNote.title}
          folders={flattenFolders(folders).map((node) => ({
            ...node.folder,
            name: `${'\u00a0\u00a0'.repeat(node.depth)}${node.folder.name}`,
          }))}
          currentFolderId={activeNote.folderId}
          onMove={(folder) => void moveNoteTo(activeNote, folder)}
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

export default App
