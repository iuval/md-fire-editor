import { createRoot } from 'react-dom/client'
import './index.css'
import { startTheme } from './lib/theme.ts'
import { readDesktopLinkParams } from './lib/desktopLink.ts'
import { migrateLegacyKeys } from './lib/storage.ts'
import { canonicalRedirect } from './lib/legacyHost.ts'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import App from './App.tsx'

// `firemd.app` is the only canonical origin. The alias hosts (`www`, the legacy
// `md-sync-app.web.app`) are the same app on another origin, and Hosting cannot
// 301 between custom domains — so redirect here, before the first paint and
// before any storage, theme or handshake work runs on the wrong origin.
const canonical = canonicalRedirect(window.location)
if (canonical) window.location.replace(canonical)
else boot()

function boot() {
  // Before anything reads storage: the keys used to be prefixed with the old app
  // name, and this copies them over so the layout and theme survive the rename.
  migrateLegacyKeys(localStorage)

  // Before the first paint: a stored theme is two dozen CSS variables, and doing
  // it here means no flash of the default palette on reload.
  startTheme()

  // A rejected promise or a script error outside the render tree: React cannot
  // see those, and the reporter drags in the Firebase SDK, so it is lazy.
  void import('./lib/errors.ts').then(({ installGlobalErrorHandlers }) =>
    installGlobalErrorHandlers()
  )

  const root = createRoot(document.getElementById('root')!)
  const tree = (node: React.ReactNode) => root.render(<ErrorBoundary>{node}</ErrorBoundary>)

  // `?desktop=<puerto>&state=<nonce>` is the desktop app asking for a session
  // handoff. It renders its own page instead of the editor, and loads lazily so
  // the boot chunk stays Firebase-free.
  if (readDesktopLinkParams(window.location.search)) {
    void import('./DesktopLink.tsx').then(({ default: DesktopLink }) => tree(<DesktopLink />))
  } else {
    tree(<App />)
  }
}
