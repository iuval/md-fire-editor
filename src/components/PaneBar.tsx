import { MoreHorizontal, PanelLeftOpen, Menu, X } from 'lucide-react'
import type { AwarenessUser } from '../lib/collab/awareness'
import type { ProviderStatus } from '../lib/collab/provider'
import { syncText } from '../lib/syncStatus'

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
  /** The focused pane's tab strip, when it lives in this bar. */
  tabs?: React.ReactNode
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
  tabs,
}: PaneBarProps) {
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

      {tabs ? <div className="pane-head-tabs">{tabs}</div> : <span style={{ flex: 1 }} />}

      {presence.length > 0 && (
        <span className="avatar-stack" aria-label="Editando ahora">
          {presence.slice(0, 3).map((p) => (
            <span key={p.uid} title={p.name} className="avatar" style={{ background: p.color, color: '#fff' }}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </span>
      )}

      {/* The dot now lives next to the avatar in the sidebar, but the live
          region stays here: it must keep announcing while the sidebar is
          collapsed or the phone drawer is closed. */}
      <span className="sr-only" role="status">
        {syncText(status)}
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
