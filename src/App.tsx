import { Suspense, lazy } from 'react'
import { t } from './i18n/index.ts'

/**
 * Boot shell. Nothing here may reach Firebase through a static import — the
 * SDK is ~185 kB gzip and the login screen needs none of it. The whole
 * authenticated tree lives behind this `lazy()` boundary, so the HTML, the
 * CSS and the React runtime paint from a ~100 kB gzip chunk while the rest
 * streams in as its own.
 *
 * `tests/bundle-budget.test.ts` walks the static import graph from
 * `main.tsx` and fails if Firebase creeps back in.
 */
const AppTree = lazy(() => import('./AppTree'))

export default function App() {
  return (
    <Suspense fallback={<div className="empty">{t('common.loading')}</div>}>
      <AppTree />
    </Suspense>
  )
}
