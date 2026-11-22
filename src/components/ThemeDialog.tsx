import { useMemo } from 'react'
import { Palette as PaletteIcon, X } from 'lucide-react'
import { Modal } from './Modal'
import { ColorField } from './ColorField'
import { SeedSquares, ThemeThumb } from './ThemeThumb'
import {
  PRESETS,
  clearOverrides,
  findPreset,
  presetState,
  resetToPreset,
  resolvePalette,
  setThemeState,
  setTokenOverride,
  designAppearance,
  updateSeed,
  useSystemAppearance,
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

const TOKEN_LABELS: Record<ThemeToken, string> = {
  bg: 'Fondo general',
  bg2: 'Paneles',
  bg3: 'Rieles y campos',
  page: 'Hoja de la nota',
  text: 'Texto',
  muted: 'Texto secundario',
  border: 'Bordes',
  accent: 'Acento',
  accentInk: 'Acento en texto',
  accentSolid: 'Botones llenos',
  danger: 'Errores',
  success: 'Confirmaciones',
  warning: 'Avisos',
}

const TOKEN_HINTS: Partial<Record<ThemeToken, string>> = {
  bg2: 'Lista lateral, barras y tarjetas.',
  bg3: 'Filas activas, campos y pestañas.',
  page: 'El papel donde escribís.',
  text: 'Títulos y párrafos.',
  muted: 'Fechas, ayudas y etiquetas apagadas.',
  border: 'Separadores y contornos.',
  accent: 'Selección, foco y enlaces.',
  accentInk: 'El acento cuando es texto.',
  accentSolid: 'El acento de fondo, con letra blanca.',
  danger: 'Borrar, errores y fallos de conexión.',
  success: 'Guardado y confirmaciones.',
  warning: 'Avisos y límites.',
}

const FAMILIES: Array<{ title: string; tokens: ThemeToken[] }> = [
  { title: 'Superficies', tokens: ['bg2', 'bg3', 'page'] },
  { title: 'Texto', tokens: ['text', 'muted'] },
  { title: 'Bordes', tokens: ['border'] },
  { title: 'Acento', tokens: ['accentInk', 'accentSolid'] },
  { title: 'Estados', tokens: ['danger', 'success', 'warning'] },
]

export function ThemeDialog({ onClose }: { onClose: () => void }) {
  const state = useTheme()
  const appearance = useSystemAppearance()
  // Two palettes on purpose: the fields edit the design (so a tweak always
  // lands somewhere), while the preview shows what the OS will actually paint —
  // the mirrored half when the design and the screen disagree.
  const design = designAppearance(state.seeds)
  const palette = useMemo(() => resolvePalette(state, design), [state, design])
  const preview = useMemo(
    () => (appearance === design ? palette : resolvePalette(state, appearance)),
    [state, appearance, design, palette],
  )
  const chosen = findPreset(state.presetId)
  const seeds = state.seeds

  const choose = (presetId: string) => setThemeState(presetState(presetId))

  return (
    <Modal labelledBy="theme-heading" onClose={onClose} className="share theme-dialog">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="theme-heading" className="row" style={{ gap: 7 }}>
          <PaletteIcon size={15} />
          Apariencia
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <X size={15} />
        </button>
      </div>

      <div className="theme-preview-wrap">
        <span className="theme-section-title">Así se ve</span>
        <ThemeThumb palette={preview} />
        <p className="hint">
          {state.edited ? `«${chosen.name}», ajustado a tu gusto.` : chosen.hint}
        </p>
      </div>

      <div className="theme-section">
        <span className="theme-section-title">Temas listos</span>
        <div className="theme-grid" role="group" aria-label="Temas">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="theme-card"
              aria-pressed={preset.id === state.presetId && !state.edited}
              onClick={() => choose(preset.id)}
            >
              <SeedSquares canvas={preset.seeds.canvas} accent={preset.seeds.accent} />
              <span className="theme-card-text">
                <span className="theme-card-name">{preset.name}</span>
                <span className="theme-card-hint">{preset.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="theme-section">
        <span className="theme-section-title">Tus colores</span>
        <ColorField
          label="Fondo"
          hint="El color base de las barras y la lista."
          value={seeds.canvas}
          suggestions="neutrals"
          onChange={(canvas) => setThemeState(updateSeed(state, { ...seeds, canvas }))}
        />
        <ColorField
          label="Acento"
          hint="Selección, enlaces y botones."
          value={seeds.accent}
          suggestions="accents"
          onChange={(accent) => setThemeState(updateSeed(state, { ...seeds, accent }))}
        />

        {FAMILIES.map((family) => (
          <div key={family.title} className="theme-family">
            <span className="theme-family-title">{family.title}</span>
            {family.tokens.map((token) => (
              <ColorField
                key={token}
                label={TOKEN_LABELS[token]}
                hint={TOKEN_HINTS[token]}
                value={palette[token]}
                onReset={() => setThemeState(setTokenOverride(state, token, null))}
                onChange={(hex) => setThemeState(setTokenOverride(state, token, hex))}
              />
            ))}
          </div>
        ))}

        <p className="hint">
          Todo lo que no toques se recalcula solo para que texto, bordes y avisos se sigan leyendo.
          La otra claridad (día o noche) sale del mismo diseño.
        </p>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setThemeState(clearOverrides(state))}
        >
          Quitar mis ajustes de color
        </button>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <button type="button" className="btn ghost" onClick={() => setThemeState(resetToPreset(state))}>
          Restablecer «{chosen.name}»
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Listo
        </button>
      </div>
    </Modal>
  )
}
