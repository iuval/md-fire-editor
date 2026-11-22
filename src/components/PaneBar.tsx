import { Menu, X } from 'lucide-react'
import type { AwarenessUser } from '../lib/collab/awareness'
import { useT } from '../i18n/index.ts'

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
  const t = useT()
  return (
    <div className="pane-head">
      {/* A phone has no rail, so the drawer's opener lives here. On desktop the
          collapsed panel's own rail carries the expand button. */}
      {isMobile && (
        <button
          className="icon-btn"
          onClick={onToggleSidebar}
          aria-label={t('paneBar.openNotes')}
          title={t('paneBar.openNotes')}
        >
          <Menu size={16} />
        </button>
      )}

      {selectedTags.length > 0 && (
        <div className="pane-filter" aria-label={t('paneBar.tagFilterActive')}>
          {selectedTags.map((tag) => (
            <span className="tag-chip active" key={tag}>
              #{tag}
            </span>
          ))}
          <button
            className="icon-btn icon-btn--sm"
            onClick={onClearTags}
            aria-label={t('paneBar.clearTagFilter')}
            title="Quitar filtro"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {tabs ? <div className="pane-head-tabs">{tabs}</div> : <span style={{ flex: 1 }} />}

      {presence.length > 0 && (
        <span className="avatar-stack" aria-label={t('paneBar.editingNow')}>
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
