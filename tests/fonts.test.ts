/**
 * Guards the typeface the app's whole look depends on.
 *
 * The face lives in `public/fonts/` — a folder no bundler imports, so nothing
 * else would fail if the file were deleted or truncated: the app would just
 * silently fall back to the OS font, and the notes would stop matching the UI.
 * The service worker precaches `woff2` by glob, so a missing file is also a
 * broken offline install.
 *
 * These are structural assertions, not a rendering test: they prove the bytes
 * are there and that the CSS points at a path that exists.
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8')

/** Every `/fonts/*.woff2` the stylesheet asks for. */
const referenced = [...css.matchAll(/url\("(\/fonts\/[^"]+\.woff2)"\)/g)].map((m) => m[1])

describe('self-hosted typeface', () => {
  it('drives the interface from Inter instead of the OS', () => {
    expect(css).toMatch(/--font-sans:\s*"Inter"/)
  })

  it('keeps the notes on the interface face', () => {
    // The editor deliberately has no family of its own. A second face here was
    // tried and read badly, so the note inherits `--font-sans`; this assertion
    // fails if an override sneaks back in.
    const block = css.match(/\.md-editor-content\s*\{([^}]*)\}/)
    expect(block).not.toBeNull()
    expect(block![1]).not.toMatch(/font-family/)
  })

  it('sets the note body on a weight the variable face actually has', () => {
    // 450 keeps the body sturdier than the 400 default without reading as bold.
    // If this ever drifts past the declared axis, the browser synthesises the
    // weight and the note turns smeary — that is the bug this pins.
    const block = css.match(/\.md-editor-content\s*\{([^}]*)\}/)![1]
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1])
    expect(weight).toBe(450)
    const axis = css.match(/font-family:\s*"Inter";[\s\S]*?font-weight:\s*(\d+) (\d+)/)
    expect(axis).not.toBeNull()
    expect(weight).toBeGreaterThanOrEqual(Number(axis![1]))
    expect(weight).toBeLessThanOrEqual(Number(axis![2]))
    // The size bump is half the fix: 15.5px looked thin before weight mattered.
    expect(block).toMatch(/font-size:\s*16px/)
  })

  it('points at font files that exist and are real woff2', () => {
    expect(referenced.length).toBeGreaterThanOrEqual(1)
    for (const href of referenced) {
      const file = resolve(ROOT, 'public', href.slice(1))
      expect(statSync(file).size, `${href} should not be empty`).toBeGreaterThan(1024)
      // The offline precache would happily ship a broken file.
      expect(readFileSync(file).subarray(0, 4).toString('latin1')).toBe('wOF2')
    }
  })

  it('declares a weight axis wide enough for every weight in the sheet', () => {
    // 700 is used by the sidebar badge and 650 by headings and the note title;
    // a face capped at 600 would render those as synthesised bold.
    expect(css).toMatch(/font-family:\s*"Inter";[\s\S]*?font-weight:\s*100 900/)
  })
})
