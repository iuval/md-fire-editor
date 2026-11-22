import { describe, expect, it } from 'vitest'
import { canonicalRedirect } from '../src/lib/legacyHost'

describe('canonical redirect to firemd.app', () => {
  it('sends the legacy web.app host to the apex, keeping path, query and hash', () => {
    expect(
      canonicalRedirect({
        hostname: 'md-sync-app.web.app',
        pathname: '/nota/3f9a1c2b',
        search: '?desktop=47615&state=abc',
        hash: '#bloque',
      })
    ).toBe('https://firemd.app/nota/3f9a1c2b?desktop=47615&state=abc#bloque')
  })

  it('sends www to the apex', () => {
    expect(
      canonicalRedirect({ hostname: 'www.firemd.app', pathname: '/', search: '', hash: '' })
    ).toBe('https://firemd.app/')
  })

  it('ignores host case', () => {
    expect(
      canonicalRedirect({ hostname: 'WWW.FireMD.app', pathname: '/x', search: '', hash: '' })
    ).toBe('https://firemd.app/x')
    expect(
      canonicalRedirect({ hostname: 'MD-SYNC-APP.WEB.APP', pathname: '/', search: '', hash: '' })
    ).toBe('https://firemd.app/')
  })

  it('leaves the apex alone', () => {
    expect(
      canonicalRedirect({ hostname: 'firemd.app', pathname: '/', search: '', hash: '' })
    ).toBeNull()
  })

  it('never redirects the Auth domain: the Google popup and email links land there', () => {
    expect(
      canonicalRedirect({
        hostname: 'md-sync-app.firebaseapp.com',
        pathname: '/__/auth/handler',
        search: '?apiKey=x&mode=signIn',
        hash: '',
      })
    ).toBeNull()
  })

  it('leaves localhost and other hosts alone', () => {
    expect(
      canonicalRedirect({ hostname: 'localhost', pathname: '/', search: '', hash: '' })
    ).toBeNull()
    expect(
      canonicalRedirect({ hostname: '127.0.0.1', pathname: '/', search: '', hash: '' })
    ).toBeNull()
    expect(
      canonicalRedirect({ hostname: 'firemd.app.example.com', pathname: '/', search: '', hash: '' })
    ).toBeNull()
  })
})
