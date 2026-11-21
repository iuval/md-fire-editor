import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  /** id of the element that names the dialog. */
  labelledBy: string
  onClose: () => void
  children: React.ReactNode
  /** Extra classes on the panel (defaults to the shared `.share` shell). */
  className?: string
}

/**
 * One dialog implementation for the whole app.
 *
 * A centered panel with `role="dialog"` is not a modal until focus lives inside
 * it: before this, opening "Compartir" left focus on <body> and Tab walked
 * through the 30 controls behind the scrim. This moves focus in, keeps Tab
 * inside, restores focus on close, and marks the app root `inert` so pointer
 * and screen-reader navigation cannot reach behind the panel either.
 */
export function Modal({ labelledBy, onClose, children, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Kept in a ref so a new `onClose` identity never re-runs the mount effect
  // (which would steal focus back and re-apply `inert` on every render).
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')

    const panel = panelRef.current
    const focusables = (): HTMLElement[] => {
      if (!panel) return []
      return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
      )
    }

    const target = focusables()[0] ?? panel
    target?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const index = list.indexOf(document.activeElement as HTMLElement)
      const last = list.length - 1
      if (event.shiftKey && index <= 0) {
        event.preventDefault()
        list[last].focus()
      } else if (!event.shiftKey && (index === last || index === -1)) {
        event.preventDefault()
        list[0].focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      root?.removeAttribute('inert')
      previous?.focus?.()
    }
  }, [])

  return createPortal(
    <>
      <div className="scrim" onClick={() => closeRef.current()} aria-hidden="true" />
      <div
        className={className ?? 'share'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        ref={panelRef}
        tabIndex={-1}
      >
        {children}
      </div>
    </>,
    document.body
  )
}
