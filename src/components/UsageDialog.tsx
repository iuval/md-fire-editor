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

interface UsageDialogProps {
  usage: UsageTotals | null
  credits: Credits | null
  paid: boolean
  notes: number
  folders: number
  onClose: () => void
}

/**
 * The one number people open this for is the cost, so it leads; everything else
 * is the receipt behind it. Two groups instead of three nested boxes.
 */
export function UsageDialog({ usage, credits, paid, notes, folders, onClose }: UsageDialogProps) {
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
