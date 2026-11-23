import { ArrowDownAZ, CalendarClock, CalendarPlus, Check, GripVertical, X } from 'lucide-react'
import { Modal } from './Modal'
import { isSortMode, sortLabel, type SortMode } from '../lib/sorting'
import { useT } from '../i18n/index.ts'

const MODES: SortMode[] = ['name', 'created', 'updated', 'manual']

const MODE_ICON: Record<SortMode, React.ReactNode> = {
  name: <ArrowDownAZ size={16} />,
  created: <CalendarPlus size={16} />,
  updated: <CalendarClock size={16} />,
  manual: <GripVertical size={16} />,
}

const MODE_HINT = {
  name: 'sortDialog.nameHint',
  created: 'sortDialog.createdHint',
  updated: 'sortDialog.updatedHint',
  manual: 'sortDialog.manualHint',
} as const

/**
 * The four ways a list can be ordered, and the hint that says what each one
 * does. Shared by the folder's own dialog and by Settings, where the same
 * choice is stored for the root list.
 */
export function SortPanel({
  current,
  onChoose,
  hint,
}: {
  current: SortMode
  onChoose: (mode: SortMode) => void
  /** Overrides the folder-inheritance line; the root list has no parent. */
  hint?: string
}) {
  const t = useT()
  return (
    <>
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
              }}
            >
              <span className="sort-icon" aria-hidden="true">
                {MODE_ICON[mode]}
              </span>
              <span className="sort-text">
                <span className="sort-title">{sortLabel(mode)}</span>
                <span className="sort-desc">{t(MODE_HINT[mode])}</span>
              </span>
              {active && <Check size={14} className="sort-check" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <p className="hint">{hint ?? t('sortDialog.inheritHint')}</p>
    </>
  )
}

interface SortDialogProps {
  target: string
  current: SortMode
  onChoose: (mode: SortMode) => void
  onClose: () => void
}

/** Ordering for one folder. The root list is ordered from Settings instead. */
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

      <SortPanel
        current={current}
        onChoose={(mode) => {
          onChoose(mode)
          onClose()
        }}
      />
    </Modal>
  )
}
