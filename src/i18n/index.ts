import { useSyncExternalStore } from 'react'
import { en } from './en.ts'

/**
 * Minimal, typed i18n. No dependency, no runtime catalogue fetch for the default
 * language, and every `t()` key is checked by the compiler — a typo is a build
 * error, not a `[missing]` in the UI.
 *
 * Adding a language later:
 *   1. copy `en.ts` to `xx.ts`, translate the values, keep the same keys;
 *   2. type it as `Messages` so a missing key fails `tsc`;
 *   3. add the loader to `LOADERS` and the tag to `LOCALE_TAGS`;
 *   4. `setLocale('xx')` — it loads lazily and re-renders through `useT()`.
 */

export type Messages = typeof en

type Join<Head extends string, Tail extends string> = `${Head}.${Tail}`
type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? Prefix extends ''
      ? K
      : Join<Prefix, K>
    : Paths<T[K], Prefix extends '' ? K : Join<Prefix, K>>
}[keyof T & string]

/** Every valid dot path, e.g. `'auth.signIn'`. */
export type MessageKey = Paths<Messages>

export type Locale = 'en'

/** BCP 47 tags for `Intl` (dates, numbers, relative times). */
export const LOCALE_TAGS: Record<Locale, string> = { en: 'en-US' }

const LOADERS: Record<Locale, () => Promise<Messages>> = { en: async () => en }

/** Lookup helper: with a one-member `Locale` union, narrowing makes the
 *  inlined `LOADERS[next]` unreachable (`never`), so the cast lives here. */
function loaderFor(next: Locale): () => Promise<Messages> {
  return LOADERS[next]
}

let catalog: Messages = en
let locale: Locale = 'en'
const listeners = new Set<() => void>()

export function currentLocale(): Locale {
  return locale
}

export function localeTag(): string {
  return LOCALE_TAGS[locale]
}

/** Loads and switches the catalogue; every subscribed component re-renders. */
export async function setLocale(next: Locale): Promise<void> {
  if (next === locale) return
  catalog = await loaderFor(next)()
  locale = next
  for (const listener of Array.from(listeners)) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Reads the catalogue (not the locale) so a switch re-renders: the identity of
 * the object changes when `setLocale` swaps it.
 */
function snapshot(): Messages {
  return catalog
}

export interface Params {
  [name: string]: string | number
}

function read(key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)
  if (typeof value === 'string') return value
  // A missing key is a programming error, and the guard test scans for these.
  if (import.meta.env.DEV) throw new Error(`i18n: missing key "${key}"`)
  return key
}

/** Translates a dot path, replacing `{placeholders}`. */
export function t(key: MessageKey, params?: Params): string {
  const template = read(key)
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  )
}

/** Plural form for the current locale; `count` is available as `{count}`. */
export function plural(count: number, forms: { one: string; other: string }): string {
  const rule = new Intl.PluralRules(localeTag()).select(count)
  const template = rule === 'one' ? forms.one : forms.other
  return template.replace(/\{count\}/g, String(count))
}

/** For components: subscribes to locale changes and returns the same `t`. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return t
}

/** Tests only: restores the default catalogue. */
export function resetI18nForTests(): void {
  catalog = en
  locale = 'en'
}
