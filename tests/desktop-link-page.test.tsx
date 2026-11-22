// @vitest-environment jsdom
/**
 * La página que usa la app de escritorio para llevarse la sesión. Lo que se
 * prueba acá es el contrato con el backend: a qué URL pega, con qué cuerpo y
 * qué muestra en cada caso. El servidor de loopback se prueba en Rust
 * (`desktop/src/link.rs`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const auth = vi.hoisted(() => ({
  current: {
    user: null as unknown,
    loading: false,
    error: null as string | null,
  },
}))

vi.mock('../src/hooks/useFirebase', () => ({
  useAuth: () => ({ ...auth.current, doGoogleSignIn: vi.fn(), doSignOut: vi.fn() }),
}))

import DesktopLink from '../src/DesktopLink'

let root: Root | null = null
let host: HTMLDivElement | null = null
let calls: { url: string; body: unknown }[] = []
let fetchOk = true

function mount() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<DesktopLink />))
  return host
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(label)
  )
  if (!found) throw new Error(`no hay botón «${label}»`)
  return found as HTMLButtonElement
}

beforeEach(() => {
  calls = []
  fetchOk = true
  auth.current = { user: null, loading: false, error: null }
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify({ ok: fetchOk }), {
      status: fetchOk ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  document.body.innerHTML = ''
})

describe('DesktopLink', () => {
  it('sin los parámetros de la app avisa que el enlace no sirve', () => {
    window.history.replaceState({}, '', '/')
    mount()
    expect(host!.textContent).toContain('Este enlace no sirve')
  })

  it('sin sesión ofrece entrar con Google', () => {
    window.history.replaceState({}, '', '/?desktop=51234&state=nonce')
    mount()
    expect(host!.textContent).toContain('Conectar FireMD Sync')
    expect(button('Entrar con Google')).toBeTruthy()
  })

  it('con sesión manda el refresh token al puerto de la app', async () => {
    window.history.replaceState({}, '', '/?desktop=51234&state=nonce-1')
    auth.current = {
      user: { uid: 'u1', email: 'a@b.com', stsTokenManager: { refreshToken: 'rt-1' } },
      loading: false,
      error: null,
    }
    mount()

    await act(async () => {
      button('Conectar la app').click()
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:51234/handshake')
    expect(calls[0].body).toEqual({
      state: 'nonce-1',
      refreshToken: 'rt-1',
      uid: 'u1',
      email: 'a@b.com',
    })
    expect(host!.textContent).toContain('Listo, cuenta conectada')
  })

  it('si el puerto contesta con error, lo muestra', async () => {
    window.history.replaceState({}, '', '/?desktop=51234&state=nonce-1')
    auth.current = {
      user: { uid: 'u1', email: 'a@b.com', stsTokenManager: { refreshToken: 'rt-1' } },
      loading: false,
      error: null,
    }
    fetchOk = false
    mount()

    await act(async () => {
      button('Conectar la app').click()
    })

    expect(host!.textContent).toContain('rechazó la conexión')
  })

  it('sin refresh token en la sesión no manda nada', async () => {
    window.history.replaceState({}, '', '/?desktop=51234&state=nonce-1')
    auth.current = {
      user: { uid: 'u1', email: 'a@b.com' },
      loading: false,
      error: null,
    }
    mount()

    await act(async () => {
      button('Conectar la app').click()
    })

    expect(calls).toHaveLength(0)
  })
})
