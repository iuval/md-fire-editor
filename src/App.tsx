import { useState, useEffect, useCallback, useRef } from 'react'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { useAuth, useNotes } from './hooks/useFirebase'
import type { Note } from './firebase'

function App() {
  const { user, loading: authLoading } = useAuth()
  const { notes, loading: notesLoading, createNote, updateNote, removeNote } = useNotes(user?.uid)

  const [activeNoteId, setActiveNoteId] = useState<string | null>(() => {
    try { return localStorage.getItem('mdfire-active') || null } catch { return null }
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline'>('synced')
  const [editorValue, setEditorValue] = useState('')
  const [noteTitle, setNoteTitle] = useState('Untitled Note')
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSetActive = useCallback((id: string | null) => {
    setActiveNoteId(id)
    if (id) localStorage.setItem('mdfire-active', id)
    else localStorage.removeItem('mdfire-active')
  }, [])

  const activeNote = notes.find((n) => n.id === activeNoteId)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!activeNoteId && notes.length > 0) {
      handleSetActive(notes[0].id)
    }
  }, [notes, activeNoteId, handleSetActive])

  useEffect(() => {
    if (activeNote) {
      setEditorValue(activeNote.content)
      setNoteTitle(activeNote.title || 'Untitled Note')
    }
  }, [activeNote?.id])

  useEffect(() => {
    if (!user?.uid || !activeNoteId) return

    setSyncStatus('syncing')
    if (syncTimer.current) clearTimeout(syncTimer.current)

    syncTimer.current = setTimeout(async () => {
      const note: Note = {
        id: activeNoteId,
        title: noteTitle,
        content: editorValue,
      }
      try {
        await updateNote(note)
        setSyncStatus('synced')
      } catch {
        setSyncStatus('offline')
      }
    }, 1500)

    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current)
    }
  }, [editorValue, noteTitle, activeNoteId, user?.uid, updateNote])

  const handleNewNote = useCallback(async () => {
    const note = await createNote()
    if (note) {
      handleSetActive(note.id)
      setEditorValue('')
      setNoteTitle('Untitled Note')
      if (isMobile) setSidebarOpen(false)
    }
  }, [createNote, isMobile, handleSetActive])

  const handleDeleteNote = useCallback(async () => {
    if (!activeNoteId) return
    if (!confirm('Delete this note? This cannot be undone.')) return
    await removeNote(activeNoteId)
    handleSetActive(null)
    setEditorValue('')
    setNoteTitle('Untitled Note')
  }, [activeNoteId, removeNote, handleSetActive])

  const handleSelectNote = useCallback((id: string) => {
    handleSetActive(id)
  }, [handleSetActive])

  const handleEditorChange = useCallback((v: string) => {
    setEditorValue(v)
  }, [])

  const handleTitleChange = useCallback((title: string) => {
    setNoteTitle(title)
  }, [])

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: '100svh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'light-dark(var(--color-bg), var(--color-bg-dark))',
          color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
          fontSize: 14,
        }}
      >
        Loading...
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100svh',
        overflow: 'hidden',
        background: 'light-dark(var(--color-bg), var(--color-bg-dark))',
      }}
    >
      <Header
        title={noteTitle}
        onMenuClick={() => setSidebarOpen(true)}
        onNewNote={handleNewNote}
        onDeleteNote={handleDeleteNote}
        isMobile={isMobile}
        syncStatus={syncStatus}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          notes={notes}
          activeId={activeNoteId}
          onSelect={handleSelectNote}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          isMobile={isMobile}
          loading={notesLoading}
        />

        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {!activeNoteId ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
                padding: 24,
              }}
            >
              <div style={{ fontSize: 48, opacity: 0.3 }}>📝</div>
              <p style={{ fontSize: 16, margin: 0 }}>No note selected</p>
              <button
                onClick={handleNewNote}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid light-dark(var(--color-border), var(--color-border-dark))',
                  background: 'light-dark(var(--color-surface), var(--color-surface-dark))',
                  color: 'light-dark(var(--color-text), var(--color-text-dark))',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Create your first note
              </button>
            </div>
          ) : (
            <Editor value={editorValue} onChange={handleEditorChange} onTitleChange={handleTitleChange} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
