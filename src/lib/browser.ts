/**
 * Detects browsers where Google refuses to complete the OAuth flow.
 *
 * Google blocks sign-in inside embedded webviews (Electron shells, in-app
 * browsers, IDE preview panels) with "this browser or app may not be secure".
 * Detecting it lets us explain the situation instead of showing that wall.
 */

export interface BrowserInfo {
  embedded: boolean
  reason: 'electron' | 'webview' | 'automation' | null
}

export function detectBrowser(userAgent: string): BrowserInfo {
  const ua = userAgent || ''

  if (/electron|T3 Code/i.test(ua)) return { embedded: true, reason: 'electron' }
  // Android WebView ships "; wv)" and iOS in-app browsers lack the Safari token.
  if (/; wv\)|FBAN|FBAV|Instagram|Twitter/i.test(ua)) return { embedded: true, reason: 'webview' }
  if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua)) return { embedded: true, reason: 'webview' }
  if (/HeadlessChrome|Playwright|Puppeteer/i.test(ua)) return { embedded: true, reason: 'automation' }

  return { embedded: false, reason: null }
}

export function currentBrowser(): BrowserInfo {
  if (typeof navigator === 'undefined') return { embedded: false, reason: null }
  return detectBrowser(navigator.userAgent)
}

/** Human explanation used on the sign-in screen. */
export function embeddedBrowserHint(reason: BrowserInfo['reason']): string {
  if (reason === 'automation') {
    return 'Parece un navegador automatizado. Google bloquea el login ahí.'
  }
  if (reason === 'webview') {
    return 'Estás en el navegador interno de otra app. Google bloquea el login con Google dentro de esas vistas.'
  }
  return 'Estás en el navegador integrado de una app de escritorio (Electron). Google bloquea el login con Google ahí.'
}
