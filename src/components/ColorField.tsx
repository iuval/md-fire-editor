import { RotateCcw } from 'lucide-react'
import { t } from '../i18n/index.ts'

/**
 * Ready-made colors under a picker. A fondo wants neutrals; an acento wants
 * colors — offering the other kind is noise.
 */
const SUGGESTIONS = {
  neutrals: ['#ffffff', '#faf6ee', '#f2f2f5', '#eef1f6', '#1e1e1e', '#0f1113', '#191612', '#232a35'],
  accents: ['#6f5ce0', '#4c6a92', '#1f6fb2', '#0f766e', '#2f7d4f', '#8a6a2f', '#b8490f', '#c2255c', '#a35a2a', '#55606f'],
} as const

interface ColorFieldProps {
  label: string
  value: string
  onChange: (hex: string) => void
  /** Shown next to the label, for what the color is actually used for. */
  hint?: string
  /** Omitted for the two seed colors, which always have a value. */
  onReset?: () => void
  /** Which palette of ready-made colors to offer. */
  suggestions?: keyof typeof SUGGESTIONS
}

/**
 * One color, picked visually: the swatch opens the system color picker and the
 * row below offers colors that already work. Nobody has to type a color code.
 */
export function ColorField({ label, value, onChange, hint, onReset, suggestions }: ColorFieldProps) {
  return (
    <div className="color-field">
      <label className="color-field-main">
        <input
          type="color"
          className="color-field-input"
          value={value}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="color-field-text">
          <span className="color-field-label">{label}</span>
          {hint && <span className="color-field-hint">{hint}</span>}
        </span>
      </label>
      <span className="color-field-value">{value}</span>
      {onReset && (
        <button type="button" className="icon-btn icon-btn--sm" onClick={onReset} aria-label={t('themeDialog.resetToken', { label })} title={t('themeDialog.resetTokenShort')}>
          <RotateCcw size={13} />
        </button>
      )}
      {suggestions && (
        <div className="color-swatches" role="group" aria-label={t('themeDialog.suggested', { label })}>
          {SUGGESTIONS[suggestions].map((swatch) => (
            <button
              key={swatch}
              type="button"
              className="color-swatch"
              style={{ background: swatch }}
              aria-label={`${label}: ${swatch}`}
              aria-pressed={swatch.toLowerCase() === value.toLowerCase()}
              onClick={() => onChange(swatch)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
