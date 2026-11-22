import { useEffect, useRef, useState } from 'react'
import { Columns2, Plus, Rows2, X } from 'lucide-react'
import { useT } from '../i18n/index.ts'
import {
  beginTabDrag,
  currentTabDrag,
  dropIndexAt,
  endTabDrag,
  type TabDragSource,
} from '../lib/tabDrag'

export interface TabStripItem {
  id: string
  title: string
}

interface TabStripProps {
  /** The pane these tabs belong to: a tab dragged out of it is moved, not copied. */
  paneId: string
  tabs: TabStripItem[]
  activeTabId: string | null
  /**
   * Drops a tab into this strip at `index`. Absent where a drag is impossible
   * (a phone has no HTML5 drag), which also leaves the tabs undraggable.
   */
  onDropTab?: (source: TabDragSource, index: number) => void
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewNote: () => void
  /**
   * Renames the note behind a tab, from a double click on its title. Absent
   * when the tab's note cannot be written: then the title stays a plain label.
   */
  onRename?: (tabId: string, title: string) => void
  /**
   * Splits, as plain buttons: the pane actions are three icons, never a menu.
   * Absent on a phone, which shows one pane at a time.
   */
  onSplitRight?: () => void
  onSplitDown?: () => void
  /** Set when the pane budget is spent: both splits disable and explain why. */
  splitLimitLabel?: string
  /** Absent when this is the only pane: there is nothing to close. */
  onClosePane?: () => void
  /**
   * Rendered inside the top bar instead of its own strip: the bar already
   * paints the chrome, so the strip drops its own background and border.
   */
  compact?: boolean
}

/**
 * The tab's title, as a field: a double click puts it in place of the label, so
 * a rename never leaves the strip for a dialog.
 */
function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const t = useT()
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  // Enter, Escape and a click elsewhere all end the edit; only the first wins,
  // because the blur that follows a key press must not commit again.
  const done = useRef(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus()
    node.select()
  }, [])

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(value)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      className="tab-rename"
      value={value}
      aria-label={t('tabs.renameOf', { title: initial })}
      spellCheck={false}
      // Same cap as the note title itself.
      maxLength={300}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true)
        else if (event.key === 'Escape') finish(false)
      }}
    />
  )
}

/**
 * One tab per open file, in the pane's own header.
 *
 * The tail of the strip is the pane's own three actions — split right, split
 * down, close — because everything else (new note, file actions) already has a
 * button elsewhere and a second one would only be a duplicate.
 */
export function TabStrip({
  paneId,
  tabs,
  activeTabId,
  onDropTab,
  onActivate,
  onClose,
  onNewNote,
  onRename,
  onSplitRight,
  onSplitDown,
  splitLimitLabel,
  onClosePane,
  compact = false,
}: TabStripProps) {
  const t = useT()
  const buttons = useRef(new Map<string, HTMLButtonElement | null>())
  const listRef = useRef<HTMLDivElement>(null)
  /** The tab whose title is being typed, and the text it had before. */
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  /** Tab to focus once renaming ends: the input that had the focus is gone. */
  const refocus = useRef<string | null>(null)
  /** The tab being dragged, painted faded while it is in flight. */
  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** Where an insertion line shows: `tabs.length` is past the last tab. */
  const [gap, setGap] = useState<number | null>(null)

  /** Live tab positions, in client coordinates: the pointer arrives in those. */
  const tabRects = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('.tab') ?? []).map((node) => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    })

  useEffect(() => {
    if (renaming) return
    const id = refocus.current
    if (!id) return
    refocus.current = null
    buttons.current.get(id)?.focus()
  }, [renaming])

  const finishRename = (tabId: string, before: string, next: string | null) => {
    refocus.current = tabId
    setRenaming(null)
    // An emptied or unchanged title is not a rename: writing it would replace a
    // real name with nothing.
    const value = next?.trim()
    if (value && value !== before) onRename?.(tabId, value)
  }

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
      <div
        className="tabbar-tabs"
        role="tablist"
        aria-label="Archivos abiertos"
        ref={listRef}
        onDragOver={(event) => {
          if (!onDropTab || !currentTabDrag()) return
          // Stops at the strip: the pane's body target must not paint behind it.
          event.preventDefault()
          event.stopPropagation()
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
          const next = dropIndexAt(tabRects(), event.clientX)
          if (next !== gap) setGap(next)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          if (gap !== null) setGap(null)
        }}
        onDrop={(event) => {
          const source = currentTabDrag()
          if (!source || !onDropTab) return
          event.preventDefault()
          event.stopPropagation()
          setGap(null)
          setDraggingId(null)
          endTabDrag()
          onDropTab(source, dropIndexAt(tabRects(), event.clientX))
        }}
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId
          const title = tab.title || t('app.untitled')
          const draggable = Boolean(onDropTab) && renaming?.id !== tab.id
          return (
            <div
              key={tab.id}
              className={`tab${active ? ' active' : ''}${draggingId === tab.id ? ' tab--dragging' : ''}`}
              data-tab-id={tab.id}
              draggable={draggable}
              onDragStart={(event) => {
                if (!draggable) return
                beginTabDrag({ paneId, tabId: tab.id })
                setDraggingId(tab.id)
                // Firefox only starts a drag once some data rides along.
                event.dataTransfer?.setData('text/plain', tab.id)
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                setDraggingId(null)
                setGap(null)
                endTabDrag()
              }}
            >
              {gap === index && <span className="tab-drop-line" aria-hidden="true" />}
              {renaming?.id === tab.id ? (
                <TabRenameInput
                  initial={title}
                  onCommit={(next) => finishRename(tab.id, title, next)}
                  onCancel={() => finishRename(tab.id, title, null)}
                />
              ) : (
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
                  onDoubleClick={onRename ? () => setRenaming({ id: tab.id, title }) : undefined}
                  onKeyDown={(event) => onKeyDown(event, index)}
                >
                  <span className="tab-text">{title}</span>
                </button>
              )}
              <button
                className="tab-close"
                aria-label={t('tabs.close', { title })}
                title={t('tabs.closeShort')}
                onClick={() => onClose(tab.id)}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        {gap === tabs.length && <span className="tab-drop-line" aria-hidden="true" />}
        {/* Next to the last tab, where the eye already is when reading them. */}
        <button
          className="icon-btn icon-btn--sm tab-new"
          onClick={onNewNote}
          aria-label={t('tabs.newNote')}
          title={t('tabs.newNote')}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="tabbar-actions">
        {onSplitRight && (
          <button
            className="icon-btn icon-btn--sm"
            onClick={onSplitRight}
            disabled={Boolean(splitLimitLabel)}
            aria-label={t('tabs.splitRight')}
            title={splitLimitLabel ?? t('tabs.splitRight')}
          >
            <Columns2 size={14} />
          </button>
        )}
        {onSplitDown && (
          <button
            className="icon-btn icon-btn--sm"
            onClick={onSplitDown}
            disabled={Boolean(splitLimitLabel)}
            aria-label={t('tabs.splitDown')}
            title={splitLimitLabel ?? t('tabs.splitDown')}
          >
            <Rows2 size={14} />
          </button>
        )}
        {onClosePane && (
          <button
            className="icon-btn icon-btn--sm"
            onClick={onClosePane}
            aria-label={t('tabs.closePane')}
            title={t('tabs.closePane')}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
