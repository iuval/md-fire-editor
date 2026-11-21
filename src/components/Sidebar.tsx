import { FileText, X } from 'lucide-react'
import type { Note } from '../firebase'

interface SidebarProps {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  isOpen: boolean
  onClose: () => void
  isMobile: boolean
  loading: boolean
}

function formatDate(ts?: { seconds?: number }) {
  if (!ts?.seconds) return ''
  const d = new Date(ts.seconds * 1000)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function getPreview(content: string): string {
  return content.replace(/[#*`\[\]!\-_>]/g, '').slice(0, 60).trim() || 'No content'
}

export function Sidebar({ notes, activeId, onSelect, isOpen, onClose, isMobile, loading }: SidebarProps) {
  const sidebar = (
    <div
      style={{
        width: 280,
        height: '100%',
        background: 'light-dark(var(--color-surface), var(--color-surface-dark))',
        borderRight: '1px solid light-dark(var(--color-border), var(--color-border-dark))',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid light-dark(var(--color-border), var(--color-border-dark))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
            margin: 0,
          }}
        >
          Notes
        </h2>
        {isMobile && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
              display: 'flex',
            }}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {loading && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--color-muted)' }}>
            Loading...
          </div>
        )}

        {!loading && notes.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'light-dark(var(--color-muted), var(--color-muted-dark))' }}>
            No notes yet. Create one to get started.
          </div>
        )}

        {notes.map((note) => {
          const isActive = note.id === activeId
          return (
            <button
              key={note.id}
              onClick={() => {
                onSelect(note.id)
                if (isMobile) onClose()
              }}
              className={`note-item ${isActive ? 'active' : ''}`}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid light-dark(var(--color-border), var(--color-border-dark))',
                padding: '12px 20px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                outline: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={14} style={{ color: 'light-dark(var(--color-muted), var(--color-muted-dark))', flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: 'light-dark(var(--color-text), var(--color-text-dark))',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {note.title || 'Untitled'}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingLeft: 22,
                }}
              >
                {getPreview(note.content)}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
                  paddingLeft: 22,
                }}
              >
                {formatDate(note.updatedAt as any)}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  if (!isMobile) return sidebar

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 40,
          }}
        />
      )}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.2s ease',
        }}
      >
        {sidebar}
      </div>
    </>
  )
}
