import { PanelLeftClose, Plus, Link2, User } from 'lucide-react'
import type { Note } from '../lib/notes'

interface SidebarProps {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewNote: () => void
  onClose: () => void
  onCollapse: () => void
  isMobile: boolean
  isOpen: boolean
  loading: boolean
  uid?: string
  userName?: string
  photoURL?: string | null
  onAccountClick: () => void
}

function formatDate(ts?: { seconds: number } | null) {
  if (!ts?.seconds) return ''
  return new Date(ts.seconds * 1000).toLocaleDateString('es', { day: '2-digit', month: '2-digit' })
}

function preview(markdown: string): string {
  return markdown.replace(/[#*`[\]!>_~-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

export function Sidebar({
  notes,
  activeId,
  onSelect,
  onNewNote,
  onClose,
  onCollapse,
  isMobile,
  isOpen,
  loading,
  uid,
  userName,
  photoURL,
  onAccountClick,
}: SidebarProps) {
  return (
    <aside
      className={`sidebar${isOpen ? ' open' : ''}`}
      aria-label="Lista de notas"
      aria-hidden={isMobile && !isOpen}
    >
      <div className="sidebar-head">
        <span className="sidebar-title">Notas</span>
        <button className="icon-btn" onClick={onNewNote} aria-label="Nueva nota" title="Nueva nota">
          <Plus size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={isMobile ? onClose : onCollapse}
          aria-label={isMobile ? 'Cerrar panel' : 'Ocultar panel'}
          title={isMobile ? 'Cerrar panel' : 'Ocultar panel'}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      <div className="file-list">
        {loading && <p className="hint" style={{ padding: '10px 8px' }}>Cargando…</p>}

        {!loading && notes.length === 0 && (
          <p className="hint" style={{ padding: '10px 8px' }}>
            Sin notas todavía.
          </p>
        )}

        {notes.map((note) => {
          const shared = note.memberIds.length > 1 || note.access === 'link-edit'
          const meta = [formatDate(note.updatedAt), preview(note.markdown)].filter(Boolean).join(' · ')
          return (
            <button
              key={note.id}
              className={`file-item${note.id === activeId ? ' active' : ''}`}
              onClick={() => onSelect(note.id)}
              aria-current={note.id === activeId ? 'true' : undefined}
            >
              <span className="file-name">
                {shared && <Link2 size={10} style={{ marginRight: 4, opacity: 0.6, verticalAlign: 'middle' }} />}
                {note.title || 'Sin título'}
              </span>
              <span className="file-meta">{meta || 'Vacía'}</span>
            </button>
          )
        })}
      </div>

      <div className="sidebar-foot">
        <button className="account" onClick={onAccountClick} aria-label="Cuenta y ajustes">
          {photoURL ? (
            <img className="avatar" src={photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar" aria-hidden="true">
              {uid ? <User size={11} /> : null}
            </span>
          )}
          <span className="account-name">{userName || 'Cuenta'}</span>
        </button>
      </div>
    </aside>
  )
}
