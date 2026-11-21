import { useCallback, useEffect, useRef, useState } from 'react'
import { Link2, LogOut, Trash2 } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { PaneBar } from './components/PaneBar'
import { Menu, type MenuItem } from './components/Menu'
import { CollaborativeEditor } from './components/CollaborativeEditor'
import { ShareDialog } from './components/ShareDialog'
import { useAuth, useMyNotes } from './hooks/useFirebase'
import {
  canEdit as noteCanEdit,
  isOwner as noteIsOwner,
  saveNoteContent,
  setNoteAccess,
  subscribeNote,
  type Note,
} from './lib/notes'
import type { AwarenessUser } from './lib/collab/awareness'
import type { ProviderStatus } from './lib/collab/provider'

const ACTIVE_KEY = 'mdfire-active'
const SIDEBAR_KEY = 'mdfire-sidebar'

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

function App() {
  const { user, loading: authLoading, error: authError, doGoogleSignIn, doSignOut } = useAuth()
  const { notes, loading: notesLoading, addNote, removeNote } = useMyNotes(user?.uid)

  const [activeId, setActiveId] = useState<string | null>(initialNoteId)
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [dialog, setDialog] = useState<'none' | 'note-menu' | 'account-menu' | 'share'>('none')
  const [presence, setPresence] = useState<AwarenessUser[]>([])
  const [status, setStatus] = useState<ProviderStatus>({
    connected: false,
    pendingWrites: 0,
    updateCount: 0,
    error: null,
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
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (titleTimer.current) clearTimeout(titleTimer.current)
    }
  }, [])

  const editable = !!user && !!activeNote && noteCanEdit(activeNote, user.uid)
  const owner = !!user && !!activeNote && noteIsOwner(activeNote, user.uid)

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

  const handleNewNote = useCallback(async () => {
    const note = await addNote()
    if (!note) return
    setPresence([])
    selectNote(note.id)
    if (isMobile) setSidebarOpen(false)
  }, [addNote, isMobile, selectNote])

  const handleDelete = useCallback(async () => {
    if (!activeNote) return
    if (!window.confirm(`¿Eliminar "${activeNote.title || 'Sin título'}"?`)) return
    await removeNote(activeNote.id)
    selectNote(null)
    setActiveNote(null)
  }, [activeNote, removeNote, selectNote])

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

  const menuItems: MenuItem[] = []
  if (owner) {
    menuItems.push({
      label: 'Compartir…',
      icon: <Link2 size={14} />,
      onSelect: () => setDialog('share'),
    })
    menuItems.push({
      label: 'Eliminar nota',
      icon: <Trash2 size={14} />,
      danger: true,
      separatorBefore: true,
      onSelect: () => void handleDelete(),
    })
  }

  const accountItems: MenuItem[] = [
    { label: 'Cerrar sesión', icon: <LogOut size={14} />, onSelect: () => void handleSignOut() },
  ]

  const userName = user?.displayName || user?.email?.split('@')[0] || ''

  if (authLoading) {
    return <div className="empty">Cargando…</div>
  }

  if (!user) {
    return (
      <div className="empty" style={{ gap: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>FireMD</h1>
        <p style={{ maxWidth: 320, margin: 0, lineHeight: 1.6, textAlign: 'center' }}>
          Notas en Markdown, sincronizadas y editables en simultáneo.
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
        activeId={activeId}
        onSelect={(id) => {
          setPresence([])
          selectNote(id)
          setSidebarOpen(false)
        }}
        onNewNote={() => void handleNewNote()}
        onClose={() => setSidebarOpen(false)}
        onCollapse={toggleSidebar}
        isMobile={isMobile}
        isOpen={isMobile ? sidebarOpen : !collapsed}
        loading={notesLoading}
        uid={user.uid}
        userName={userName}
        photoURL={user.photoURL}
        onAccountClick={() => setDialog('account-menu')}
      />

      <main className="pane">
        <PaneBar
          title={activeNote?.title || ''}
          status={status}
          presence={presence}
          sidebarCollapsed={!isMobile && collapsed}
          isMobile={isMobile}
          onToggleSidebar={toggleSidebar}
          onMenu={() => setDialog(dialog === 'note-menu' ? 'none' : 'note-menu')}
          menuOpen={dialog === 'note-menu'}
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

      {dialog === 'note-menu' && menuItems.length > 0 && (
        <Menu items={menuItems} onClose={() => setDialog('none')} />
      )}

      {dialog === 'account-menu' && (
        <>
          <div className="scrim" style={{ background: 'transparent' }} onClick={() => setDialog('none')} />
          <Menu items={accountItems} onClose={() => setDialog('none')} anchor="bottom-left" />
        </>
      )}

      {dialog === 'share' && activeNote && (
        <ShareDialog
          note={activeNote}
          onClose={() => setDialog('none')}
          onChangeAccess={(access) => setNoteAccess(activeNote.id, access)}
        />
      )}
    </div>
  )
}

export default App
