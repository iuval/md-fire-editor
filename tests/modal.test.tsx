// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Modal } from '../src/components/Modal'

let roots: Root[] = []
let host: HTMLDivElement | null = null

function mount(ui: React.ReactNode) {
  host = document.createElement('div')
  host.id = 'root'
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(ui))
  return { root, host }
}

afterEach(() => {
  roots.forEach((r) => act(() => r.unmount()))
  roots = []
  document.body.innerHTML = ''
  host = null
})

function press(key: string, shiftKey = false) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
  })
}

const dialog = (onClose: () => void) => (
  <Modal labelledBy="h" onClose={onClose}>
    <h2 id="h">Compartir</h2>
    <button>uno</button>
    <button>dos</button>
    <button>tres</button>
  </Modal>
)

describe('Modal', () => {
  it('moves focus into the panel on open', () => {
    mount(dialog(() => {}))
    expect(document.activeElement?.textContent).toBe('uno')
  })

  it('marks the app root inert so the page behind is unreachable', () => {
    const { host } = mount(dialog(() => {}))
    expect(host.hasAttribute('inert')).toBe(true)
  })

  it('wraps Tab from the last control to the first and Shift+Tab backwards', () => {
    mount(dialog(() => {}))
    const buttons = [...document.querySelectorAll('[role="dialog"] button')] as HTMLElement[]

    buttons[2].focus()
    press('Tab')
    expect(document.activeElement).toBe(buttons[0])

    buttons[0].focus()
    press('Tab', true)
    expect(document.activeElement).toBe(buttons[2])
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    mount(dialog(onClose))
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores focus to whatever was focused before it opened', () => {
    const opener = document.createElement('button')
    opener.textContent = 'abrir'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { root } = mount(dialog(() => {}))
    act(() => root.unmount())
    roots = roots.filter((r) => r !== root)

    expect(document.activeElement).toBe(opener)
  })
})
