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
  anchor?: 'top-right' | 'bottom-left' | 'pointer'
  pos?: { x: number; y: number }
}

export function Menu({ items, onClose, anchor = 'top-right', pos }: MenuProps) {
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

  const style: React.CSSProperties =
    anchor === 'pointer' && pos
      ? {
          // Callers pass a preferred anchor; clamping here keeps the panel on
          // screen at both edges instead of relying on magic offsets.
          top: Math.max(8, Math.min(pos.y, window.innerHeight - 240)),
          left: Math.max(8, Math.min(pos.x, window.innerWidth - 220)),
        }
      : anchor === 'top-right'
        ? { top: 38, right: 8 }
        : { bottom: 44, left: 8 }

  return (
    <div className="menu" role="menu" ref={ref} style={style}>
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
