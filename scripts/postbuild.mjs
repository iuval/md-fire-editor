// Publishing layout, after `vite build`:
//
//   /        the static landing page (crawlable, explains what the app is)
//   /app/    the single-page app, built by Vite
//
// Google's OAuth review fetches `/` without running JavaScript, so the app shell
// (`<div id="root"></div>`) reads as an empty page behind a login. Serving a real
// document there and moving the app one path down fixes that for reviewers,
// crawlers and link previews, without touching how the app itself works.
//
// Vite always writes its entry to the output root, so this is a move, not a build
// setting. It fails loudly instead of silently shipping the wrong thing.
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const appIndex = join(dist, 'index.html')
const appDir = join(dist, 'app')
const landing = join(root, 'landing', 'index.html')

if (!existsSync(appIndex)) {
  console.error('postbuild: dist/index.html is missing, run `vite build` first')
  process.exit(1)
}
if (!existsSync(landing)) {
  console.error('postbuild: landing/index.html is missing')
  process.exit(1)
}
if (!existsSync(appDir)) mkdirSync(appDir, { recursive: true })

renameSync(appIndex, join(appDir, 'index.html'))
copyFileSync(landing, appIndex)

// A stray copy of the Vite entry at the root would shadow the landing page.
if (existsSync(join(dist, 'app', 'app'))) rmSync(join(dist, 'app', 'app'), { recursive: true })

console.log('postbuild: / is the landing page, /app/ is the app')
