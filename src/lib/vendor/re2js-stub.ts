/**
 * Stand-in for `re2js`, wired up in `vite.config.ts` (`resolve.alias`).
 *
 * `@firebase/firestore` imports it with a bare side-effect import
 * (`import 're2js'` in its ESM entry), so no bundler can tree-shake it even
 * though this app never touches the feature that uses it. Cost of the real
 * thing: 151 kB minified / 46 kB gzip on the critical path.
 *
 * The only three call sites are `RE2JS.compile` inside the Pipelines
 * expression evaluators (`regex_match`, `regex_contains`, `LIKE`), each one
 * already wrapped in try/catch with a warning fallback. Firestore Pipelines
 * are not used here (no `pipeline()`, no `RegexValue`), so throwing is both
 * safe and louder than returning a fake matcher: if a future Firestore version
 * starts calling this on a path we do use, the error names the cause.
 */
export const RE2JS = {
  compile(pattern: string): never {
    throw new Error(
      `re2js is stubbed out of this bundle; Firestore Pipelines regex is unsupported (pattern: ${pattern})`
    )
  },
}

export default { RE2JS }
