/** The two colors of a theme, as the rounded squares every preset card shows. */
export function SeedSquares({ canvas, accent }: { canvas: string; accent: string }) {
  return (
    <span className="theme-card-colors">
      <span className="theme-card-square" style={{ background: canvas }} />
      <span className="theme-card-square" style={{ background: accent }} />
    </span>
  )
}
