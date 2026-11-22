import { describe, expect, it } from 'vitest'
import {
  handshakeUrl,
  readDesktopLinkParams,
  refreshTokenOf,
} from '../src/lib/desktopLink'

describe('readDesktopLinkParams', () => {
  it('lee el puerto y el nonce que deja la app de escritorio', () => {
    expect(readDesktopLinkParams('?desktop=51234&state=abc123')).toEqual({
      port: 51234,
      state: 'abc123',
    })
  })

  it('ignora una navegación normal sin el parámetro', () => {
    expect(readDesktopLinkParams('')).toBeNull()
    expect(readDesktopLinkParams('?note=abc')).toBeNull()
    expect(readDesktopLinkParams('?desktop=51234')).toBeNull()
    expect(readDesktopLinkParams('?state=abc123')).toBeNull()
  })

  it('rechaza puertos que no son puertos', () => {
    expect(readDesktopLinkParams('?desktop=0&state=x')).toBeNull()
    expect(readDesktopLinkParams('?desktop=70000&state=x')).toBeNull()
    expect(readDesktopLinkParams('?desktop=abc&state=x')).toBeNull()
    expect(readDesktopLinkParams('?desktop=1.5&state=x')).toBeNull()
    expect(readDesktopLinkParams('?desktop=-1&state=x')).toBeNull()
  })
})

describe('handshakeUrl', () => {
  it('siempre apunta a loopback, nunca a otro host', () => {
    expect(handshakeUrl(51234)).toBe('http://127.0.0.1:51234/handshake')
  })
})

describe('refreshTokenOf', () => {
  it('saca el refresh token de donde el SDK lo guarda', () => {
    expect(refreshTokenOf({ stsTokenManager: { refreshToken: 'AMf-vBx' } })).toBe('AMf-vBx')
  })

  it('devuelve null si no hay sesión o el token está vacío', () => {
    expect(refreshTokenOf(null)).toBeNull()
    expect(refreshTokenOf(undefined)).toBeNull()
    expect(refreshTokenOf({})).toBeNull()
    expect(refreshTokenOf({ stsTokenManager: {} })).toBeNull()
    expect(refreshTokenOf({ stsTokenManager: { refreshToken: '' } })).toBeNull()
    expect(refreshTokenOf({ stsTokenManager: { refreshToken: 42 } })).toBeNull()
  })
})
