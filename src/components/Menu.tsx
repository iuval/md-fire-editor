import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, X } from 'lucide-react'
import { useT } from '../i18n/index.ts'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  danger?: boolean
  /** Draws a divider above this item when it starts a new block. */
  separatorBefore?: boolean
  /** Shown but not actionable (e.g. no pane budget left to split into). */
  disabled?: boolean
  /** Explains why the item is disabled, on hover. */
  disabledReason?: string
  /** A checked item reads as a toggle or a radio choice. */
  checked?: boolean
  /** Keep the menu open after choosing (toggles, radio groups). */
  keepOpen?: boolean
}

interface MenuProps {
  items: MenuItem[]
  onClose: () => void
  anchor?: 'top-right' | 'bottom-left' | 'pointer'
  pos?: { x: number; y: number }
  /** Context header: what the menu acts on. */
  title?: string
  /** Adds a filter field above the items. */
  searchable?: boolean
  searchPlaceholder?: string
  label?: string
}

const MARGIN = 8

function baseStyle(anchor: MenuProps['anchor'], pos?: { x: number; y: number }): React.CSSProperties {
  if (anchor === 'pointer' && pos) {
    // Hidden until measured: a menu that first paints at the pointer and then
    // jumps looks broken.
    return { top: pos.y, left: pos.x, visibility: 'hidden' }
  }
  if (anchor === 'top-right') return { top: 38, right: MARGIN }
  return { bottom: 44, left: MARGIN }
}

/**
 * One menu for the whole app. A menu is a list of actions under a context
 * header, with a visible state for toggles and radio choices. It reads as an
 * organized card, not a table of key/value rows: one short label per item, no
 * second line, and a divider where a group ends.
 *
 * Keyboard: arrows move, Home/End jump, Escape closes, Enter/Space chooses.
 * Focus returns to the trigger unless the menu was dismissed by a click or Tab.
 */
export function Menu({
  items,
  onClose,
  anchor = 'top-right',
  pos,
  title,
  searchable = false,
  searchPlaceholder,
  label,
}: MenuProps) {
  const t = useT()
  const panelId = useId()
  const placeholder = searchPlaceholder ?? t('menu.search')
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef(true)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const posRef = useRef(pos)
  posRef.current = pos
  const [query, setQuery] = useState('')
  const [style, setStyle] = useState<React.CSSProperties>(() => baseStyle(anchor, pos))

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? items.filter((item) => item.label.toLowerCase().includes(needle))
    : items
  const hasIcons = visible.some((item) => item.icon)
  const hasChecks = visible.some((item) => item.checked !== undefined)

  /** Keep the panel on screen: clamp the pointer anchor and flip near an edge. */
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = panel.getBoundingClientRect()
    const currentAnchor = anchorRef.current
    const currentPos = posRef.current

    if (currentAnchor === 'pointer' && currentPos) {
      let left = currentPos.x
      let top = currentPos.y
      if (left + rect.width > vw - MARGIN) left = currentPos.x - rect.width
      if (top + rect.height > vh - MARGIN) top = currentPos.y - rect.height
      left = Math.max(MARGIN, Math.min(left, vw - rect.width - MARGIN))
      top = Math.max(MARGIN, Math.min(top, vh - rect.height - MARGIN))
      setStyle({ top, left, maxHeight: vh - MARGIN * 2 })
      return
    }

    setStyle({
      top: currentAnchor === 'top-right' ? 38 : undefined,
      bottom: currentAnchor === 'bottom-left' ? 44 : undefined,
      left: currentAnchor === 'bottom-left' ? MARGIN : undefined,
      right: currentAnchor === 'top-right' ? MARGIN : undefined,
      maxHeight: vh - (currentAnchor === 'top-right' ? 46 : 52),
    })
  }, [anchor, pos?.x, pos?.y, query, searchable])

  // Focus the first control, and put it back where it came from on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    // The trigger advertises the menu it owns: `aria-expanded` is the state a
    // screen reader needs, and `aria-controls` points at the portalled panel.
    const previousExpanded = trigger?.getAttribute('aria-expanded') ?? null
    const previousControls = trigger?.getAttribute('aria-controls') ?? null
    if (trigger && trigger !== document.body) {
      trigger.setAttribute('aria-expanded', 'true')
      trigger.setAttribute('aria-controls', panelId)
    }
    if (searchable) searchRef.current?.focus()
    else panelRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) {
        restoreFocus.current = false
        onCloseRef.current()
      }
    }
    const onResize = () => {
      const panel = panelRef.current
      if (!panel) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const rect = panel.getBoundingClientRect()
      const currentAnchor = anchorRef.current
      const currentPos = posRef.current
      if (currentAnchor === 'pointer' && currentPos) {
        setStyle({
          top: Math.max(MARGIN, Math.min(currentPos.y, vh - rect.height - MARGIN)),
          left: Math.max(MARGIN, Math.min(currentPos.x, vw - rect.width - MARGIN)),
          maxHeight: vh - MARGIN * 2,
        })
      } else {
        setStyle((current) => ({
          ...current,
          maxHeight: vh - (currentAnchor === 'top-right' ? 46 : 52),
        }))
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', onResize)
      if (trigger && trigger !== document.body) {
        if (previousExpanded === null) trigger.removeAttribute('aria-expanded')
        else trigger.setAttribute('aria-expanded', previousExpanded)
        if (previousControls === null) trigger.removeAttribute('aria-controls')
        else trigger.setAttribute('aria-controls', previousControls)
      }
      if (restoreFocus.current && trigger?.isConnected) {
        const active = document.activeElement
        if (!active || active === document.body || !document.body.contains(active)) trigger.focus()
      }
    }
  }, [searchable, panelId])

  const moveFocus = (direction: 1 | -1 | 'first' | 'last') => {
    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? []
    )
    if (buttons.length === 0) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (direction === 'last') next = buttons.length - 1
    else if (direction === 'first') next = 0
    else if (current === -1) next = direction === 1 ? 0 : buttons.length - 1
    else next = (current + direction + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveFocus('first')
    } else if (e.key === 'End') {
      e.preventDefault()
      moveFocus('last')
    } else if (e.key === 'Tab') {
      restoreFocus.current = false
      onCloseRef.current()
    }
  }

  const choose = (item: MenuItem) => {
    if (item.disabled) return
    if (item.keepOpen) {
      item.onSelect()
      return
    }
    onCloseRef.current()
    item.onSelect()
  }

  const panel = (
    <div
      className="menu"
      id={panelId}
      role="menu"
      aria-label={label ?? title ?? t('menu.label')}
      ref={panelRef}
      style={style}
      onKeyDown={onKeyDown}
    >
      {title && (
        <div className="menu-head">
          <span className="menu-title">{title}</span>
        </div>
      )}

      {searchable && (
        <div className="menu-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
          />
          {query && (
            <button className="menu-search-clear" onClick={() => setQuery('')} aria-label={t('menu.clearSearch')}>
              <X size={12} />
            </button>
          )}
        </div>
      )}

      <div className="menu-scroll">
        {visible.length === 0 && <div className="menu-empty">{t('menu.noResults')}</div>}
        {visible.map((item, index) => (
          <Fragment key={`${item.label}-${index}`}>
            {item.separatorBefore && index > 0 && <div className="menu-sep" role="separator" />}
            <button
              className={`menu-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`}
              role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={item.checked !== undefined ? item.checked : undefined}
              aria-disabled={item.disabled ? true : undefined}
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              tabIndex={-1}
              onClick={() => choose(item)}
            >
              {hasIcons && <span className="menu-icon">{item.icon}</span>}
              <span className="menu-label">{item.label}</span>
              {hasChecks && (
                <span className="menu-check-slot" aria-hidden="true">
                  {item.checked && <Check size={14} />}
                </span>
              )}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
