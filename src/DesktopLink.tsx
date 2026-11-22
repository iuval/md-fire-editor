import { useState } from 'react'
import { useAuth } from './hooks/useFirebase'
import { handshakeUrl, readDesktopLinkParams, refreshTokenOf } from './lib/desktopLink'

/**
 * Página que usa la app de escritorio para conectar la cuenta.
 *
 * La app abre el navegador en `/?desktop=<puerto>&state=<nonce>`; acá el usuario
 * ya está (o entra) con Google y un botón le devuelve el refresh token al puerto
 * local. Nada de esto toca Firestore: es sólo el traspaso de la sesión.
 *
 * Se carga con `import()` desde `main.tsx` porque el bundle de arranque no debe
 * incluir Firebase (ver `tests/bundle-budget.test.ts`).
 */
export default function DesktopLink() {
  const request = readDesktopLinkParams(window.location.search)
  const { user, loading, error: authError, doGoogleSignIn } = useAuth()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!request) {
    return (
      <Shell title="Este enlace no sirve">
        <p className="auth-sub">
          Abrí la app de escritorio y tocá <strong>Entrar con mi cuenta</strong>: el enlace se
          genera solo, con el puerto y el código de esta conexión.
        </p>
      </Shell>
    )
  }

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      // Una sesión restaurada puede no tener refresh token en memoria: en ese
      // caso se pide un login nuevo, que siempre lo trae.
      let token = refreshTokenOf(user)
      if (!token) {
        const fresh = await doGoogleSignIn()
        token = refreshTokenOf(fresh)
      }
      if (!token) {
        throw new Error('No pude leer el token de la sesión. Cerrá sesión y volvé a entrar.')
      }

      const response = await fetch(handshakeUrl(request.port), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: request.state,
          refreshToken: token,
          uid: user?.uid ?? null,
          email: user?.email ?? null,
        }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(
          data?.error ?? `La app de escritorio rechazó la conexión (${response.status}).`
        )
      }
      setDone(true)
    } catch (e) {
      setError((e as Error)?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Shell title="Listo, cuenta conectada">
        <p className="auth-sub">
          Volvé a <strong>FireMD Sync</strong>: ya está sincronizando con tu cuenta. Podés cerrar
          esta pestaña.
        </p>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell title="Conectar FireMD Sync">
        <p className="auth-sub">Cargando…</p>
      </Shell>
    )
  }

  if (!user) {
    return (
      <Shell title="Conectar FireMD Sync">
        <p className="auth-sub">
          Entrá con la misma cuenta que usás en el sitio. Después volvés a la app y queda
          conectada.
        </p>
        <button className="btn auth-btn" onClick={() => void doGoogleSignIn()}>
          Entrar con Google
        </button>
        {authError && <p className="hint tone-danger">{authError}</p>}
      </Shell>
    )
  }

  return (
    <Shell title="Conectar FireMD Sync">
      <p className="auth-sub">
        Vas a conectar la app de escritorio con <strong>{user.email ?? user.uid}</strong>. La app
        queda con tu sesión; el sitio no cambia.
      </p>
      <button className="btn auth-btn" onClick={() => void connect()} disabled={busy}>
        {busy ? 'Conectando…' : 'Conectar la app'}
      </button>
      {error && <p className="hint tone-danger">{error}</p>}
      <p className="hint">
        Si dice que no puede conectar, la app se cerró o se venció el plazo: volvé a la app y
        tocá <strong>Entrar con mi cuenta</strong> otra vez.
      </p>
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-panel">
        <span className="auth-wordmark">
          <img className="auth-mark" src="/favicon.svg" alt="" width={20} height={20} />
          FireMD
        </span>
        <h1 className="auth-title">{title}</h1>
        {children}
      </div>
    </div>
  )
}
