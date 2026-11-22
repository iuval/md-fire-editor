import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  canvasText,
  EMPTY_CANVAS_JSON,
  emptyCanvas,
  looksLikeCanvas,
  MAX_CANVAS_CHARS,
  newNodeId,
  parseCanvas,
  serializeCanvas,
  type CanvasDoc,
} from '../src/lib/canvas/model'
import {
  autoSides,
  edgePath,
  fitViewport,
  hitByMarquee,
  toWorld,
  unionRect,
  zoomAt,
  rectOf,
} from '../src/lib/canvas/geometry'
import { cardPlainText, parseCardMarkdown, parseInline } from '../src/lib/canvas/markdownCard'
import {
  canvasFilePath,
  normalizeCanvasPath,
  resolveCanvasFile,
} from '../src/lib/canvas/files'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** A real canvas from an Obsidian vault: the round-trip fixture. */
const FIXTURE = readFileSync(resolve(ROOT, 'tests/fixtures/mapa-pov.canvas'), 'utf8')

describe('JSON Canvas parsing', () => {
  it('reads a real Obsidian canvas', () => {
    const { canvas, dropped, duplicates } = parseCanvas(FIXTURE)
    expect(dropped).toBe(0)
    expect(duplicates).toBe(0)
    expect(canvas.nodes).toHaveLength(68)
    expect(canvas.edges).toHaveLength(0)
    expect(canvas.nodes.filter((n) => n.type === 'text')).toHaveLength(60)
    expect(canvas.nodes.filter((n) => n.type === 'group')).toHaveLength(8)
  })

  it('keeps what the spec does not describe', () => {
    const { canvas } = parseCanvas(FIXTURE)
    const group = canvas.nodes.find((n) => n.type === 'group')!
    // Obsidian writes an empty `text` on groups; dropping it would rewrite the file.
    expect(group.text).toBe('')
    expect(group.label).toBe('2')
    // Colors go past the documented 1..6 presets.
    expect(canvas.nodes.some((n) => n.color === '7')).toBe(true)
    expect(canvas.nodes.some((n) => n.color === '#ffffff')).toBe(true)
    // Ids are not required to be hex.
    expect(canvas.nodes.some((n) => n.id === 'dup2')).toBe(true)
  })

  it('serialises a real canvas back byte for byte', () => {
    const { canvas } = parseCanvas(FIXTURE)
    expect(serializeCanvas(canvas)).toBe(FIXTURE)
    expect(FIXTURE.includes('\n')).toBe(false)
    expect(FIXTURE.endsWith('\n')).toBe(false)
  })

  it('writes Obsidian separators and field order', () => {
    const canvas: CanvasDoc = {
      nodes: [
        { id: 'a1', type: 'group', text: '', x: 0, y: 0, width: 100, height: 100, label: 'G' },
        { id: 'b2', type: 'text', text: 'hola — “ñ”', x: 10, y: 20, width: 30, height: 40, color: '2' },
      ],
      edges: [],
    }
    expect(serializeCanvas(canvas)).toBe(
      '{"nodes": [' +
        '{"id": "a1", "type": "group", "text": "", "x": 0, "y": 0, "width": 100, "height": 100, "label": "G"}, ' +
        '{"id": "b2", "type": "text", "text": "hola — “ñ”", "x": 10, "y": 20, "width": 30, "height": 40, "color": "2"}' +
        '], "edges": []}'
    )
  })

  it('drops broken cards instead of the whole file, and fixes duplicate ids', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'ok', type: 'text', text: 'a', x: 0, y: 0, width: 10, height: 10 },
        { type: 'text', text: 'sin id', x: 0, y: 0, width: 10, height: 10 },
        { id: 'ok', type: 'text', text: 'repetida', x: 0, y: 0, width: 10, height: 10 },
        { id: 'raro', type: 'nuevo-tipo', texto: 'x', x: 1, y: 2, width: 3, height: 4 },
      ],
      edges: [
        { id: 'e1', fromNode: 'ok', toNode: 'raro' },
        { id: 'e2', fromNode: 'ok' },
      ],
    })
    const { canvas, dropped, duplicates } = parseCanvas(text)
    expect(dropped).toBe(2)
    expect(duplicates).toBe(1)
    expect(canvas.nodes.map((n) => n.id)).toEqual(['ok', 'ok-2', 'raro'])
    // An unknown type and an unknown field survive a save.
    expect(canvas.nodes[2]).toMatchObject({ type: 'nuevo-tipo', $extra: { texto: 'x' } })
    expect(serializeCanvas(canvas)).toContain('"type": "nuevo-tipo"')
    expect(serializeCanvas(canvas)).toContain('"texto": "x"')
    expect(canvas.edges).toHaveLength(1)
  })

  it('rejects JSON that is not a canvas', () => {
    expect(() => parseCanvas('no es json')).toThrow()
    expect(() => parseCanvas('[1, 2]')).toThrow()
    expect(looksLikeCanvas('{"nodes": []}')).toBe(true)
    expect(looksLikeCanvas('# nota')).toBe(false)
    expect(emptyCanvas()).toEqual({ nodes: [], edges: [] })
    // A canvas note created in the app starts from Obsidian's own empty file.
    expect(EMPTY_CANVAS_JSON).toBe('{"nodes": [], "edges": []}')
    expect(serializeCanvas(parseCanvas(EMPTY_CANVAS_JSON).canvas)).toBe(EMPTY_CANVAS_JSON)
  })

  it('generates 16-hex ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newNodeId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('feeds tags from card text, never from the raw JSON', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', text: 'hola #cliente', x: 0, y: 0, width: 10, height: 10, color: '#ffffff' },
        { id: 'b', type: 'group', text: '', label: 'acto 2', x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [],
    })
    expect(canvasText(parseCanvas(text).canvas)).toEqual(['hola #cliente', 'acto 2'])
    expect(MAX_CANVAS_CHARS).toBe(600_000)
  })
})

describe('rules allow a canvas kind', () => {
  it('whitelists kind and only accepts note or canvas', () => {
    const rules = readFileSync(resolve(ROOT, 'firestore.rules'), 'utf8')
    expect(rules).toContain("'kind'")
    expect(rules).toMatch(/d\.kind in \['note', 'canvas'\]/)
  })
})

describe('canvas geometry', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 }
  const b = { x: 300, y: 40, width: 100, height: 100 }

  it('picks the facing sides', () => {
    expect(autoSides(a, b)).toEqual({ fromSide: 'right', toSide: 'left' })
    expect(autoSides(b, a)).toEqual({ fromSide: 'left', toSide: 'right' })
    expect(autoSides(a, { x: 10, y: 400, width: 100, height: 100 })).toEqual({
      fromSide: 'bottom',
      toSide: 'top',
    })
  })

  it('draws an edge that leaves each card perpendicular', () => {
    const path = edgePath(a, b)
    expect(path).toMatch(/^M 100 50 C /)
    // Explicit sides are honoured.
    expect(edgePath(a, b, 'top', 'top')).toMatch(/^M 50 0 C /)
  })

  it('selects cards a marquee touches, not only covers', () => {
    const nodes = [
      { id: 'x', type: 'text', x: 0, y: 0, width: 100, height: 100 },
      { id: 'y', type: 'text', x: 500, y: 500, width: 10, height: 10 },
    ]
    const hit = hitByMarquee({ x: 90, y: 90, width: 20, height: 20 }, nodes)
    expect(hit.map((n) => n.id)).toEqual(['x'])
  })

  it('zooms around the pointer and fits the content', () => {
    const view = { x: 0, y: 0, zoom: 1 }
    const zoomed = zoomAt(view, { x: 200, y: 100 }, 2)
    expect(zoomed).toEqual({ x: -200, y: -100, zoom: 2 })
    // The point under the cursor stays under the cursor.
    const world = toWorld(zoomed, { x: 200, y: 100 }, { x: 0, y: 0 })
    expect(world).toEqual({ x: 200, y: 100 })

    const bounds = unionRect([rectOf(a), rectOf(b)])!
    const fitted = fitViewport(bounds, { width: 800, height: 600 }, 40)
    expect(fitted.zoom).toBeLessThanOrEqual(1)
    expect(fitted.zoom).toBeGreaterThan(0)
    // Content is centred.
    const centre = { x: (bounds.x + bounds.width / 2) * fitted.zoom + fitted.x, y: (bounds.y + bounds.height / 2) * fitted.zoom + fitted.y }
    expect(centre.x).toBeCloseTo(400, 0)
    expect(centre.y).toBeCloseTo(300, 0)
    expect(fitViewport(null, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})

describe('card markdown', () => {
  it('renders the fixture cards: bold, em dashes, accents and emoji', () => {
    const blocks = parseCardMarkdown(
      '**6/8 · El Ruso** — Sin plata, entra en una tienda. ❌ → **nada**'
    )
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.kind).toBe('paragraph')
    if (block.kind !== 'paragraph') throw new Error('paragraph expected')
    expect(block.lines[0]).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: '6/8 · El Ruso' }] },
      { kind: 'text', text: ' — Sin plata, entra en una tienda. ❌ → ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'nada' }] },
    ])
  })

  it('keeps hard line breaks inside one paragraph', () => {
    const blocks = parseCardMarkdown('linea uno\nlinea dos')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' })
    const paragraph = blocks[0] as Extract<(typeof blocks)[number], { kind: 'paragraph' }>
    expect(paragraph.lines).toHaveLength(2)
  })

  it('handles headings, lists, tasks, quotes and fences', () => {
    const blocks = parseCardMarkdown(
      ['# Título', '', '- uno', '- dos', '', '1. a', '2. b', '', '> cita', '', '```js', 'x()', '```'].join('\n')
    )
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'list',
      'list',
      'quote',
      'code',
    ])
    const task = parseCardMarkdown('- [x] hecho\n- [ ] pendiente')[0]
    expect(task).toMatchObject({ kind: 'list', items: [{ checked: true }, { checked: false }] })
  })

  it('supports inline code, links, wikilinks, tags and strike', () => {
    expect(parseInline('`a**b**` **c** ~~d~~ [[nota|alias]] [e](https://x.y) #tag')).toEqual([
      { kind: 'code', text: 'a**b**' },
      { kind: 'text', text: ' ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' ' },
      { kind: 'strike', children: [{ kind: 'text', text: 'd' }] },
      { kind: 'text', text: ' ' },
      { kind: 'wikilink', target: 'nota', label: 'alias' },
      { kind: 'text', text: ' ' },
      { kind: 'link', href: 'https://x.y', children: [{ kind: 'text', text: 'e' }] },
      { kind: 'text', text: ' ' },
      { kind: 'tag', tag: 'tag' },
    ])
  })

  it('leaves unmatched markers and HTML literal', () => {
    expect(parseInline('**suelto y <b>html</b>')).toEqual([
      { kind: 'text', text: '**suelto y <b>html</b>' },
    ])
    expect(parseInline('snake_case y 2*3')).toEqual([{ kind: 'text', text: 'snake_case y 2*3' }])
  })

  it('produces plain text for titles', () => {
    expect(cardPlainText('**hola** — [[nota|alias]] `x`')).toBe('hola — alias x')
  })
})

describe('file cards resolve to notes by path', () => {
  const refs = [
    { id: 'n1', title: 'Acto 1', path: 'GUIONES/Acto 1.md' },
    { id: 'n2', title: 'Personajes', path: 'Personajes.md' },
    { id: 'n3', title: 'Notas', path: 'A/Notas.md' },
    { id: 'n4', title: 'Notas', path: 'B/Notas.md' },
  ]

  it('matches the exact vault path, case and slash insensitive', () => {
    expect(resolveCanvasFile(refs, 'GUIONES/Acto 1.md')?.id).toBe('n1')
    expect(resolveCanvasFile(refs, './guiones/acto 1')?.id).toBe('n1')
    expect(resolveCanvasFile(refs, 'Personajes')?.id).toBe('n2')
  })

  it('falls back to a unique title after the note moved folders', () => {
    expect(resolveCanvasFile(refs, 'OLD/Acto 1.md')?.id).toBe('n1')
    // Two notes share the title: guessing would open the wrong one.
    expect(resolveCanvasFile(refs, 'C/Notas.md')).toBeNull()
    expect(resolveCanvasFile(refs, 'no existe')).toBeNull()
  })

  it('writes the current path back on export', () => {
    expect(canvasFilePath(refs[0])).toBe('GUIONES/Acto 1.md')
    expect(normalizeCanvasPath('GUIONES\\Acto 1')).toBe('guiones/acto 1.md')
  })
})
