import { X } from 'lucide-react'
import { Modal } from './Modal'
import { isSortMode, sortLabel, type SortMode } from '../lib/sorting'
import { useT } from '../i18n/index.ts'

interface SortDialogProps {
  target: string
  current: SortMode
  onChoose: (mode: SortMode) => void
  onClose: () => void
}

const MODES: SortMode[] = ['name', 'created', 'updated', 'manual']

/** Ordering for one folder (or the root list). */
export function SortDialog({ target, current, onChoose, onClose }: SortDialogProps) {
  const t = useT()
  return (
    <Modal labelledBy="sort-heading" onClose={onClose}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="sort-heading">Ordenar «{target}»</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
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
                <span className="share-option-title">{sortLabel(mode)}</span>
                <span className="share-option-desc" style={{ display: 'block' }}>
                  {mode === 'manual'
                    ? t('sortDialog.manualHint')
                    : mode === 'updated'
                      ? t('sortDialog.updatedHint')
                      : mode === 'created'
                        ? t('sortDialog.createdHint')
                        : t('sortDialog.nameHint')}
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
