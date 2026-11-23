/**
 * The two colours of a design, as two squares you pick separately.
 *
 * They overlap on purpose — one design, seen as a surface and an ink — but each
 * square is its own control: the one behind sets the background, the one in
 * front sets the accent. That is how a combination nobody shipped gets built:
 * the surface from one card, the ink from another.
 */
interface SeedSquaresProps {
  canvas: string
  accent: string
  /** True when this square's colour is the one currently in use. */
  canvasActive: boolean
  accentActive: boolean
  /** Accessible names, already carrying the preset they come from. */
  canvasLabel: string
  accentLabel: string
  onPickCanvas: () => void
  onPickAccent: () => void
}

export function SeedSquares({
  canvas,
  accent,
  canvasActive,
  accentActive,
  canvasLabel,
  accentLabel,
  onPickCanvas,
  onPickAccent,
}: SeedSquaresProps) {
  return (
    <span className="theme-card-colors">
      <button
        type="button"
        className="theme-card-square theme-card-square--canvas"
        style={{ background: canvas }}
        aria-pressed={canvasActive}
        aria-label={canvasLabel}
        title={canvasLabel}
        onClick={onPickCanvas}
      />
      <button
        type="button"
        className="theme-card-square theme-card-square--accent"
        style={{ background: accent }}
        aria-pressed={accentActive}
        aria-label={accentLabel}
        title={accentLabel}
        onClick={onPickAccent}
      />
    </span>
  )
}
