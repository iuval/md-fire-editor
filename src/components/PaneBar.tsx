import { MoreHorizontal, PanelLeftOpen, Menu, X } from 'lucide-react'
import type { AwarenessUser } from '../lib/collab/awareness'
import type { ProviderStatus } from '../lib/collab/provider'

interface PaneBarProps {
  status: ProviderStatus
  presence: AwarenessUser[]
  sidebarCollapsed: boolean
  isMobile: boolean
  onToggleSidebar: () => void
  onMenu: () => void
  menuOpen: boolean
  selectedTags?: string[]
  onClearTags?: () => void
}

type Tone = 'ok' | 'pending' | 'error'

function tone(status: ProviderStatus): Tone {
  if (status.error) return 'error'
  if (status.pendingWrites > 0 || !status.connected) return 'pending'
  return 'ok'
}

/**
 * Sync state is the one thing you cannot see in the document, so it earns a
 * word when it is *not* fine. When everything is saved it collapses to a dot:
 * silence is the success state.
 */
function statusLabel(status: ProviderStatus): string | null {
  if (status.error) return 'Sin conexión'
  if (status.pendingWrites > 0) return 'Guardando…'
  if (!status.connected) return 'Conectando…'
  return null
}

function statusText(status: ProviderStatus): string {
  if (status.error) return 'Sin conexión'
  if (status.pendingWrites > 0) return 'Guardando'
  if (!status.connected) return 'Conectando'
  return 'Sincronizado'
}

export function PaneBar({
  status,
  presence,
  sidebarCollapsed,
  isMobile,
  onToggleSidebar,
  onMenu,
  menuOpen,
  selectedTags = [],
  onClearTags,
}: PaneBarProps) {
  const label = statusLabel(status)

  return (
    <div className="pane-head">
      {(isMobile || sidebarCollapsed) && (
        <button
          className="icon-btn"
          onClick={onToggleSidebar}
          aria-label={isMobile ? 'Abrir notas' : 'Mostrar panel'}
          title={isMobile ? 'Abrir notas' : 'Mostrar panel'}
        >
          {isMobile ? <Menu size={16} /> : <PanelLeftOpen size={15} />}
        </button>
      )}

      {selectedTags.length > 0 && (
        <div className="pane-filter" aria-label="Filtro por etiqueta activo">
          {selectedTags.map((tag) => (
            <span className="tag-chip active" key={tag}>
              #{tag}
            </span>
          ))}
          <button
            className="icon-btn icon-btn--sm"
            onClick={onClearTags}
            aria-label="Quitar filtro de etiquetas"
            title="Quitar filtro"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <span style={{ flex: 1 }} />

      {presence.length > 0 && (
        <span className="avatar-stack" aria-label="Editando ahora">
          {presence.slice(0, 3).map((p) => (
            <span key={p.uid} title={p.name} className="avatar" style={{ background: p.color, color: '#fff' }}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </span>
      )}

      <span className={`sync sync--${tone(status)}`} role="status" title={statusText(status)}>
        <span className="sync-dot" aria-hidden="true" />
        {label && <span className="sync-text">{label}</span>}
        <span className="sr-only">{statusText(status)}</span>
      </span>

      <button
        className="icon-btn"
        onClick={onMenu}
        aria-label="Más acciones"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Más acciones"
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  )
}
