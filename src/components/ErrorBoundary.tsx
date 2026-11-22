import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n/index.ts'

/**
 * A crash used to mean a white screen and silence. This catches the render tree
 * and shows a way out (reload, and the stored session survives it), while
 * reporting through `lib/errors.ts` — which is imported lazily so the boot chunk
 * stays free of the Firebase SDK.
 */

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void import('../lib/errors.ts')
      .then(({ reportError }) => {
        // The component stack is what makes a boundary report actionable; it
        // travels as the message so no extra rules or fields are needed.
        const where = (info.componentStack ?? '').trim().split('\n')[1]?.trim()
        reportError('render', where ? `${error.message} @ ${where}` : error)
      })
      .catch(() => console.error('[firemd] render error:', error))
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <div className="crash">
        <div className="empty">
          <h1 className="empty-title">{t('crash.title')}</h1>
          <p className="hint">{t('crash.body')}</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            {t('crash.reload')}
          </button>
        </div>
      </div>
    )
  }
}
