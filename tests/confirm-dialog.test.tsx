// @vitest-environment jsdom
/**
 * La confirmación de borrar es un diálogo de la app, no el `window.confirm` del
 * navegador: se lee como parte del producto, sigue el tema y no bloquea la
 * página.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfirmDialog } from '../src/components/ConfirmDialog'
import { t } from '../src/i18n/index.ts'

let roots: Root[] = []
let host: HTMLDivElement | null = null

function mount(
  over: { onConfirm?: () => void | Promise<void>; onClose?: () => void; body?: string } = {}
) {
  const onConfirm = over.onConfirm ?? vi.fn()
  const onClose = over.onClose ?? vi.fn()
  host = document.createElement('div')
  host.id = 'root'
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() =>
    root.render(
      <ConfirmDialog
        title="Delete “Recipes”?"
        body={over.body}
        confirmLabel={t('common.delete')}
        busyLabel={t('common.deleting')}
        danger
        onConfirm={onConfirm}
        onClose={onClose}
      />
    )
  )
  return { onConfirm, onClose }
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
}

afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()))
  roots = []
  document.body.innerHTML = ''
  host = null
})

describe('ConfirmDialog', () => {
  it('asks the question in the app, under a heading a screen reader reads', () => {
    mount()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.querySelector('#confirm-heading')?.textContent).toBe('Delete “Recipes”?')
    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      t('common.cancel'),
      t('common.delete'),
    ])
  })

  it('says what pressing the button does', () => {
    mount({ body: t('note.deleteBody') })
    expect(document.querySelector('.share-hint-box')?.textContent).toBe(t('note.deleteBody'))
  })

  it('marks the action as destructive', () => {
    mount()
    const confirm = buttons()[1]
    expect(confirm.className).toContain('danger')
    expect(buttons()[0].className).toContain('ghost')
  })

  it('focuses Cancel first, so Enter is the safe answer', () => {
    mount()
    expect(document.activeElement).toBe(buttons()[0])
  })

  it('confirms and closes', async () => {
    const { onConfirm, onClose } = mount()
    await act(async () => buttons()[1].click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('waits for a slow action, saying what it is doing', async () => {
    let settle: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      settle = resolve
    })
    const onConfirm = vi.fn(() => pending)
    const onClose = vi.fn()
    mount({ onConfirm, onClose })

    await act(async () => buttons()[1].click())

    // Still open, and the button says the work is running.
    expect(onClose).not.toHaveBeenCalled()
    expect(buttons()[1].textContent).toBe('Deleting…')
    expect(buttons()[1].getAttribute('aria-busy')).toBe('true')
    expect(buttons()[1].disabled).toBe(true)
    // A second click cannot fire the action twice.
    buttons()[1].click()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      settle()
      await pending
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog open on a refusal and says why', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('This folder still holds notes written by other accounts.')
    })
    const onClose = vi.fn()
    mount({ onConfirm, onClose })

    await act(async () => buttons()[1].click())

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'This folder still holds notes written by other accounts.'
    )
    // The action can be tried again.
    expect(buttons()[1].disabled).toBe(false)
    expect(buttons()[1].textContent).toBe(t('common.delete'))
  })

  it('can be dismissed while the action is still running', async () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => {}))
    const onClose = vi.fn()
    mount({ onConfirm, onClose })

    await act(async () => buttons()[1].click())
    expect(buttons()[1].textContent).toBe('Deleting…')

    await act(async () => buttons()[0].click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cancels without running the action', async () => {
    const { onConfirm, onClose } = mount()
    await act(async () => buttons()[0].click())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape is a no', async () => {
    const { onConfirm, onClose } = mount()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('deleting asks here, not in a browser popup', () => {
  it('the app never calls window.confirm', () => {
    // A regression guard: the two delete questions used to be window.confirm,
    // which blocks the page, ignores the theme and cannot be styled.
    const app = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/AppTree.tsx'),
      'utf8'
    )
    expect(app).not.toContain('window.confirm')
    expect(app).not.toContain('confirm(')
  })
})
