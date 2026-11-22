import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { parseCanvas, serializeCanvas, type CanvasDoc } from '../src/lib/canvas/model'
import { minimalTextDiff, YCanvas } from '../src/lib/canvas/yCanvas'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = readFileSync(resolve(ROOT, 'tests/fixtures/mapa-pov.canvas'), 'utf8')

/**
 * Two clients of the same note. Nothing is wired automatically: the provider
 * carries updates in blocks, and a real concurrent edit is two people offline,
 * so the test decides when the exchange happens.
 */
function pair(): { a: YCanvas; b: YCanvas; sync: () => void } {
  const da = new Y.Doc()
  const db = new Y.Doc()
  const a = new YCanvas(da)
  const b = new YCanvas(db)
  const sync = () => {
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da), 'remote')
    Y.applyUpdate(da, Y.encodeStateAsUpdate(db), 'remote')
  }
  return { a, b, sync }
}

describe('YCanvas', () => {
  it('seeds a real canvas and reads it back identically', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    expect(canvas.isEmpty()).toBe(true)
    expect(canvas.seedFromText(FIXTURE)).toBe(true)
    expect(serializeCanvas(canvas.toJSON())).toBe(FIXTURE)
    // A second view of the same note must not seed twice.
    expect(canvas.seedFromText(FIXTURE)).toBe(false)
    expect(canvas.toJSON().nodes).toHaveLength(68)
  })

  it('never lets undo erase what it did not do', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    canvas.seedFromText(FIXTURE)
    expect(canvas.canUndo()).toBe(false)

    canvas.updateNodes([{ id: 'dup2', patch: { x: 999 } }])
    expect(canvas.node('dup2')!.x).toBe(999)
    expect(canvas.canUndo()).toBe(true)
    canvas.undoStep()
    expect(canvas.node('dup2')!.x).not.toBe(999)

    // An external body write is not this user's edit either.
    canvas.applyExternal({ nodes: [{ id: 'dup2', type: 'text', text: 'x', x: 5, y: 5, width: 10, height: 10 }], edges: [] })
    expect(canvas.canUndo()).toBe(false)
  })

  it('merges concurrent moves and concurrent typing in one card', () => {
    const { a, b, sync } = pair()
    a.seedFromText(FIXTURE)
    sync()
    expect(b.toJSON().nodes).toHaveLength(68)

    // Two people, offline, drag different cards and type in the same card.
    const before = a.textOf('dup2')
    a.updateNodes([{ id: 'dup2', patch: { x: 1000 } }])
    b.updateNodes([{ id: 'rel1', patch: { y: -1000 } }])
    a.setText('dup2', `A ${before}`)
    b.setText('dup2', `${before} B`)
    sync()

    for (const canvas of [a, b]) {
      expect(canvas.node('dup2')!.x).toBe(1000)
      expect(canvas.node('rel1')!.y).toBe(-1000)
      // Both inserts survive: the card text is a real CRDT, not last-write-wins.
      expect(canvas.textOf('dup2')).toBe(`A ${before} B`)
    }
  })

  it('deletes a card together with its connections', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    canvas.seed({
      nodes: [
        { id: 'n1', type: 'text', text: 'uno', x: 0, y: 0, width: 100, height: 100 },
        { id: 'n2', type: 'text', text: 'dos', x: 200, y: 0, width: 100, height: 100 },
      ],
      edges: [
        { id: 'e1', fromNode: 'n1', toNode: 'n2' },
        { id: 'e2', fromNode: 'n2', toNode: 'n1', label: 'vuelta' },
      ],
    })
    canvas.removeNodes(['n1'])
    expect(canvas.toJSON().nodes.map((n) => n.id)).toEqual(['n2'])
    // Both directions pointed at n1.
    expect(canvas.toJSON().edges).toHaveLength(0)
  })

  it('keeps z-order: selecting brings a card to the front, in the file too', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    canvas.seed({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 },
        { id: 'b', type: 'text', x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [],
    })
    expect(canvas.toJSON().nodes.map((n) => n.id)).toEqual(['a', 'b'])
    canvas.bringToFront(['a'])
    expect(canvas.toJSON().nodes.map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('reconciles an external canvas by id, without dropping local cards', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    canvas.seed({
      nodes: [
        { id: 'keep', type: 'text', text: 'local', x: 0, y: 0, width: 10, height: 10 },
        { id: 'gone', type: 'text', text: 'externo', x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [],
    })
    const incoming: CanvasDoc = {
      nodes: [
        { id: 'keep', type: 'text', text: 'local', x: 50, y: 0, width: 10, height: 10, color: '3' },
        { id: 'new', type: 'text', text: 'nuevo', x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [],
    }
    canvas.applyExternal(incoming)
    const json = canvas.toJSON()
    expect(json.nodes.map((n) => n.id).sort()).toEqual(['keep', 'new'])
    expect(canvas.node('keep')).toMatchObject({ x: 50, color: '3' })
  })

  it('serialises an edited canvas in Obsidian format', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    canvas.seed({ nodes: [], edges: [] })
    canvas.addNode({ id: 'n1', type: 'text', text: 'hola', x: 20, y: 40, width: 250, height: 60 })
    canvas.addEdge({ id: 'e1', fromNode: 'n1', toNode: 'n1', fromEnd: 'none' })
    expect(serializeCanvas(canvas.toJSON())).toBe(
      '{"nodes": [{"id": "n1", "type": "text", "text": "hola", "x": 20, "y": 40, "width": 250, "height": 60}], ' +
        '"edges": [{"id": "e1", "fromNode": "n1", "fromEnd": "none", "toNode": "n1"}]}'
    )
  })

  it('notifies subscribers once per change and stops when destroyed', () => {
    const canvas = new YCanvas(new Y.Doc())
    let calls = 0
    const off = canvas.subscribe(() => calls++)
    canvas.addNode({ id: 'n', type: 'text', x: 0, y: 0, width: 10, height: 10 })
    expect(calls).toBeGreaterThan(0)
    const seen = calls
    off()
    canvas.addNode({ id: 'm', type: 'text', x: 0, y: 0, width: 10, height: 10 })
    expect(calls).toBe(seen)
  })

  it('keeps the file readable: parse → seed → write is stable', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    const parsed = parseCanvas(FIXTURE).canvas
    canvas.seed(parsed)
    const first = serializeCanvas(canvas.toJSON())
    const again = new YCanvas(new Y.Doc())
    again.seed(parseCanvas(first).canvas)
    expect(serializeCanvas(again.toJSON())).toBe(first)
    expect(first).toBe(FIXTURE)
  })
})

describe('editing a real file', () => {
  it('rewrites only the card that moved', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    canvas.seedFromText(FIXTURE)
    // Nothing was touched: the file is byte-identical (opening it is not an edit).
    expect(serializeCanvas(canvas.toJSON())).toBe(FIXTURE)

    const before = canvas.node('dup2')!
    canvas.updateNodes([{ id: 'dup2', patch: { x: before.x + 40 } }])
    const after = serializeCanvas(canvas.toJSON())

    // The JSON stays single-line and in Obsidian's format: the diff is the x of
    // one card, not the whole file.
    let prefix = 0
    while (prefix < FIXTURE.length && FIXTURE[prefix] === after[prefix]) prefix++
    let suffix = 0
    while (
      suffix < FIXTURE.length - prefix &&
      FIXTURE[FIXTURE.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix++
    }
    const changed = after.slice(prefix, after.length - suffix)
    expect(after.includes('\n')).toBe(false)
    expect(changed.length).toBeLessThan(80)
    expect(after).toContain(`"x": ${before.x + 40}, "y": ${before.y}`)
    // Only the digits that actually differ: "-285" → "-245" is a 1-char diff.
    expect(changed.length).toBeLessThanOrEqual(3)
  })
})

describe('sync budget', () => {
  it('seeds a real canvas inside one Firestore block', () => {
    const doc = new Y.Doc()
    const canvas = new YCanvas(doc)
    canvas.seedFromText(FIXTURE)
    const update = Y.encodeStateAsUpdate(doc)
    // Rules: a block is at most 500.000 bytes and 620.000 base64 characters.
    // The provider refuses (and drops) anything past 600.000 characters.
    const base64 = Math.ceil(update.byteLength / 3) * 4
    expect(update.byteLength).toBeLessThan(450_000)
    expect(base64).toBeLessThan(560_000)
  })
})

describe('minimalTextDiff', () => {
  it('turns an edit into one insert/delete', () => {
    expect(minimalTextDiff('hola mundo', 'hola mundo!')).toEqual({ index: 10, remove: 0, insert: '!' })
    expect(minimalTextDiff('hola mundo', 'chau mundo')).toEqual({ index: 0, remove: 4, insert: 'chau' })
    expect(minimalTextDiff('abc', 'abc')).toEqual({ index: 0, remove: 0, insert: '' })
    expect(minimalTextDiff('', 'nuevo')).toEqual({ index: 0, remove: 0, insert: 'nuevo' })
    expect(minimalTextDiff('borrame', '')).toEqual({ index: 0, remove: 7, insert: '' })
  })
})
