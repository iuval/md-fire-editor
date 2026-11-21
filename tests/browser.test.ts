import { describe, expect, it } from 'vitest'
import { detectBrowser, embeddedBrowserHint } from '../src/lib/browser'

describe('embedded browser detection', () => {
  it('flags Electron shells, including T3 Code', () => {
    const electron = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) app/1.0.0 Electron/33.0.0 Safari/537.36'
    expect(detectBrowser(electron)).toEqual({ embedded: true, reason: 'electron' })
    expect(detectBrowser(electron).embedded).toBe(true)
  })

  it('flags Android WebViews and iOS in-app browsers', () => {
    expect(detectBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36').reason).toBe('webview')
    expect(detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148').reason).toBe('webview')
  })

  it('flags automation-controlled browsers', () => {
    expect(detectBrowser('Mozilla/5.0 HeadlessChrome/131.0.0.0 Safari/537.36').reason).toBe('automation')
  })

  it('does not flag real browsers', () => {
    expect(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36').embedded).toBe(false)
    expect(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15').embedded).toBe(false)
    expect(detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1').embedded).toBe(false)
  })

  it('explains each case', () => {
    expect(embeddedBrowserHint('electron')).toMatch(/Electron/i)
    expect(embeddedBrowserHint('webview')).toMatch(/navegador interno/i)
    expect(embeddedBrowserHint('automation')).toMatch(/automatizado/i)
    expect(embeddedBrowserHint(null)).toMatch(/Electron/i)
  })
})
