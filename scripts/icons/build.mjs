/**
 * Builds every logo/icon asset from the single geometry source in
 * `./mark.mjs`. Run with `npm run icons` after touching the artwork.
 *
 * The generated files are committed, so neither the app build nor CI needs
 * this script. It shells out to macOS tooling on purpose:
 *   - `qlmanage` rasterises SVG through WebKit (the browser renderer, so what
 *     you check is what a browser shows);
 *   - ImageMagick (`magick`) rescales, masks the rounded corners back to
 *     transparency (qlmanage flattens them onto white) and assembles the .ico.
 *
 * Colours come from the app's own palette (`src/index.css`), so the icon can
 * never drift from the UI: purple accent on the dark canvas.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CARD, FLAME, FLICK, RULES, STROKE } from './mark.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PUB = join(ROOT, 'public')
const TMP = mkdtempSync(join(tmpdir(), 'firemd-icons-'))

// ---- palette (src/index.css) ------------------------------------------------
const DARK = '#1e1e1e' // --color-bg-dark
const PURPLE = '#8b7cf8' // --color-accent-dark: the mark on dark surfaces
const TEXT = '#dadada' // --color-text-dark
const MUTED = '#a8a8a8' // --color-muted-dark

// ---- geometry ---------------------------------------------------------------
// Ink bounding box of the raw 512-unit artwork, including the stroke radius.
const BOX = { x0: 54, y0: 13, x1: 475, y1: 489 }

/**
 * Lays the mark out inside a 512-unit square.
 * `pad` is the empty margin around the ink, `stroke` is the weight the stroke
 * keeps *after* scaling (small sizes need a heavier line than 512px art), and
 * `rules` trims the ruled lines — three of them turn to mush at 16px.
 */
function markPaths({ stroke = STROKE, pad = 0, rules = RULES.length }) {
  const w = BOX.x1 - BOX.x0
  const h = BOX.y1 - BOX.y0
  const scale = (512 - pad * 2) / Math.max(w, h)
  const tx = 256 - ((BOX.x0 + BOX.x1) / 2) * scale
  const ty = 256 - ((BOX.y0 + BOX.y1) / 2) * scale
  const paths = [FLAME, FLICK, CARD, ...RULES.slice(0, rules)]
    .map(d => `    <path d="${d.replace(/\s+/g, ' ').replace(/ ?([MLCZ])/g, ' $1').trim()}"/>`)
    .join('\n')
  return `<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale.toFixed(4)})" fill="none" stroke-width="${(stroke / scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">
${paths}
  </g>`
}

function svg({ color = PURPLE, bg = null, rx = 0, ...art }) {
  const backdrop = bg ? `  <rect width="512" height="512"${rx ? ` rx="${rx}"` : ''} fill="${bg}"/>\n` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" stroke="${color}">
${backdrop}  ${markPaths(art).trim()}
</svg>
`
}

// ---- rasterising ------------------------------------------------------------
function rasterise(svgSource, px, name) {
  const svgPath = join(TMP, `${name}.svg`)
  const pngPath = join(TMP, `${name}.png`)
  writeFileSync(svgPath, svgSource)
  execFileSync('qlmanage', ['-t', '-s', String(px), '-o', TMP, svgPath], { stdio: 'ignore' })
  execFileSync('mv', [join(TMP, `${name}.svg.png`), pngPath])
  return pngPath
}

/** qlmanage flattens SVG transparency onto white; punch the corners back out. */
function roundCorners(pngPath, px, radius) {
  const mask = join(TMP, 'mask.png')
  execFileSync('magick', ['-size', `${px}x${px}`, 'xc:black', '-fill', 'white',
    '-draw', `roundrectangle 0,0,${px - 1},${px - 1},${radius},${radius}`, mask])
  execFileSync('magick', [pngPath, mask, '-alpha', 'off', '-compose', 'CopyOpacity',
    '-composite', pngPath])
}

function write(file, data) {
  writeFileSync(join(PUB, file), data)
  console.log(`  ${file}`)
}

// ---- 1. standalone mark (docs, README, in-app use) --------------------------
write('mark.svg', svg({ stroke: 18, pad: 10 }))

// ---- 2. favicon: bold line, two ruled lines, near edge-to-edge --------------
// A tab renders this at 16px, where 0.55px strokes disappear and three ruled
// lines fuse into a block. Heavier line + one line fewer keeps it readable.
const favicon = svg({ bg: DARK, rx: 112, stroke: 26, pad: 34, rules: 2 })
write('favicon.svg', favicon)

// ---- 3. app icon (PWA "any", og fallback) ----------------------------------
const appIcon = svg({ bg: DARK, rx: 112, stroke: 18, pad: 52 })
write('icon.svg', appIcon)

for (const px of [192, 512]) {
  const png = rasterise(appIcon, px, `icon-${px}`)
  roundCorners(png, px, Math.round((112 / 512) * px))
  write(`icon-${px}.png`, readFileSync(png))
}

// ---- 4. maskable icon: full bleed, mark inside the 80% safe circle ---------
const maskable = svg({ bg: DARK, stroke: 18, pad: 84 })
write('icon-maskable-512.png', readFileSync(rasterise(maskable, 512, 'maskable')))

// ---- 5. iOS home screen: opaque, iOS applies its own corner mask -----------
write('apple-touch-icon.png', readFileSync(rasterise(svg({ bg: DARK, stroke: 18, pad: 60 }), 180, 'apple')))

// ---- 6. favicon.ico: square corners, legacy browsers and Windows -----------
const icoPngs = [16, 32, 48].map(px =>
  rasterise(svg({ bg: DARK, stroke: 26, pad: 34, rules: 2 }), px, `ico-${px}`))
execFileSync('magick', [...icoPngs, join(PUB, 'favicon.ico')])
console.log('  favicon.ico')

// ---- 7. social card -------------------------------------------------------
const OG_W = 1200
const OG_H = 630
const lockUp = (x, y, markSize) => `<g transform="translate(${x} ${y})">
      <svg width="${markSize}" height="${markSize}" viewBox="0 0 512 512" stroke="${PURPLE}">
        ${markPaths({ stroke: 20, pad: 20 }).trim()}
      </svg>
    </g>`

// qlmanage squares its thumbnail and rescales non-square SVG unpredictably, so
// the 1200x630 card is drawn centred in a 1200x1200 square and cropped back.
const inner = `<g transform="translate(0 ${(OG_W - OG_H) / 2})">
    <defs>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${PURPLE}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${PURPLE}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="430" cy="${OG_H / 2}" rx="330" ry="300" fill="url(#glow)"/>
    ${lockUp(172, 155, 320)}
    <text x="534" y="300" fill="${TEXT}" font-family="Inter, -apple-system, Helvetica Neue, sans-serif"
          font-size="84" font-weight="700" letter-spacing="-2">FireMD</text>
    <text x="538" y="362" fill="${MUTED}" font-family="Inter, -apple-system, Helvetica Neue, sans-serif"
          font-size="30" font-weight="450">Notas en Markdown, colaborativas</text>
  </g>`
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_W}" viewBox="0 0 ${OG_W} ${OG_W}">
  <style>@font-face{font-family:"Inter";src:url("${join(ROOT, 'public/fonts/inter-latin-var.woff2')}") format("woff2");font-weight:100 900}</style>
  <rect width="${OG_W}" height="${OG_W}" fill="${DARK}"/>
  ${inner}
</svg>
`
const ogPng = rasterise(og, OG_W, 'og')
const ogCropped = join(TMP, 'og-cropped.png')
execFileSync('magick', [ogPng, '-crop', `${OG_W}x${OG_H}+0+${(OG_W - OG_H) / 2}`, '+repage', ogCropped])
write('og-image.png', readFileSync(ogCropped))

rmSync(TMP, { recursive: true, force: true })
console.log('icons built')
