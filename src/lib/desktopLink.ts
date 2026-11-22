/**
 * Puente entre el sitio y la app de escritorio (FireMD Sync).
 *
 * Google rechaza el OAuth dentro de webviews embebidos, así que la app abre el
 * navegador del sistema en esta página: acá la sesión de Google ya existe y sólo
 * hace falta devolverle el refresh token al puerto local que la app dejó
 * escuchando. Es el patrón de `gh auth login`: loopback + nonce de un solo uso.
 */

export interface DesktopLinkRequest {
  /** Puerto local efímero que abrió la app. */
  port: number
  /** Nonce que la app espera de vuelta; sin él rechaza el handshake. */
  state: string
}

/** Lee `?desktop=<puerto>&state=<nonce>` del query string. */
export function readDesktopLinkParams(search: string): DesktopLinkRequest | null {
  const params = new URLSearchParams(search)
  const rawPort = params.get('desktop')
  const state = params.get('state')
  if (!rawPort || !state) return null
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { port, state }
}

/** Siempre 127.0.0.1: el servidor de la app escucha sólo en loopback. */
export function handshakeUrl(port: number): string {
  return `http://127.0.0.1:${port}/handshake`
}

/**
 * El refresh token no está en la API pública del SDK, pero el objeto `User` lo
 * guarda en `stsTokenManager` — es justo lo que usa para renovar la sesión. Sin
 * él la app de escritorio tendría que pedir login cada hora.
 */
export function refreshTokenOf(user: unknown): string | null {
  const token = (user as { stsTokenManager?: { refreshToken?: unknown } } | null)?.stsTokenManager
    ?.refreshToken
  return typeof token === 'string' && token.length > 0 ? token : null
}
