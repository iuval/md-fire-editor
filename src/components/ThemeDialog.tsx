import { useT, type MessageKey } from '../i18n/index.ts'
import { useMemo } from 'react'
import { Palette as PaletteIcon } from 'lucide-react'
import { Modal } from './Modal'
import { ColorField } from './ColorField'
import { SeedSquares } from './SeedSquares'
import {
  PRESETS,
  clearOverrides,
  findPreset,
  resetToPreset,
  resolvePalette,
  selectPreset,
  setThemeState,
  setTokenOverride,
  designAppearance,
  updateSeed,
  useTheme,
  type ThemeToken,
} from '../lib/theme'

/**
 * Appearance, in one place: pick a ready-made theme, then nudge any color.
 *
 * There is no "light theme" and "dark theme" to maintain separately: one design
 * is edited, and the other appearance is mirrored from it. Every color is on
 * screen at once — nothing hides behind a "advanced" toggle — and the whole
 * panel repaints as you pick, because a palette is a thing you look at.
 */

const TOKEN_LABEL_KEYS: Record<ThemeToken, MessageKey> = {
  bg: 'themeDialog.tokenLabels.bg',
  bg2: 'themeDialog.tokenLabels.bg2',
  bg3: 'themeDialog.tokenLabels.bg3',
  page: 'themeDialog.tokenLabels.page',
  text: 'themeDialog.tokenLabels.text',
  muted: 'themeDialog.tokenLabels.muted',
  border: 'themeDialog.tokenLabels.border',
  accent: 'themeDialog.tokenLabels.accent',
  accentInk: 'themeDialog.tokenLabels.accentInk',
  accentSolid: 'themeDialog.tokenLabels.accentSolid',
  danger: 'themeDialog.tokenLabels.danger',
  success: 'themeDialog.tokenLabels.success',
  warning: 'themeDialog.tokenLabels.warning',
}

const TOKEN_HINT_KEYS: Partial<Record<ThemeToken, MessageKey>> = {
  bg2: 'themeDialog.tokenHints.bg2',
  bg3: 'themeDialog.tokenHints.bg3',
  page: 'themeDialog.tokenHints.page',
  text: 'themeDialog.tokenHints.text',
  muted: 'themeDialog.tokenHints.muted',
  border: 'themeDialog.tokenHints.border',
  accent: 'themeDialog.tokenHints.accent',
  accentInk: 'themeDialog.tokenHints.accentInk',
  accentSolid: 'themeDialog.tokenHints.accentSolid',
  danger: 'themeDialog.tokenHints.danger',
  success: 'themeDialog.tokenHints.success',
  warning: 'themeDialog.tokenHints.warning',
}

/** The two columns of the preset grid, left to right. */
const COLUMNS = ['light', 'dark'] as const

const FAMILIES: Array<{ titleKey: MessageKey; tokens: ThemeToken[] }> = [
  { titleKey: 'themeDialog.families.surfaces', tokens: ['bg2', 'bg3', 'page'] },
  { titleKey: 'themeDialog.families.text', tokens: ['text', 'muted'] },
  { titleKey: 'themeDialog.families.borders', tokens: ['border'] },
  { titleKey: 'themeDialog.families.accent', tokens: ['accentInk', 'accentSolid'] },
  { titleKey: 'themeDialog.families.states', tokens: ['danger', 'success', 'warning'] },
]

export function ThemeDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const state = useTheme()
  // The fields edit the design itself, so a tweak always lands somewhere.
  const design = designAppearance(state.seeds)
  const palette = useMemo(() => resolvePalette(state, design), [state, design])
  const chosen = findPreset(state.presetId)
  const seeds = state.seeds

  const choose = (presetId: string) => setThemeState(selectPreset(state, presetId))

  return (
    <Modal labelledBy="theme-heading" onClose={onClose} className="share theme-dialog">
      {/* Sticky: the title and Done stay reachable however far the list
          scrolls. Escape and the scrim still close the dialog. */}
      <div className="theme-bar">
        <h2 id="theme-heading" className="row" style={{ gap: 7 }}>
          <PaletteIcon size={15} />
          {t('themeDialog.heading')}
        </h2>
        <button type="button" className="btn" onClick={onClose}>
          {t('themeDialog.done')}
        </button>
      </div>

      <div className="theme-section">
        <span className="theme-section-title">{t('themeDialog.presets')}</span>
        {/* Two columns, one per appearance the design was written in: the left
            column is the light designs, the right the dark ones. Same count on
            both sides, so the grid is a choice between two worlds. */}
        <div className="theme-grid" role="group" aria-label={t('themeDialog.presetsGroup')}>
          {COLUMNS.map((column) => (
            <div key={column} className="theme-column">
              {PRESETS.filter((preset) => designAppearance(preset.seeds) === column).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="theme-card"
                  aria-pressed={preset.id === state.presetId && !state.edited}
                  onClick={() => choose(preset.id)}
                >
                  <SeedSquares canvas={preset.seeds.canvas} accent={preset.seeds.accent} />
                  <span className="theme-card-text">
                    <span className="theme-card-name">{t(preset.nameKey)}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Folded by default: picking a ready-made theme is the common path, and
          every token is still one click away. */}
      <details className="theme-advanced">
        <summary className="theme-section-title">{t('themeDialog.advanced')}</summary>
        <div className="theme-section">
        <ColorField
          label={t('themeDialog.background')}
          hint={t('themeDialog.backgroundHint')}
          value={seeds.canvas}
          suggestions="neutrals"
          onChange={(canvas) => setThemeState(updateSeed(state, { ...seeds, canvas }))}
        />
        <ColorField
          label={t('themeDialog.accent')}
          hint={t('themeDialog.accentHint')}
          value={seeds.accent}
          suggestions="accents"
          onChange={(accent) => setThemeState(updateSeed(state, { ...seeds, accent }))}
        />

        {FAMILIES.map((family) => (
          <div key={t(family.titleKey)} className="theme-family">
            <span className="theme-family-title">{t(family.titleKey)}</span>
            {family.tokens.map((token) => (
              <ColorField
                key={token}
                label={t(TOKEN_LABEL_KEYS[token])}
                hint={TOKEN_HINT_KEYS[token] ? t(TOKEN_HINT_KEYS[token]) : undefined}
                value={palette[token]}
                onReset={() => setThemeState(setTokenOverride(state, token, null))}
                onChange={(hex) => setThemeState(setTokenOverride(state, token, hex))}
              />
            ))}
          </div>
        ))}

        <p className="hint">{t('themeDialog.advancedHint')}</p>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setThemeState(clearOverrides(state))}
        >
          {t('themeDialog.clearOverrides')}
        </button>
        {/* Last in Advanced on purpose: it undoes a customisation, and this is
            the section that makes one. Folded away with everything else. */}
        <button
          type="button"
          className="btn ghost"
          onClick={() => setThemeState(resetToPreset(state))}
        >
          {t('themeDialog.reset', { name: t(chosen.nameKey) })}
        </button>
        </div>
      </details>
    </Modal>
  )
}
