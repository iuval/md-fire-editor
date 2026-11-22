// @vitest-environment jsdom
/**
 * The visitor's frame is the real one: the same `AppTree` renders the sidebar,
 * the panes and the editor, with the local store as transport. The only extra
 * chrome is the 36 px strip with the free quota and one sign-in button. These
 * tests pin the strip, the info dialog and the decision that a shared note still
 * needs a session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GuestInfoDialog, GuestStrip } from '../src/components/GuestStrip'
import { shouldShowGuestView } from '../src/lib/guestMode'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

async function mount(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(node)
  })
  return host
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  localStorage.clear()
})

describe('shouldShowGuestView', () => {
  it('shows the real editor without a session', () => {
    expect(shouldShowGuestView({ hasUser: false, hasSharedNote: false })).toBe(true)
  })

  it('keeps the login wall for shared-note links', () => {
    expect(shouldShowGuestView({ hasUser: false, hasSharedNote: true })).toBe(false)
  })

  it('never shows the visitor frame inside a session', () => {
    expect(shouldShowGuestView({ hasUser: true, hasSharedNote: false })).toBe(false)
  })
})

describe('GuestStrip', () => {
  it('states the free quota and offers one sign-in', async () => {
    const onSignIn = vi.fn()
    const element = await mount(<GuestStrip onSignIn={onSignIn} onInfo={vi.fn()} />)

    expect(element.textContent).toContain('Free')
    const buttons = [...element.querySelectorAll('button')]
    expect(buttons).toHaveLength(2)
    const signIn = buttons.find((node) => node.textContent?.includes('Sign in with Google'))
    expect(signIn).toBeTruthy()

    act(() => signIn!.click())
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('opens the info dialog from the strip', async () => {
    const onInfo = vi.fn()
    const element = await mount(<GuestStrip onSignIn={vi.fn()} onInfo={onInfo} />)
    const info = [...element.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('What is FireMD')
    )
    act(() => info!.click())
    expect(onInfo).toHaveBeenCalledTimes(1)
  })

  it('drops the reading matter when the sidebar is collapsed', async () => {
    const element = await mount(<GuestStrip compact onSignIn={vi.fn()} onInfo={vi.fn()} />)
    expect(element.querySelectorAll('button')).toHaveLength(1)
    expect(element.textContent).not.toContain('Free')
  })

  it('is a region with a label, not a dialog', async () => {
    const element = await mount(<GuestStrip onSignIn={vi.fn()} onInfo={vi.fn()} />)
    expect(element.querySelector('[role="region"]')).not.toBeNull()
    expect(element.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('GuestInfoDialog', () => {
  it('lists the four pillars and the plans, and signs in', async () => {
    const onSignIn = vi.fn()
    await mount(<GuestInfoDialog onSignIn={onSignIn} onClose={vi.fn()} />)

    // The dialog renders in a portal on `document.body`.
    const text = document.body.textContent ?? ''
    expect(text).toContain('CRDT')
    expect(text).toContain('Agents')
    expect(text).toContain('Free')
    expect(document.body.querySelectorAll('li')).toHaveLength(4)

    const signIn = [...document.body.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Sign in with Google')
    )
    act(() => signIn!.click())
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('closes without signing in', async () => {
    const onClose = vi.fn()
    await mount(<GuestInfoDialog onSignIn={vi.fn()} onClose={onClose} />)
    const close = [...document.body.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Keep writing')
    )
    act(() => close!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
