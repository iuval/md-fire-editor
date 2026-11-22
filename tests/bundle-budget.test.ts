/**
 * Guards the two load-time budgets that the production bundle is judged on.
 *
 * 1. The boot graph (everything `main.tsx` reaches through *static* imports)
 *    must not touch Firebase. The SDK is ~185 kB gzip of the initial payload
 *    and nothing on the login screen needs Firestore; it is reached through
 *    the `lazy()` boundary in `src/App.tsx` instead.
 * 2. `re2js` must stay aliased away. `@firebase/firestore` pulls it in with a
 *    bare side-effect import, which no bundler can tree-shake, and its only
 *    consumers are the Pipelines regex evaluators this app never calls.
 *
 * These are cheap structural assertions; the byte counts themselves are
 * reported by `npm run build`.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `import x from 'y'` | `import 'y'` | `export … from 'y'`, minus the type-only and dynamic forms. */
function staticSpecifiers(source: string): string[] {
  const found: string[] = []
  const patterns = [
    // import ... from 'x'  (multi-line safe, non-greedy)
    /\bimport\s+(?!type\b)[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    // export ... from 'x'
    /\bexport\s+(?!type\b)[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    // bare side-effect import: import 'x'
    /(?:^|[\n;])\s*import\s+['"]([^'"]+)['"]/g,
  ]
  for (const re of patterns) {
    for (const match of source.matchAll(re)) found.push(match[1])
  }
  return found
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every module reachable from `entry` without crossing a dynamic `import()`. */
function staticGraph(entry: string): Map<string, string[]> {
  const visited = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (visited.has(file)) continue
    const source = readFileSync(file, 'utf8')
    const specifiers = staticSpecifiers(source)
    visited.set(file, specifiers)
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue
      const target = resolveRelative(file, specifier)
      if (target && !visited.has(target)) queue.push(target)
    }
  }
  return visited
}

const isFirebase = (specifier: string) =>
  specifier === 'firebase' || specifier.startsWith('firebase/') || specifier.startsWith('@firebase/')

describe('boot graph', () => {
  const entry = resolve(ROOT, 'src/main.tsx')

  it('resolves modules (sanity check on the walker itself)', () => {
    const files = [...staticGraph(entry).keys()].map((file) => file.slice(ROOT.length + 1))
    expect(files).toContain('src/main.tsx')
    expect(files).toContain('src/App.tsx')
  })

  it('stays small enough to paint immediately', () => {
    // main.tsx + index.css + App.tsx + theme + storage + desktopLink +
    // legacyHost + ErrorBoundary + i18n/index + i18n/en. The bound is headroom
    // for a splash component or a hook, not room for another dependency tree —
    // which is what the next assertion actually pins down.
    expect(staticGraph(entry).size).toBeLessThanOrEqual(10)
  })

  it('never nests a tree behind a boot module (depth <= 2)', () => {
    // The count above is a proxy; this is the invariant it is proxying for. A
    // boot module may reach one more local module, and that one must be a leaf,
    // so no dependency tree can hide behind a small count. App.tsx qualifies
    // because everything below it is reached through `lazy()`.
    //
    // One exemption, explicit: the catalogue. `i18n/index.ts -> i18n/en.ts` is a
    // second local hop, and staying a single file would mean one giant module
    // plus no way to add a language without editing the runtime.
    const graph = staticGraph(entry)
    const localsOf = (file: string) =>
      (graph.get(file) ?? [])
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => resolveRelative(file, specifier))
        .filter((target): target is string => Boolean(target))
    const nested = [...graph.keys()]
      .filter((file) => file !== entry)
      .flatMap(localsOf)
      .filter((target) => localsOf(target).length > 0)
      .map((file) => file.slice(ROOT.length + 1))
      .filter((file) => !file.startsWith('src/i18n/'))
    expect(nested).toEqual([])

    // ...and the exemption stays as small as it can be.
    const catalogue = [...graph.keys()]
      .map((file) => file.slice(ROOT.length + 1))
      .filter((file) => file.startsWith('src/i18n/'))
    expect(catalogue.length).toBeLessThanOrEqual(2)
  })

  it('never reaches Firebase through a static import', () => {
    const graph = staticGraph(entry)
    const offenders: string[] = []
    for (const [file, specifiers] of graph) {
      for (const specifier of specifiers) {
        if (isFirebase(specifier)) offenders.push(`${file.slice(ROOT.length + 1)} -> ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the Firebase tree behind one lazy boundary', () => {
    const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8')
    // The authenticated tree must be pulled in dynamically, not statically.
    expect(app).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(/)
    expect(app).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s*['"]firebase/m)
  })
})

describe('re2js', () => {
  const config = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')

  it('is aliased away from the production bundle', () => {
    expect(config).toMatch(/find:\s*['"]re2js['"]/)
  })

  it('is replaced by a stub that fails loudly instead of silently', async () => {
    const stub = await import('../src/lib/vendor/re2js-stub')
    expect(typeof stub.RE2JS.compile).toBe('function')
    expect(() => stub.RE2JS.compile('a.*')).toThrow(/stub/i)
  })
})
