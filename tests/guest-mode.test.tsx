// @vitest-environment jsdom
/**
 * The visitor's editor: the real editor stack (Tiptap + Yjs + markdown) with no
 * Firestore document behind it, the draft in the browser, and the discovery
 * strip only in the guest context. The login wall stays for shared-note links
 * (see shouldShowGuestView).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GuestWorkspace } from '../src/components/GuestWorkspace'
import { shouldShowGuestView } from '../src/lib/guestMode'
import { readGuestDraft, writeGuestDraft } from '../src/lib/guestDraft'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

async function mount(props: Partial<Parameters<typeof GuestWorkspace>[0]> = {}) {
  const onSignIn = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<GuestWorkspace onSignIn={onSignIn} debounceMs={0} {...props} />)
    await Promise.resolve()
  })
  return { host, onSignIn }
}

function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
  act(() => {
    setter.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  localStorage.clear()
})

describe('shouldShowGuestView', () => {
  it('shows the visitor editor without a session', () => {
    expect(shouldShowGuestView({ hasUser: false, hasSharedNote: false })).toBe(true)
  })

  it('keeps the login wall for shared-note links', () => {
    expect(shouldShowGuestView({ hasUser: false, hasSharedNote: true })).toBe(false)
  })

  it('never shows the visitor editor inside a session', () => {
    expect(shouldShowGuestView({ hasUser: true, hasSharedNote: false })).toBe(false)
  })
})

describe('GuestWorkspace', () => {
  it('renders the real editor, not a textarea', async () => {
    const { host } = await mount()
    expect(host.querySelector('.ProseMirror')).not.toBeNull()
    expect(host.querySelector('.md-editor-content')).not.toBeNull()
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('uses the app title style and the welcome placeholder', async () => {
    const { host } = await mount()
    const title = host.querySelector('input') as HTMLInputElement
    expect(title.className).toContain('inline-title')
    expect(title.placeholder).toBe('Untitled')

    const placeholder = host.querySelector('[data-placeholder]')
    expect(placeholder?.getAttribute('data-placeholder')).toContain('This is FireMD')
  })

  it('links to the static plans page from the strip', async () => {
    const { host } = await mount()
    const links = [...host.querySelectorAll('a')].map((link) => link.getAttribute('href'))
    expect(links).toContain('/planes#que-es')
    expect(links).toContain('/planes#planes')
  })

  it('offers to save only after the visitor writes something', async () => {
    const { host } = await mount()
    expect(host.textContent).not.toContain('Save to my account')

    const title = host.querySelector('input') as HTMLInputElement
    type(title, 'Una idea')

    expect(host.textContent).toContain('Save to my account')
  })

  it('keeps the draft in the browser after unmounting', async () => {
    const { host } = await mount()
    const title = host.querySelector('input') as HTMLInputElement
    type(title, 'Mi nota')

    act(() => root?.unmount())
    root = null

    expect(readGuestDraft()).toMatchObject({ title: 'Mi nota' })
  })

  it('restores a saved draft into the title and the editor', async () => {
    writeGuestDraft({ title: 'Guardada', markdown: 'Texto previo', savedAt: 1 })
    const { host } = await mount()
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('Guardada')
    expect(host.querySelector('.ProseMirror')?.textContent).toContain('Texto previo')
  })

  it('signs in from the strip and records the click', async () => {
    const { host, onSignIn } = await mount()
    const button = [...host.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Sign in with Google')
    )
    expect(button).toBeTruthy()
    act(() => button!.click())
    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('firemd-guest-events')).toContain('guest_signin_clicked')
  })
})
