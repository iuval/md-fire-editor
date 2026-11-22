import { Menu, X } from 'lucide-react'
import type { AwarenessUser } from '../lib/collab/awareness'

interface PaneBarProps {
  presence: AwarenessUser[]
  isMobile: boolean
  onToggleSidebar: () => void
  selectedTags?: string[]
  onClearTags?: () => void
  /** The focused pane's tab strip, when it lives in this bar. */
  tabs?: React.ReactNode
}

export function PaneBar({
  presence,
  isMobile,
  onToggleSidebar,
  selectedTags = [],
  onClearTags,
  tabs,
}: PaneBarProps) {
  return (
    <div className="pane-head">
      {/* A phone has no rail, so the drawer's opener lives here. On desktop the
          collapsed panel's own rail carries the expand button. */}
      {isMobile && (
        <button
          className="icon-btn"
          onClick={onToggleSidebar}
          aria-label="Abrir notas"
          title="Abrir notas"
        >
          <Menu size={16} />
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
