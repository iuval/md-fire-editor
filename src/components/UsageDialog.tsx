import { useEffect } from 'react'
import { Activity, X } from 'lucide-react'
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

export function UsageDialog({ usage, credits, paid, notes, folders, onClose }: UsageDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    <>
      <div className="scrim" onClick={onClose} />
      <div className="share" role="dialog" aria-modal="true" aria-labelledby="usage-heading">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="usage-heading">Uso de la cuenta</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <div className="usage-grid">
          <Row label="Plan" value={paid ? 'Pago' : 'Gratuito'} />
          <Row label="Mes" value={totals.month || '—'} />
          <Row label="Notas" value={String(notes)} />
          <Row label="Carpetas" value={String(folders)} />
          <Row label="Almacenamiento" value={formatBytes(totals.storageBytes)} />
          <Row label="Escrituras de sync" value={totals.writes.toLocaleString('es')} />
          <Row label="Lecturas de sync" value={totals.reads.toLocaleString('es')} />
          <Row label="Transferido (envío)" value={formatBytes(totals.bytesWritten)} />
          <Row label="Transferido (recepción)" value={formatBytes(totals.bytesRead)} />
          <Row label="Costo estimado del mes" value={formatUsd(cost)} highlight />
        </div>

        <p className="hint">
          Costo calculado con las tarifas públicas de Firestore: ${RATE_READS_PER_100K}/100k lecturas y
          ${RATE_WRITES_PER_100K}/100k escrituras. El almacenamiento de texto queda por debajo de un
          centavo. Las mediciones las hace la app, así que sirven para transparencia; el cobro real
          necesitará medirlas en el servidor.
        </p>

        <div className="share-hint-box">
          <strong>Saldo y auto top-up</strong>
          <br />
          Saldo actual: {credits ? formatUsd(credits.balanceUsd) : 'sin cargar'} · recarga mínima{' '}
          {formatUsd(MIN_TOP_UP_USD)}
          {credits && (
            <>
              {' '}
              · automática {credits.autoTopUp ? 'activada' : 'desactivada'} al bajar de{' '}
              {formatUsd(credits.thresholdUsd)}
            </>
          )}
          <br />
          Los cobros todavía no están habilitados: falta el proveedor de pagos (Stripe no opera en
          Uruguay) y el webhook del lado servidor. Con una recarga de {formatUsd(MIN_TOP_UP_USD)} la
          comisión de la tarjeta se lleva cerca del 20%.
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            <Activity size={13} /> Cerrar
          </button>
        </div>
      </div>
    </>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="usage-row">
      <span className="usage-label">{label}</span>
      <span className="usage-value" style={highlight ? { fontWeight: 600 } : undefined}>
        {value}
      </span>
    </div>
  )
}
