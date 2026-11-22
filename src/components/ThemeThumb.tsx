import type { Palette } from '../lib/theme'

/**
 * A miniature of the editor, painted with a palette.
 *
 * Nothing here is a screenshot or a borrowed image: the shape is the app's own
 * layout (sidebar, note surface, tag pills, primary button) so the design can be
 * judged before it is used. Purely decorative, hence aria-hidden.
 */
export function ThemeThumb({ palette }: { palette: Palette }) {
  const line = palette.border
  return (
    <div className="theme-thumb" style={{ background: palette.bg, borderColor: line }} aria-hidden="true">
      <div className="theme-thumb-side" style={{ background: palette.bg2, borderColor: line }}>
        <span className="theme-thumb-brand" style={{ background: palette.text, opacity: 0.85 }} />
        <span className="theme-thumb-row" style={{ background: palette.accentSolid, opacity: 0.9 }} />
        <span className="theme-thumb-row" style={{ background: palette.muted, opacity: 0.5 }} />
        <span className="theme-thumb-row" style={{ background: palette.muted, opacity: 0.35 }} />
        <span
          className="theme-thumb-row theme-thumb-row--short"
          style={{ background: palette.muted, opacity: 0.3 }}
        />
        <span className="theme-thumb-row" style={{ background: palette.muted, opacity: 0.22 }} />
      </div>

      <div className="theme-thumb-main">
        <div className="theme-thumb-bar" style={{ background: palette.bg2, borderColor: line }}>
          <span className="theme-thumb-dot" style={{ background: palette.bg3, borderColor: line }} />
          <span className="theme-thumb-dot" style={{ background: palette.bg3, borderColor: line }} />
          <span className="theme-thumb-dot" style={{ background: palette.bg3, borderColor: line }} />
          <span className="theme-thumb-toolbar-pill" style={{ background: palette.accentInk, opacity: 0.55 }} />
        </div>

        <div className="theme-thumb-sheet" style={{ background: palette.page }}>
          <span className="theme-thumb-title" style={{ color: palette.text }}>
            Apuntes del día
          </span>
          <span className="theme-thumb-line" style={{ background: palette.text, opacity: 0.75 }} />
          <span className="theme-thumb-line" style={{ background: palette.muted, opacity: 0.6 }} />
          <span
            className="theme-thumb-line theme-thumb-line--short"
            style={{ background: palette.muted, opacity: 0.5 }}
          />

          <div className="theme-thumb-hero">
            <span className="theme-thumb-hero-title" style={{ background: palette.text, opacity: 0.85 }} />
            <span className="theme-thumb-hero-line" style={{ background: palette.muted, opacity: 0.55 }} />
            <div className="theme-thumb-pills">
              <span
                className="theme-thumb-pill"
                style={{ color: palette.accentInk, background: palette.bg3 }}
              >
                diario
              </span>
              <span
                className="theme-thumb-pill"
                style={{ color: palette.accentInk, background: palette.bg3 }}
              >
                ideas
              </span>
            </div>
            <div className="theme-thumb-actions">
              <span className="theme-thumb-button" style={{ background: palette.accentSolid }}>
                Compartir
              </span>
              <span
                className="theme-thumb-button theme-thumb-button--ghost"
                style={{ borderColor: line, color: palette.text }}
              >
                Exportar
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The two colors of a theme, as the rounded squares every preset card shows. */
export function SeedSquares({ canvas, accent }: { canvas: string; accent: string }) {
  return (
    <span className="theme-card-colors">
      <span className="theme-card-square" style={{ background: canvas }} />
      <span className="theme-card-square" style={{ background: accent }} />
    </span>
  )
}
