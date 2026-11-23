import { useState } from 'react'
import { useT } from './i18n/index.ts'
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
  const t = useT()
  const request = readDesktopLinkParams(window.location.search)
  const { user, loading, error: authError, doGoogleSignIn } = useAuth()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!request) {
    return (
      <Shell title={t('desktop.invalidLink')}>
        <p className="auth-sub">{t('desktop.invalidLinkBody')}</p>
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
        throw new Error(t('desktop.missingToken'))
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
          data?.error ?? t('desktop.rejected', { status: response.status })
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
      <Shell title={t('desktop.connected')}>
        <p className="auth-sub">{t('desktop.connectedBody')}</p>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell title={t('desktop.connectTitle')}>
        <p className="auth-sub">{t('desktop.loading')}</p>
      </Shell>
    )
  }

  if (!user) {
    return (
      <Shell title={t('desktop.connectTitle')}>
        <p className="auth-sub">{t('desktop.signInBody')}</p>
        <button className="btn auth-btn" onClick={() => void doGoogleSignIn()}>
          {t('desktop.signIn')}
        </button>
        {authError && <p className="hint tone-danger">{authError}</p>}
      </Shell>
    )
  }

  return (
    <Shell title={t('desktop.connectTitle')}>
      <p className="auth-sub">
        {t('desktop.connectBody', { email: user.email ?? user.uid })}
      </p>
      <button className="btn auth-btn" onClick={() => void connect()} disabled={busy}>
        {busy ? t('desktop.busy') : t('desktop.connect')}
      </button>
      {error && <p className="hint tone-danger">{error}</p>}
      <p className="hint">{t('desktop.retryHint')}</p>
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
