import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Bot, Download, FileDown, FolderPlus, Hash, Link2, LogOut, Move, Pencil, Trash2, Upload } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { PaneBar } from './components/PaneBar'
import { Menu, type MenuItem } from './components/Menu'
import { CollaborativeEditor } from './components/CollaborativeEditor'
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
import { buildTagTree, extractTags, matchesTagFilter, parseTagInput } from './lib/tags'
import { flattenFolders, folderPath } from './lib/folders'
import { parseProperties, setProperty } from './lib/properties'
import { MAX_FOLDER_DEPTH } from './lib/folders'
import { NotePanels, type PropertyChange } from './components/NotePanels'
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
  noteCanEdit,
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
  | { kind: 'rename-tag' }

function initialNoteId(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('note')
  if (fromUrl) return fromUrl
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

  const [activeId, setActiveId] = useState<string | null>(initialNoteId)
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [folderMenu, setFolderMenu] = useState<{ folder: Folder; x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)
  const [presence, setPresence] = useState<AwarenessUser[]>([])
  const [status, setStatus] = useState({
    connected: false,
    pendingWrites: 0,
    updateCount: 0,
    error: null as string | null,
  })
  const [title, setTitle] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageTotals | null>(null)
  const [credits, setCredits] = useState<Credits | null>(null)
  const lastStats = useRef<SyncStats | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectNote = useCallback((id: string | null) => {
    setActiveId(id)
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id)
      else localStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  useEffect(() => {
    if (!activeId || !user) {
      setActiveNote(null)
      return
    }
    setLoadError(null)
    return subscribeNote(
      activeId,
      (note) => {
        if (!note) {
          setLoadError('La nota no existe o no tenés acceso.')
          setActiveNote(null)
          return
        }
        setActiveNote(note)
      },
      (message) => setLoadError(message)
    )
  }, [activeId, user])

  const titleFocused = useRef(false)

  useEffect(() => {
    if (!activeNote) return
    // Follow external renames (agent, another device) unless the user is typing.
    if (!titleFocused.current) setTitle(activeNote.title)
  }, [activeNote?.id, activeNote?.title])

  useEffect(() => {
    if (!activeId && notes.length > 0) selectNote(notes[0].id)
  }, [notes, activeId, selectNote])

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(expanded)))
    } catch {
      /* ignore */
    }
  }, [expanded])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (titleTimer.current) clearTimeout(titleTimer.current)
    }
  }, [])

  const editable = !!user && !!activeNote && noteCanEdit(activeNote, folders, user.uid)
  const noteOwner = !!user && !!activeNote && activeNote.ownerId === user.uid

  const persist = useCallback(
    (patch: { title?: string; markdown?: string; tags?: string[] }) => {
      if (!activeNote) return
      void saveNoteContent(activeNote.id, { ...patch, version: activeNote.version + 1 }).catch(
        () => undefined
      )
    },
    [activeNote]
  )

  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => persist({ markdown, tags: extractTags(markdown) }), 1200)
    },
    [persist]
  )

  const handleTitleChange = useCallback(
    (next: string) => {
      setTitle(next)
      if (!editable) return
      if (titleTimer.current) clearTimeout(titleTimer.current)
      titleTimer.current = setTimeout(() => persist({ title: next.trim() || 'Sin título' }), 600)
    },
    [editable, persist]
  )

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
              folder = (await addFolder(segment, parentId)) ?? undefined
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

  const handlePropertyChange = useCallback(
    async (change: PropertyChange) => {
      if (!activeNote) return
      const next =
        change.value === null
          ? setProperty(activeNote.markdown ?? '', { key: change.key, value: null })
          : setProperty(activeNote.markdown ?? '', {
              key: change.key,
              type: change.type ?? 'text',
              value: change.value,
            })
      await saveNoteContent(activeNote.id, {
        markdown: next,
        tags: extractTags(next),
        version: activeNote.version + 1,
      })
    },
    [activeNote]
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

  const handleNewNote = useCallback(
    async (folder?: Folder) => {
      const note = await addNote(folder)
      if (!note) return
      if (folder) setExpanded((prev) => new Set(prev).add(folder.id))
      track('note_created', user?.uid, { folder: folder ? 'yes' : 'root' })
      setPresence([])
      selectNote(note.id)
      if (isMobile) setSidebarOpen(false)
    },
    [addNote, isMobile, selectNote]
  )

  const handleNewFolder = useCallback(
    async (name: string, parentId: string | null = null) => {
      const folder = await addFolder(name, parentId)
      if (folder) {
        setExpanded((prev) => new Set(prev).add(folder.id))
        if (parentId) setExpanded((prev) => new Set(prev).add(parentId))
      }
      return folder
    },
    [addFolder]
  )

  const handleDeleteNote = useCallback(async () => {
    if (!activeNote) return
    if (!window.confirm(`¿Eliminar "${activeNote.title || 'Sin título'}"?`)) return
    await removeNote(activeNote.id)
    selectNote(null)
    setActiveNote(null)
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
    selectNote(null)
    setActiveNote(null)
  }, [doSignOut, selectNote])

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

  const sharedFolder = sharedFolderOf(activeNote, folders)
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

  const foldersById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const tagTree = buildTagTree(notes)
  const visibleNotes = selectedTags.length
    ? notes.filter((note) => matchesTagFilter(note.tags, selectedTags))
    : notes

  if (authLoading) return <div className="empty">Cargando…</div>

  if (!user) {
    return (
      <div className="empty" style={{ gap: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>FireMD</h1>
        <p style={{ maxWidth: 320, margin: 0, lineHeight: 1.6, textAlign: 'center' }}>
          Notas en Markdown, en carpetas, compartibles para leer o editar.
        </p>
        <button className="btn" onClick={() => void doGoogleSignIn()}>
          Entrar con Google
        </button>
        {authError && <p className="hint" style={{ color: '#e05252' }}>{authError}</p>}
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
        onNewFolder={() => setDialog({ kind: 'new-folder', parentId: null })}
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
          title={activeNote?.title || ''}
          status={status}
          presence={presence}
          sidebarCollapsed={!isMobile && collapsed}
          isMobile={isMobile}
          onToggleSidebar={toggleSidebar}
          onMenu={() =>
            setDialog(dialog.kind === 'note-menu' ? { kind: 'none' } : { kind: 'note-menu' })
          }
          menuOpen={dialog.kind === 'note-menu'}
        />

        <div className="scroll">
          {notice && (
            <div
              className="hint"
              style={{ padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center' }}
            >
              <span style={{ flex: 1 }}>{notice}</span>
              <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Cerrar aviso">
                ✕
              </button>
            </div>
          )}

          {loadError && (
            <p className="hint" style={{ padding: '16px 24px', color: '#e05252' }}>
              {loadError}
            </p>
          )}

          {!activeNote && !loadError && (
            <div className="empty" style={{ minHeight: '60vh' }}>
              <p style={{ margin: 0 }}>No hay ninguna nota abierta</p>
              <button className="btn ghost" onClick={() => void handleNewNote()}>
                Crear nota
              </button>
            </div>
          )}

          {activeNote && (
            <div className="doc">
              <input
                className="inline-title"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                readOnly={!editable}
                maxLength={300}
                placeholder="Sin título"
                aria-label="Título de la nota"
                spellCheck={false}
                onFocus={() => {
                  titleFocused.current = true
                }}
                onBlur={() => {
                  titleFocused.current = false
                }}
              />
              <NotePanels
                tags={activeNote.tags}
                properties={parseProperties(activeNote.markdown ?? '')}
                editable={editable}
                onTagClick={(tag) =>
                  setSelectedTags((current) =>
                    current.includes(tag.toLowerCase()) ? current : [...current, tag.toLowerCase()]
                  )
                }
                onRenameTag={() => setDialog({ kind: 'rename-tag' })}
                onPropertyChange={(change) => void handlePropertyChange(change)}
              />
              {sharedFolder && (
                <p className="readonly-note">
                  En «{folderPath(sharedFolder.id, foldersById)}» · permisos heredados de la carpeta
                </p>
              )}
              <CollaborativeEditor
                key={activeNote.id}
                note={activeNote}
                uid={user.uid}
                userName={userName || 'Alguien'}
                editable={editable}
                onMarkdownChange={handleMarkdownChange}
                onPresence={setPresence}
                onStatus={setStatus}
                onStats={handleStats}
              />
            </div>
          )}
        </div>
      </main>

      {dialog.kind === 'note-menu' && noteMenu.length > 0 && (
        <Menu items={noteMenu} onClose={() => setDialog({ kind: 'none' })} />
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

function sharedFolderOf(note: Note | null, folders: Folder[]): Folder | null {
  if (!note || note.aclSource !== 'folder' || !note.folderId) return null
  return folders.find((f) => f.id === note.folderId) ?? null
}

export default App
