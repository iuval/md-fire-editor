import { useEffect } from 'react'
import { X } from 'lucide-react'
import { SORT_LABELS, isSortMode, type SortMode } from '../lib/sorting'

interface SortDialogProps {
  target: string
  current: SortMode
  onChoose: (mode: SortMode) => void
  onClose: () => void
}

const MODES: SortMode[] = ['name', 'created', 'updated', 'manual']

/** Ordering for one folder (or the root list). */
export function SortDialog({ target, current, onChoose, onClose }: SortDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="share" role="dialog" aria-modal="true" aria-labelledby="sort-heading">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="sort-heading">Ordenar «{target}»</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {MODES.map((mode) => (
            <button
              key={mode}
              className="share-option"
              aria-pressed={current === mode}
              onClick={() => {
                if (!isSortMode(mode)) return
                onChoose(mode)
                onClose()
              }}
            >
              <span>
                <span className="share-option-title">{SORT_LABELS[mode]}</span>
                <span className="share-option-desc" style={{ display: 'block' }}>
                  {mode === 'manual'
                    ? 'Usá «Subir» y «Bajar» para mover carpetas y notas.'
                    : mode === 'updated'
                      ? 'Lo último que tocaste queda arriba.'
                      : mode === 'created'
                        ? 'Lo más viejo primero.'
                        : 'Orden alfabético.'}
                </span>
              </span>
            </button>
          ))}
        </div>

        <p className="hint">
          Las carpetas creadas dentro de esta heredan el orden, salvo que les pongas uno propio.
        </p>
      </div>
    </>
  )
}
