/**
 * `firemd.app` is the only canonical origin.
 *
 * Hosting cannot 301 between custom domains (the edge has no per-host rules), so
 * the alias hosts redirect in the client. Two of them are the same app on another
 * origin: the legacy `md-sync-app.web.app` and `www.firemd.app`.
 *
 * `md-sync-app.firebaseapp.com` is deliberately absent: it is the Firebase Auth
 * domain, and the Google popup plus the email action links land on
 * `/__/auth/*` there. Redirecting it would break sign-in.
 */

const CANONICAL_ORIGIN = 'https://firemd.app'

const ALIAS_HOSTS = new Set(['md-sync-app.web.app', 'www.firemd.app'])

export interface LocationLike {
  hostname: string
  pathname: string
  search: string
  hash: string
}

/** Absolute canonical URL for an alias host, or `null` when already canonical. */
export function canonicalRedirect(location: LocationLike): string | null {
  if (!ALIAS_HOSTS.has(location.hostname.toLowerCase())) return null
  return `${CANONICAL_ORIGIN}${location.pathname}${location.search}${location.hash}`
}
