import { createRoot } from 'react-dom/client'
import './index.css'
import { startTheme } from './lib/theme.ts'
import { readDesktopLinkParams } from './lib/desktopLink.ts'
import App from './App.tsx'

// Before the first paint: a stored theme is two dozen CSS variables, and doing
// it here means no flash of the default palette on reload.
startTheme()

const root = createRoot(document.getElementById('root')!)

// `?desktop=<puerto>&state=<nonce>` is the desktop app asking for a session
// handoff. It renders its own page instead of the editor, and loads lazily so
// the boot chunk stays Firebase-free.
if (readDesktopLinkParams(window.location.search)) {
  void import('./DesktopLink.tsx').then(({ default: DesktopLink }) => root.render(<DesktopLink />))
} else {
  root.render(<App />)
}
