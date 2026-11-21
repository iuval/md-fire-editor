import { X } from 'lucide-react'
import { Modal } from './Modal'
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
  return (
    <Modal labelledBy="sort-heading" onClose={onClose}>
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
    </Modal>
  )
}
