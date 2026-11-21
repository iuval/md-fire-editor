import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  danger?: boolean
  separatorBefore?: boolean
}

interface MenuProps {
  items: MenuItem[]
  onClose: () => void
  anchor?: 'top-right' | 'bottom-left'
}

export function Menu({ items, onClose, anchor = 'top-right' }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  return (
    <div
      className="menu"
      role="menu"
      ref={ref}
      style={
        anchor === 'top-right'
          ? { top: 38, right: 8 }
          : { bottom: 44, left: 8 }
      }
    >
      {items.map((item) => (
        <div key={item.label}>
          {item.separatorBefore && <div className="menu-sep" />}
          <button
            className={`menu-item${item.danger ? ' danger' : ''}`}
            role="menuitem"
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.icon}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
