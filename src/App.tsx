import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderPlus, Link2, LogOut, Move, Pencil, Trash2 } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { PaneBar } from './components/PaneBar'
import { Menu, type MenuItem } from './components/Menu'
import { CollaborativeEditor } from './components/CollaborativeEditor'
import { ShareDialog } from './components/ShareDialog'
import { MoveDialog } from './components/MoveDialog'
import { InputDialog } from './components/InputDialog'
import { useAuth, useWorkspace } from './hooks/useFirebase'
import type { AwarenessUser } from './lib/collab/awareness'
import {
  isAclOwner,
  moveNoteTo,
  noteCanEdit,
  renameFolder,
  saveNoteContent,
  subscribeNote,
  updateFolderSharing,
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
  | { kind: 'new-folder' }
  | { kind: 'rename-folder'; folderId: string }

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

  useEffect(() => {
    if (activeNote) setTitle(activeNote.title)
  }, [activeNote?.id])

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
    (patch: { title?: string; markdown?: string }) => {
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
      saveTimer.current = setTimeout(() => persist({ markdown }), 1200)
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
      setPresence([])
      selectNote(note.id)
      if (isMobile) setSidebarOpen(false)
    },
    [addNote, isMobile, selectNote]
  )

  const handleNewFolder = useCallback(
    async (name: string) => {
      const folder = await addFolder(name)
      if (folder) setExpanded((prev) => new Set(prev).add(folder.id))
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
          setDialog(sharedFolder ? { kind: 'share-folder', folderId: sharedFolder.id } : { kind: 'share-note' }),
      })
    }
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
          label: 'Renombrar…',
          icon: <Pencil size={14} />,
          onSelect: () => setDialog({ kind: 'rename-folder', folderId: folderMenu.folder.id }),
        },
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
        notes={notes}
        folders={folders}
        activeId={activeId}
        onSelect={(id) => {
          setPresence([])
          selectNote(id)
          setSidebarOpen(false)
        }}
        onNewNote={(folder) => void handleNewNote(folder)}
        onNewFolder={() => setDialog({ kind: 'new-folder' })}
        onFolderMenu={(folder, pos) => setFolderMenu({ folder, ...pos })}
        expanded={expanded}
        onToggleFolder={toggleFolder}
        onClose={() => setSidebarOpen(false)}
        onCollapse={toggleSidebar}
        isMobile={isMobile}
        isOpen={isMobile ? sidebarOpen : !collapsed}
        loading={dataLoading}
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
              />
              {sharedFolder && (
                <p className="readonly-note">
                  En la carpeta «{sharedFolder.name}» · permisos heredados de la carpeta
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
              { label: 'Cerrar sesión', icon: <LogOut size={14} />, onSelect: () => void handleSignOut() },
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
          onChangeAccess={(access: Access) => updateNoteSharing(activeNote, { access })}
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
          onChangeAccess={(access: Access) => updateFolderSharing(shareFolderTarget, { access })}
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
          folders={folders}
          currentFolderId={activeNote.folderId}
          onMove={(folder) => void moveNoteTo(activeNote, folder)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      {dialog.kind === 'new-folder' && (
        <InputDialog
          title="Nueva carpeta"
          label="Nombre"
          confirmLabel="Crear"
          onConfirm={(name) => void handleNewFolder(name)}
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
