// @vitest-environment jsdom
/**
 * The visitor editor: it renders without a session, keeps the draft in the
 * browser, and shows the discovery strip only in the guest context. The login
 * wall stays for shared-note links (see shouldShowGuestView).
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

function mount(props: Partial<Parameters<typeof GuestWorkspace>[0]> = {}) {
  const onSignIn = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <GuestWorkspace onSignIn={onSignIn} debounceMs={0} {...props} />
    )
  )
  return { host, onSignIn }
}

function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value'
  )!.set!
  act(() => {
    setter.call(el, value)
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
  it('renders an editable note without a modal', () => {
    const { host } = mount()
    const title = host.querySelector('input') as HTMLInputElement
    const body = host.querySelector('textarea') as HTMLTextAreaElement
    expect(title.placeholder).toBe('Untitled')
    expect(body.placeholder).toContain('This is FireMD')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(body.disabled).toBe(false)
  })

  it('links to the static plans page from the strip', () => {
    const { host } = mount()
    const links = [...host.querySelectorAll('a')].map((link) => link.getAttribute('href'))
    expect(links).toContain('/planes#que-es')
    expect(links).toContain('/planes#planes')
  })

  it('offers to save only after the visitor writes something', () => {
    const { host } = mount()
    expect(host.textContent).not.toContain('Save to my account')

    const body = host.querySelector('textarea') as HTMLTextAreaElement
    type(body, 'Una idea')

    expect(host.textContent).toContain('Save to my account')
  })

  it('keeps the draft in the browser after unmounting', () => {
    const { host } = mount()
    const title = host.querySelector('input') as HTMLInputElement
    const body = host.querySelector('textarea') as HTMLTextAreaElement
    type(title, 'Mi nota')
    type(body, 'Contenido que no se pierde')

    act(() => root?.unmount())
    root = null

    expect(readGuestDraft()).toMatchObject({
      title: 'Mi nota',
      markdown: 'Contenido que no se pierde',
    })
  })

  it('restores a saved draft', () => {
    writeGuestDraft({ title: 'Guardada', markdown: 'Texto previo', savedAt: 1 })
    const { host } = mount()
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('Guardada')
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Texto previo')
  })

  it('signs in from the strip and records the click', () => {
    const { host, onSignIn } = mount()
    const button = [...host.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Sign in with Google')
    )
    expect(button).toBeTruthy()
    act(() => button!.click())
    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('firemd-guest-events')).toContain('guest_signin_clicked')
  })
})
