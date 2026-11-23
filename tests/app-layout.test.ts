import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Google's OAuth review fetches `/` without running JavaScript. When `/` was the
 * app shell, the reviewer received `<div id="root"></div>`: no name, no purpose,
 * and a blank page that reads as "behind a login". That is exactly the pair of
 * rejections we got.
 *
 * So `/` is a static landing page and the app lives at `/app/`. This test holds
 * that layout together: the landing has to explain the app and name it, the app
 * has to keep working from its own path, and the build has to produce both.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const landing = readFileSync(resolve(ROOT, 'landing/index.html'), 'utf8')
const appIndex = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
const vite = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')
const firebase = JSON.parse(readFileSync(resolve(ROOT, 'firebase.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))

describe('landing page at /', () => {
  it('names the app and says what it is, without JavaScript', () => {
    expect(landing).toContain('<html lang="en">')
    expect(landing).toContain('FireMD')
    // The purpose sentence the reviewer looks for.
    expect(landing).toMatch(/FireMD is a notes app for Markdown/)
    expect(landing).toContain('<h1>')
    expect(landing).toMatch(/What FireMD is for/)
    expect(landing).toMatch(/Who it is for/)
  })

  it('is reachable without an account and sends the reader into the app', () => {
    expect(landing).toContain('href="/app/"')
    expect(landing).toMatch(/try it without an account/)
    // Nothing on the page may read like a login wall.
    expect(landing.toLowerCase()).not.toContain('login required')
    expect(landing).not.toContain('<div id="root">')
  })

  it('declares itself canonical and links the legal pages', () => {
    expect(landing).toContain('<link rel="canonical" href="https://firemd.app/" />')
    for (const href of ['/pricing/', '/terms/', '/privacy/', '/refund/', '/agent.md']) {
      expect(landing).toContain(`href="${href}"`)
    }
  })

  it('uses the exact app name the consent screen must show', () => {
    // Google compares these two strings. "firemd.app" is the domain, not the name.
    // The brand appears in the header link and in the page title, both as "FireMD".
    expect(landing).toMatch(/>\s*\n?\s*FireMD\s*\n?\s*</)
    expect(landing).toMatch(/<title>FireMD[ ,:]/)
    expect(landing).not.toMatch(/<title>[^<]*firemd\.app[^<]*<\/title>/)
  })
})

describe('the app lives at /app/', () => {
  it('its document advertises /app/ as its own URL', () => {
    expect(appIndex).toContain('<link rel="canonical" href="https://firemd.app/app/" />')
    expect(appIndex).toContain('<meta property="og:url" content="https://firemd.app/app/" />')
  })

  it('the manifest starts there, in English', () => {
    expect(vite).toContain("start_url: '/app/'")
    expect(vite).toContain("scope: '/app/'")
    expect(vite).toContain("name: 'FireMD: Markdown notes'")
  })

  it('hosting rewrites deep links inside /app/ only', () => {
    const rewrites = firebase.hosting.rewrites as Array<{ source: string; destination?: string }>
    const app = rewrites.find((rule) => rule.source === '/app/**')
    expect(app?.destination).toBe('/app/index.html')
    // The root must not be rewritten, or the landing page disappears.
    expect(rewrites.some((rule) => rule.source === '/' || rule.source === '**')).toBe(false)
  })

  it('the build produces both documents', () => {
    expect(pkg.scripts.build).toContain('node scripts/postbuild.mjs')
    const postbuild = readFileSync(resolve(ROOT, 'scripts/postbuild.mjs'), 'utf8')
    expect(postbuild).toContain("join(dist, 'app')")
    expect(postbuild).toContain("join(root, 'landing', 'index.html')")
  })
})
