import { useEffect, useRef } from 'react'
import { Ellipsis, Plus, X } from 'lucide-react'

export interface TabStripItem {
  id: string
  title: string
}

interface TabStripProps {
  tabs: TabStripItem[]
  activeTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewNote: () => void
  /** Pointer position for the tab/pane menu (split actions live there). */
  onMenu: (pos: { x: number; y: number }) => void
  menuOpen: boolean
  /** Absent when this is the only pane: there is nothing to close. */
  onClosePane?: () => void
  /**
   * Rendered inside the top bar instead of its own strip: no bar chrome and no
   * actions, because the top bar already owns the menu.
   */
  compact?: boolean
}

/**
 * One tab per open file, in the pane's own header.
 *
 * Right-clicking a tab opens the same menu as the chevron, so "split right /
 * split down" is one gesture away from the tab you are reading.
 */
export function TabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onNewNote,
  onMenu,
  menuOpen,
  onClosePane,
  compact = false,
}: TabStripProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement | null>())
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the active tab visible: opening a file at the end of a long strip used
  // to leave it scrolled out of sight on narrow panes and phones.
  useEffect(() => {
    const list = listRef.current
    const active = activeTabId ? buttons.current.get(activeTabId) : null
    if (!list || !active) return
    const left = active.offsetLeft
    const right = left + active.offsetWidth
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left - 4)
    else if (right > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = right - list.clientWidth + 4
    }
  }, [activeTabId, tabs.length])

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = index >= last ? 0 : index + 1
        break
      case 'ArrowLeft':
        next = index <= 0 ? last : index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }
    event.preventDefault()
    onActivate(tabs[next].id)
    buttons.current.get(tabs[next].id)?.focus()
  }

  return (
    <div className={`tabbar${compact ? ' tabbar--inline' : ''}`}>
      <div className="tabbar-tabs" role="tablist" aria-label="Archivos abiertos" ref={listRef}>
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId
          const title = tab.title || 'Sin título'
          return (
            <div
              key={tab.id}
              className={`tab${active ? ' active' : ''}`}
              onContextMenu={(event) => {
                event.preventDefault()
                onMenu({ x: event.clientX, y: event.clientY })
              }}
            >
              <button
                ref={(el) => {
                  buttons.current.set(tab.id, el)
                }}
                className="tab-label"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={title}
                onClick={() => onActivate(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <span className="tab-text">{title}</span>
              </button>
              <button
                className="tab-close"
                aria-label={`Cerrar ${title}`}
                title="Cerrar"
                onClick={() => onClose(tab.id)}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        {/* Next to the last tab, where the eye already is when reading them. */}
        <button
          className="icon-btn icon-btn--sm tab-new"
          onClick={onNewNote}
          aria-label="Nueva nota"
          title="Nueva nota"
        >
          <Plus size={14} />
        </button>
      </div>

      {!compact && (
        <div className="tabbar-actions">
          <button
            className="icon-btn icon-btn--sm"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onMenu({ x: rect.right, y: rect.bottom })
            }}
            aria-label="Opciones del panel"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Opciones del panel"
          >
            <Ellipsis size={14} />
          </button>
          {onClosePane && (
            <button
              className="icon-btn icon-btn--sm"
              onClick={onClosePane}
              aria-label="Cerrar panel"
              title="Cerrar panel"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
