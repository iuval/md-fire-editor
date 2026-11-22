import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase.ts'

/**
 * Error reporting that needs no third party and no new collection shape.
 *
 * Errors land in the same `analytics/{uid}/events` document as the product
 * events (`name: 'app_error'`), so the security rules, retention and the
 * "never listable across users" property come for free — the CSP stays clean
 * and there is nothing to sign up for.
 *
 * A signed-out crash has no uid, so it cannot be written; those only reach the
 * console. The recovery screen is what the person sees either way.
 */

export type ErrorKind = 'render' | 'global' | 'promise'

export interface ErrorReport {
  kind: ErrorKind
  name: string
  message: string
}

/** Matches the 100-char cap `track()` puts on every prop. */
const MAX_MESSAGE = 100

/** A render loop must not be able to write unbounded documents. */
export const MAX_ERROR_REPORTS = 5

export function describeError(kind: ErrorKind, error: unknown): ErrorReport {
  const isError = error instanceof Error
  const name = isError && error.name ? error.name : 'Error'
  const raw = isError ? error.message : String(error)
  // Newlines and tabs would be noise in a one-line prop; the cap keeps the
  // document within what the rules allow.
  const message = raw.replace(/[\n\r\t]+/g, ' ').slice(0, MAX_MESSAGE)
  return { kind, name, message }
}

export interface ErrorBudget {
  /** `true` while the session still has room to report. */
  take(): boolean
}

export function createErrorBudget(limit: number = MAX_ERROR_REPORTS): ErrorBudget {
  let left = limit
  return {
    take() {
      if (left <= 0) return false
      left -= 1
      return true
    },
  }
}

const budget = createErrorBudget()

/** Drops an error document for the current user. Fire-and-forget, never throws. */
export function reportError(kind: ErrorKind, error: unknown): ErrorReport {
  const report = describeError(kind, error)

  // The console copy is the only trace for signed-out crashes (no uid means the
  // rules would reject the write), so it always runs.
  console.error(`[firemd] ${kind} error:`, error)

  const uid = auth?.currentUser?.uid
  if (!uid || !db) return report
  if (!budget.take()) return report

  void addDoc(collection(db, 'analytics', uid, 'events'), {
    name: 'app_error',
    props: { kind: report.kind, name: report.name, message: report.message },
    at: serverTimestamp(),
  }).catch(() => undefined)

  return report
}

/**
 * Catches what React cannot: a rejected promise nobody awaited, and a script
 * error outside the render tree. Both are reported through the same path.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    // Resource load failures (`<img>`, a chunk that 404s) also land here with no
    // `error` object; they are worth knowing about, so they are not filtered.
    reportError('global', event.error ?? event.message)
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportError('promise', event.reason)
  })
}
