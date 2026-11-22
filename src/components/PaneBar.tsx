import { PanelLeftOpen, Menu, X } from 'lucide-react'
import type { AwarenessUser } from '../lib/collab/awareness'

interface PaneBarProps {
  presence: AwarenessUser[]
  sidebarCollapsed: boolean
  isMobile: boolean
  onToggleSidebar: () => void
  selectedTags?: string[]
  onClearTags?: () => void
  /** The focused pane's tab strip, when it lives in this bar. */
  tabs?: React.ReactNode
}

export function PaneBar({
  presence,
  sidebarCollapsed,
  isMobile,
  onToggleSidebar,
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

    </div>
  )
}
