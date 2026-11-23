import { useT, type MessageKey } from '../i18n/index.ts'
import { useMemo, useState, type KeyboardEvent } from 'react'
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
  setTypeface,
  TYPEFACES,
  TYPEFACE_STACKS,
  setTokenOverride,
  designAppearance,
  updateSeed,
  useTheme,
  type Seeds,
  type ThemeToken,
  type TypefaceId,
  type TypefaceRole,
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

const TYPEFACE_COLUMNS: Array<{ role: TypefaceRole; titleKey: MessageKey }> = [
  { role: 'note', titleKey: 'themeDialog.typefaceNote' },
  { role: 'ui', titleKey: 'themeDialog.typefaceUi' },
]

const TABS = [
  { id: 'colors', labelKey: 'themeDialog.tabColors' },
  { id: 'typeface', labelKey: 'themeDialog.tabTypeface' },
] as const

type TabId = (typeof TABS)[number]['id']

const TYPEFACE_LABEL_KEYS: Record<TypefaceId, MessageKey> = {
  sans: 'themeDialog.typefaceSans',
  serif: 'themeDialog.typefaceSerif',
  oldstyle: 'themeDialog.typefaceOldStyle',
  hybrid: 'themeDialog.typefaceHybrid',
  mono: 'themeDialog.typefaceMono',
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

  // One square, one seed: the background from this card, the ink from that one.
  // The appearance follows the resulting seeds, because a near-black background
  // is a dark design wherever the ink came from.
  const pickSeed = (patch: Partial<Seeds>) => {
    const next = updateSeed(state, { ...state.seeds, ...patch })
    setThemeState({ ...next, appearance: designAppearance(next.seeds) })
  }
  const [tab, setTab] = useState<TabId>('colors')

  // Arrow keys move between tabs, the way a tablist is expected to behave.
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next: TabId = tab === 'colors' ? 'typeface' : 'colors'
    setTab(next)
    document.getElementById(`theme-tab-${next}`)?.focus()
  }

  return (
    <Modal labelledBy="theme-heading" onClose={onClose} className="share theme-dialog">
      {/* Sticky: title, tabs and Done stay reachable however far the list
          scrolls. Escape and the scrim still close the dialog. */}
      <div className="theme-bar">
        <h2 id="theme-heading" className="row" style={{ gap: 7 }}>
          <PaletteIcon size={15} />
          {t('themeDialog.heading')}
        </h2>
        <div
          className="theme-tabs"
          role="tablist"
          aria-label={t('themeDialog.heading')}
          onKeyDown={onTabKeyDown}
        >
          {TABS.map((entry) => (
            <button
              key={entry.id}
              id={`theme-tab-${entry.id}`}
              type="button"
              role="tab"
              className="theme-tab"
              aria-selected={tab === entry.id}
              aria-controls={`theme-panel-${entry.id}`}
              tabIndex={tab === entry.id ? 0 : -1}
              onClick={() => setTab(entry.id)}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={onClose}>
          {t('themeDialog.done')}
        </button>
      </div>

      {tab === 'colors' ? (
        <div
          className="theme-panel"
          role="tabpanel"
          id="theme-panel-colors"
          aria-labelledby="theme-tab-colors"
        >
          <div className="theme-section">
            <span className="theme-section-title">{t('themeDialog.presets')}</span>
            {/* Two columns, one per appearance the design was written in: the
                left column is the light designs, the right the dark ones. Same
                count on both sides, so the grid is a choice between two worlds. */}
            <div
              className="theme-grid"
              role="group"
              aria-label={t('themeDialog.presetsGroup')}
            >
              {COLUMNS.map((column) => (
                <div key={column} className="theme-column">
                  {PRESETS.filter((preset) => designAppearance(preset.seeds) === column).map(
                    (preset) => (
                      <div key={preset.id} className="theme-card">
                        <SeedSquares
                          canvas={preset.seeds.canvas}
                          accent={preset.seeds.accent}
                          canvasActive={preset.seeds.canvas === state.seeds.canvas}
                          accentActive={preset.seeds.accent === state.seeds.accent}
                          canvasLabel={t('themeDialog.presetBackground', {
                            name: t(preset.nameKey),
                          })}
                          accentLabel={t('themeDialog.presetAccent', {
                            name: t(preset.nameKey),
                          })}
                          onPickCanvas={() => pickSeed({ canvas: preset.seeds.canvas })}
                          onPickAccent={() => pickSeed({ accent: preset.seeds.accent })}
                        />
                        {/* The name is what picks the design; the squares above
                            are colour controls, not part of the button. */}
                        <button
                          type="button"
                          className="theme-card-select"
                          aria-pressed={preset.id === state.presetId}
                          onClick={() => choose(preset.id)}
                        >
                          <span className="theme-card-name">{t(preset.nameKey)}</span>
                        </button>
                      </div>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Folded by default: picking a ready-made theme is the common path,
              and every token is still one click away. */}
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
              {/* Last in Advanced on purpose: it undoes a customisation, and
                  this is the section that makes one. */}
              <button
                type="button"
                className="btn ghost"
                onClick={() => setThemeState(resetToPreset(state))}
              >
                {t('themeDialog.reset', { name: t(chosen.nameKey) })}
              </button>
            </div>
          </details>
        </div>
      ) : (
        <div
          className="theme-panel"
          role="tabpanel"
          id="theme-panel-typeface"
          aria-labelledby="theme-tab-typeface"
        >
          <div className="theme-section">
            {/* Two roles, two columns: what you read, and what you click.
                Each option is drawn in its own face, because a typeface is
                chosen by looking at it. */}
            <div className="theme-typefaces">
              {TYPEFACE_COLUMNS.map((column) => (
                <div key={column.role} className="theme-typeface-col">
                  <span className="theme-typeface-col-title">{t(column.titleKey)}</span>
                  <div
                    className="theme-typeface-list"
                    role="group"
                    aria-label={t(column.titleKey)}
                  >
                    {TYPEFACES.map((id) => {
                      const stack = TYPEFACE_STACKS[id]
                      return (
                        <button
                          key={id}
                          type="button"
                          className="theme-typeface"
                          aria-pressed={state.typefaces[column.role] === id}
                          onClick={() => setThemeState(setTypeface(state, column.role, id))}
                        >
                          <span
                            className="typeface-name"
                            style={{ fontFamily: stack.reading }}
                          >
                            {t(TYPEFACE_LABEL_KEYS[id])}
                          </span>
                          <span
                            className="typeface-sample"
                            style={{ fontFamily: stack.heading ?? stack.reading }}
                            aria-hidden="true"
                          >
                            Aa
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
