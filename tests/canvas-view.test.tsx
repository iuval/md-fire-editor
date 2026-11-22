// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as Y from 'yjs'
import { CanvasSurface } from '../src/components/CanvasSurface'
import { YCanvas } from '../src/lib/canvas/yCanvas'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = readFileSync(resolve(ROOT, 'tests/fixtures/mapa-pov.canvas'), 'utf8')

let roots: Root[] = []

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom has neither, and the surface uses both.
  class NoopResizeObserver {
    observe() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    ;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
      callback: FrameRequestCallback
    ) => setTimeout(() => callback(Date.now()), 0)
  }
})

afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()))
  roots = []
  document.body.innerHTML = ''
})

function mount(ycanvas: YCanvas) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <CanvasSurface
        ycanvas={ycanvas}
        editable
        isMobile={false}
        files={[]}
        onOpenNote={() => undefined}
      />
    )
  })
  return host
}

function seeded(): YCanvas {
  const canvas = new YCanvas(new Y.Doc())
  expect(canvas.seedFromText(FIXTURE)).toBe(true)
  return canvas
}

function pointer(type: string, init: Partial<PointerEventInit> = {}) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
}

describe('CanvasSurface with a real Obsidian canvas', () => {
  it('paints every card, group and markdown run', () => {
    const host = mount(seeded())
    expect(host.querySelectorAll('.canvas-node')).toHaveLength(68)
    expect(host.querySelectorAll('.canvas-node--group')).toHaveLength(8)
    expect(host.querySelectorAll('.canvas-node--text')).toHaveLength(60)
    // The fixture's cards are bold-led: `**6/8 · El Ruso** — …`.
    expect(host.querySelectorAll('.canvas-md strong').length).toBeGreaterThan(50)
    expect(host.textContent).toContain('6/8 · El Ruso')

    const labels = Array.from(host.querySelectorAll('.canvas-group-label')).map((el) => el.textContent)
    expect(labels).toEqual(expect.arrayContaining(['1', '2', '3', '4', '6', '8']))
  })

  it('places cards with a transform in world pixels', () => {
    const host = mount(seeded())
    const canvas = seeded()
    const node = canvas.toJSON().nodes.find((item) => item.id === 'dup2')!
    const element = host.querySelector<HTMLElement>('[data-node-id="dup2"]')!
    expect(element.style.transform).toBe(`translate(${node.x}px, ${node.y}px)`)
    expect(element.style.width).toBe(`${node.width}px`)
    expect(element.style.height).toBe(`${node.height}px`)
  })

  it('shows the preset color of a card', () => {
    const host = mount(seeded())
    const colored = host.querySelector<HTMLElement>('[data-node-id="b9cdbc9821cf05cc"]')!
    expect(colored.getAttribute('style')).toContain('--canvas-preset-2')
    expect(colored.className).toContain('canvas-node--colored')
    // Color "7" is outside the documented presets and still renders.
    const unknown = host.querySelector<HTMLElement>('[data-node-id="cont2"]')!
    expect(unknown.getAttribute('style')).toContain('--canvas-preset-7')
  })

  it('selects a card on pointer down and moves it on drag', () => {
    const canvas = seeded()
    const host = mount(canvas)
    const element = host.querySelector<HTMLElement>('[data-node-id="dup2"]')!
    const before = canvas.node('dup2')!

    act(() => {
      element.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }))
      window.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 90 }))
      window.dispatchEvent(pointer('pointerup', { clientX: 130, clientY: 90 }))
    })

    expect(host.querySelector('[data-node-id="dup2"]')!.className).toContain('is-selected')
    const after = canvas.node('dup2')!
    // 120px right and 80px down in world pixels at zoom 1, then snapped to the
    // 20px grid — the default in Obsidian and here.
    expect(after.x).toBe(Math.round((before.x + 120) / 20) * 20)
    expect(after.y).toBe(Math.round((before.y + 80) / 20) * 20)
  })

  it('edits a card through the raw-markdown textarea', () => {
    const canvas = seeded()
    const host = mount(canvas)
    const element = host.querySelector<HTMLElement>('[data-node-id="dup2"]')!

    act(() => element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea.canvas-editor')
    expect(textarea).not.toBeNull()
    // While editing, the raw source is shown, exactly what Obsidian does.
    expect(textarea!.value).toBe(canvas.textOf('dup2'))

    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!
    act(() => {
      setter.call(textarea, '**nuevo** texto')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
      // React's onBlur listens to `focusout`, which bubbles (unlike `blur`).
      textarea!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    expect(canvas.textOf('dup2')).toBe('**nuevo** texto')
    expect(host.querySelector('textarea.canvas-editor')).toBeNull()
    expect(host.querySelector('[data-node-id="dup2"]')!.textContent).toBe('nuevo texto')
  })

  it('deletes the selection with Delete and adds cards from the bar', () => {
    const canvas = seeded()
    const host = mount(canvas)
    const before = canvas.toJSON().nodes.length

    const element = host.querySelector<HTMLElement>('[data-node-id="dup2"]')!
    act(() => {
      element.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }))
      window.dispatchEvent(pointer('pointerup', { clientX: 10, clientY: 10 }))
    })
    act(() => {
      host.querySelector('.canvas-surface')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })
      )
    })
    expect(canvas.toJSON().nodes.length).toBe(before - 1)

    const addButton = Array.from(host.querySelectorAll<HTMLButtonElement>('.canvas-action')).find((button) =>
      button.textContent?.includes('Tarjeta')
    )!
    act(() => addButton.click())
    expect(canvas.toJSON().nodes.length).toBe(before)
  })

  it('fits the whole canvas with Shift+1 without throwing', () => {
    const host = mount(seeded())
    const surface = host.querySelector('.canvas-surface')!
    act(() => {
      surface.dispatchEvent(
        new KeyboardEvent('keydown', { key: '!', code: 'Digit1', shiftKey: true, bubbles: true })
      )
    })
    expect(host.querySelectorAll('.canvas-node')).toHaveLength(68)
  })
})
