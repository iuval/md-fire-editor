import { createRoot } from 'react-dom/client'
import './index.css'
import { startTheme } from './lib/theme.ts'
import App from './App.tsx'

// Before the first paint: a stored theme is two dozen CSS variables, and doing
// it here means no flash of the default palette on reload.
startTheme()

createRoot(document.getElementById('root')!).render(<App />)
