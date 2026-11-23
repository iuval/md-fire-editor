import { ArrowDownAZ, CalendarClock, CalendarPlus, Check, GripVertical, X } from 'lucide-react'
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
          <h2 id="sort-heading">{t('sortDialog.heading', { name: target })}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={15} />
          </button>
        </div>

        <div className="sort-list">
          {MODES.map((mode) => {
            const active = current === mode
            return (
              <button
                key={mode}
                className={`sort-card${active ? ' is-current' : ''}`}
                aria-pressed={active}
                onClick={() => {
                  if (!isSortMode(mode)) return
                  onChoose(mode)
                  onClose()
                }}
              >
                <span className="sort-icon" aria-hidden="true">
                  {mode === 'name' ? (
                    <ArrowDownAZ size={16} />
                  ) : mode === 'created' ? (
                    <CalendarPlus size={16} />
                  ) : mode === 'updated' ? (
                    <CalendarClock size={16} />
                  ) : (
                    <GripVertical size={16} />
                  )}
                </span>
                <span className="sort-text">
                  <span className="sort-title">{sortLabel(mode)}</span>
                  <span className="sort-desc">
                    {mode === 'manual'
                      ? t('sortDialog.manualHint')
                      : mode === 'updated'
                        ? t('sortDialog.updatedHint')
                        : mode === 'created'
                          ? t('sortDialog.createdHint')
                          : t('sortDialog.nameHint')}
                  </span>
                </span>
                {active && <Check size={14} className="sort-check" aria-hidden="true" />}
              </button>
            )
          })}
        </div>

        <p className="hint">{t('sortDialog.inheritHint')}</p>
    </Modal>
  )
}
