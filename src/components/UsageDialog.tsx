import { X } from 'lucide-react'
import { Modal } from './Modal'
import {
  MIN_TOP_UP_USD,
  RATE_READS_PER_100K,
  RATE_WRITES_PER_100K,
  estimateCost,
  formatBytes,
  formatUsd,
  type Credits,
  type UsageTotals,
} from '../lib/usage'

export interface Diagnostics {
  /** V8 heap of this tab, and the ceiling that would crash it. */
  usedHeap: number | null
  heapLimit: number | null
  domNodes: number
  openNoteSessions: number
  /** Bodies still travelling in the workspace list (pre-split notes). */
  pendingBodies: { count: number; characters: number }
  storage: { usage: number; quota: number } | null
}

interface UsageDialogProps {
  usage: UsageTotals | null
  credits: Credits | null
  paid: boolean
  notes: number
  folders: number
  diagnostics: Diagnostics
  onRefreshDiagnostics: () => void
  onMigrateBodies: () => void
  onClose: () => void
}

/**
 * The one number people open this for is the cost, so it leads; everything else
 * is the receipt behind it. Two groups instead of three nested boxes.
 */
export function UsageDialog({
  usage,
  credits,
  paid,
  notes,
  folders,
  diagnostics,
  onRefreshDiagnostics,
  onMigrateBodies,
  onClose,
}: UsageDialogProps) {
  const totals: UsageTotals = usage ?? {
    month: '',
    writes: 0,
    reads: 0,
    bytesWritten: 0,
    bytesRead: 0,
    storageBytes: 0,
  }
  const cost = estimateCost(totals)

  return (
    <Modal labelledBy="usage-heading" onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="usage-heading">Uso de la cuenta</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <X size={15} />
        </button>
      </div>

      <div className="usage-hero">
        <span className="usage-hero-value">{formatUsd(cost)}</span>
        <span className="usage-hero-label">
          Costo estimado{totals.month ? ` · ${totals.month}` : ''}
        </span>
      </div>

      <div className="usage-grid">
        <Row label="Notas" value={String(notes)} />
        <Row label="Carpetas" value={String(folders)} />
        <Row label="Almacenamiento" value={formatBytes(totals.storageBytes)} />
        <Row label="Escrituras de sync" value={totals.writes.toLocaleString('es')} />
        <Row label="Lecturas de sync" value={totals.reads.toLocaleString('es')} />
        <Row label="Transferido (envío)" value={formatBytes(totals.bytesWritten)} />
        <Row label="Transferido (recepción)" value={formatBytes(totals.bytesRead)} />
      </div>

      <div className="usage-sep" />

      {/*
        Memory lives here because "the app is using 1 GB" is normally the
        browser (every tab, the GPU process, every extension) or a dev build,
        not the notes. These numbers come from inside this tab.
      */}
      <p className="usage-section-title">Esta pestaña</p>
      <div className="usage-grid">
        <Row
          label="Heap en uso"
          value={
            diagnostics.usedHeap === null
              ? 'no disponible en este navegador'
              : `${formatBytes(diagnostics.usedHeap)}${diagnostics.heapLimit ? ` de ${formatBytes(diagnostics.heapLimit)}` : ''}`
          }
        />
        <Row label="Nodos del DOM" value={diagnostics.domNodes.toLocaleString('es')} />
        <Row label="Notas abiertas (sesión Yjs)" value={String(diagnostics.openNoteSessions)} />
        <Row
          label="Cuerpos sin migrar"
          value={
            diagnostics.pendingBodies.count === 0
              ? 'ninguno'
              : `${diagnostics.pendingBodies.count} · ${formatBytes(diagnostics.pendingBodies.characters * 2)} en el listado`
          }
        />
        <Row
          label="Cache del navegador"
          value={diagnostics.storage ? formatBytes(diagnostics.storage.usage) : 'no disponible'}
        />
      </div>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {diagnostics.pendingBodies.count > 0 && (
          <button className="btn ghost" onClick={onMigrateBodies}>
            Migrar cuerpos ahora
          </button>
        )}
        <button className="btn ghost" onClick={onRefreshDiagnostics}>
          Actualizar
        </button>
      </div>

      <div className="usage-sep" />

      <div className="usage-grid">
        <Row label="Plan" value={paid ? 'Pago' : 'Gratuito'} />
        <Row label="Saldo" value={credits ? formatUsd(credits.balanceUsd) : 'sin cargar'} />
        <Row
          label="Recarga automática"
          value={
            credits
              ? `${credits.autoTopUp ? 'sí' : 'no'} · mínimo ${formatUsd(MIN_TOP_UP_USD)} · al bajar de ${formatUsd(credits.thresholdUsd)}`
              : `mínimo ${formatUsd(MIN_TOP_UP_USD)}`
          }
        />
      </div>

      <p className="hint">
        Calculado con las tarifas públicas de Firestore (${RATE_READS_PER_100K}/100k lecturas, $
        {RATE_WRITES_PER_100K}/100k escrituras). Las mediciones las hace la app: sirven para
        transparencia, pero el cobro real tendrá que medirlas el servidor. Los cobros todavía no
        están habilitados.
      </p>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-row">
      <span className="usage-label">{label}</span>
      <span className="usage-value">{value}</span>
    </div>
  )
}
