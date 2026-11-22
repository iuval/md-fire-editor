import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from './Modal'
import {
  MIN_TOP_UP_USD,
  RATE_DELETES_PER_100K,
  RATE_READS_PER_100K,
  RATE_WRITES_PER_100K,
  chargeBreakdown,
  costBreakdown,
  formatBytes,
  formatUsd,
  type Credits,
  type UsageTotals,
} from '../lib/usage'
import { FREE_TIER, dailyCharge, freeTierStatus, quotaWarning } from '../lib/quota'
import {
  CREDIT_PACKS,
  validateCreditSettings,
  type CreditSettings,
} from '../lib/credits'

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
  /** Cuenta admin: sin tope y sin fee. */
  isAdmin?: boolean
  notes: number
  folders: number
  diagnostics: Diagnostics
  onRefreshDiagnostics: () => void
  onMigrateBodies: () => void
  onUpdateCredits: (settings: CreditSettings) => Promise<void>
  onRequestTopUp: (amountUsd: number) => Promise<void>
  onClose: () => void
}

/**
 * The one number people open this for is the cost, so it leads; everything else
 * is the receipt behind it. Two groups instead of three nested boxes.
 */
export function UsageDialog({
  usage,
  credits,
  isAdmin = false,
  notes,
  folders,
  diagnostics,
  onRefreshDiagnostics,
  onMigrateBodies,
  onUpdateCredits,
  onRequestTopUp,
  onClose,
}: UsageDialogProps) {
  const totals: UsageTotals = usage ?? {
    day: '',
    writes: 0,
    reads: 0,
    deletes: 0,
    bytesWritten: 0,
    bytesRead: 0,
    storageBytes: 0,
    agentOps: 0,
  }
  const cost = costBreakdown(totals)
  // Se cobra solo lo que pasa la cuota diaria; el uso dentro de la cuota es gratis.
  const charge = chargeBreakdown(totals)
  const todayCharge = dailyCharge(totals, isAdmin)
  const quota = freeTierStatus(totals, isAdmin)
  const [settings, setSettings] = useState<CreditSettings>({
    thresholdUsd: credits?.thresholdUsd ?? 1,
    topUpUsd: credits?.topUpUsd ?? 5,
    autoTopUp: credits?.autoTopUp ?? false,
  })
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const settingsError = validateCreditSettings(settings)

  // `credits` llega por snapshot después de abrir el diálogo; cuando cambia,
  // reflejamos lo guardado en el formulario.
  useEffect(() => {
    if (!credits) return
    setSettings({
      thresholdUsd: credits.thresholdUsd,
      topUpUsd: credits.topUpUsd,
      autoTopUp: credits.autoTopUp,
    })
  }, [credits])

  const saveSettings = async () => {
    const problem = validateCreditSettings(settings)
    if (problem) {
      setFeedback({ tone: 'error', text: problem })
      return
    }
    try {
      await onUpdateCredits(settings)
      setFeedback({ tone: 'ok', text: 'Recarga automática guardada.' })
    } catch (error) {
      setFeedback({ tone: 'error', text: String((error as Error)?.message ?? error) })
    }
  }

  const requestPack = async (amountUsd: number) => {
    try {
      await onRequestTopUp(amountUsd)
      setFeedback({ tone: 'ok', text: `Pedido de ${formatUsd(amountUsd)} enviado. Se acredita al confirmarse el pago.` })
    } catch (error) {
      setFeedback({ tone: 'error', text: String((error as Error)?.message ?? error) })
    }
  }

  return (
    <Modal labelledBy="usage-heading" onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="usage-heading">Uso de la cuenta</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <X size={15} />
        </button>
      </div>

      <div className="usage-hero">
        <span className="usage-hero-value">{formatUsd(todayCharge)}</span>
        <span className="usage-hero-label">
          Cargo de hoy{totals.day ? ` · ${totals.day}` : ''}
        </span>
      </div>

      <p className="usage-section-title">{isAdmin ? 'Cuota (admin)' : 'Cuota diaria'}</p>
      <div className="usage-grid">
        <QuotaBar
          label="Almacenamiento"
          used={formatBytes(quota.storage.used)}
          limit={quota.storage.unlimited ? 'Sin límite' : formatBytes(FREE_TIER.storageBytes)}
          percent={quota.storage.percent}
          warning={quotaWarning(quota.storage)}
        />
        <QuotaBar
          label="Operaciones"
          used={quota.ops.used.toLocaleString('es')}
          limit={quota.ops.unlimited ? 'Sin límite' : FREE_TIER.opsPerDay.toLocaleString('es')}
          percent={quota.ops.percent}
          warning={quotaWarning(quota.ops)}
        />
      </div>
      <p className="hint">
        {isAdmin
          ? 'Cuenta admin: sin tope de cuota y sin cargos. Leer tus datos siempre está permitido.'
          : `La cuota se renueva cada día. Cubre ${formatBytes(FREE_TIER.storageBytes)} de almacenamiento y ${FREE_TIER.opsPerDay.toLocaleString('es')} acciones por día. El tiempo real es pago; el modo gratuito edita en modo liviano.`}
      </p>

      <div className="usage-sep" />

      <p className="usage-section-title">Detalle del cargo de hoy</p>
      <div className="usage-grid">
        <Row label="Escrituras" value={formatUsd(charge.writes)} />
        <Row label="Lecturas" value={formatUsd(charge.reads)} />
        <Row label="Borrados" value={formatUsd(charge.deletes)} />
        <Row label="Almacenamiento" value={formatUsd(charge.storage)} />
        <Row label="Transferencia" value={formatUsd(charge.egress)} />
        <Row label="Margen de la app" value={formatUsd(Math.max(0, charge.total - cost.total))} />
      </div>
      <p className="hint">
        Se cobra el uso que pasa la cuota diaria. El uso dentro de la cuota no se cobra.
      </p>

      <div className="usage-sep" />

      <p className="usage-section-title">Operaciones</p>
      <div className="usage-grid">
        <Row label="Notas" value={String(notes)} />
        <Row label="Carpetas" value={String(folders)} />
        <Row label="Escrituras de sync" value={totals.writes.toLocaleString('es')} />
        <Row label="Lecturas de sync" value={totals.reads.toLocaleString('es')} />
        <Row label="Borrados (compactación)" value={totals.deletes.toLocaleString('es')} />
        <Row label="Almacenamiento" value={formatBytes(totals.storageBytes)} />
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

      <p className="usage-section-title">Saldo prepago</p>
      <div className="usage-grid">
        <Row label="Modelo" value={isAdmin ? 'Admin (sin cargos)' : 'Uso prepago diario'} />
        <Row label="Cargo de hoy" value={formatUsd(todayCharge)} />
        <Row label="Saldo" value={credits ? formatUsd(credits.balanceUsd) : 'sin cargar'} />
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {CREDIT_PACKS.map((pack) => (
          <button key={pack} className="btn ghost" onClick={() => void requestPack(pack)}>
            Recargar {formatUsd(pack)}
          </button>
        ))}
      </div>
      <p className="hint">
        El saldo vence a los 24 meses. El cargo se descuenta del saldo cada día y solo se
        cobra por el uso que pasa la cuota diaria; las cuentas admin no pagan. El pago con
        tarjeta todavía no está habilitado: el pedido queda pendiente y se acredita cuando se
        confirme.
      </p>

      <div className="usage-sep" />

      <p className="usage-section-title">Recarga automática</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={settings.autoTopUp}
            onChange={(event) => setSettings({ ...settings, autoTopUp: event.target.checked })}
          />
          Activar
        </label>
        <label className="row" style={{ gap: 4, fontSize: 12 }}>
          Al bajar de
          <input
            className="field"
            type="number"
            min={0}
            step={0.5}
            value={settings.thresholdUsd}
            onChange={(event) => setSettings({ ...settings, thresholdUsd: Number(event.target.value) })}
            style={{ width: 74 }}
          />
        </label>
        <label className="row" style={{ gap: 4, fontSize: 12 }}>
          Recargar
          <input
            className="field"
            type="number"
            min={MIN_TOP_UP_USD}
            step={0.5}
            value={settings.topUpUsd}
            onChange={(event) => setSettings({ ...settings, topUpUsd: Number(event.target.value) })}
            style={{ width: 74 }}
          />
        </label>
        <button className="btn" disabled={Boolean(settingsError)} onClick={() => void saveSettings()}>
          Guardar
        </button>
      </div>
      <p className="hint">
        Mínimo {formatUsd(MIN_TOP_UP_USD)} por recarga. El saldo y el libro mayor los escribe el
        servidor: acá solo se guarda la configuración.
      </p>
      {settingsError && (
        <p className="hint tone-danger" role="status">
          {settingsError}
        </p>
      )}
      {feedback && (
        <p className={`hint ${feedback.tone === 'error' ? 'tone-danger' : 'tone-ok'}`} role="status">
          {feedback.text}
        </p>
      )}

      <p className="hint">
        Calculado con las tarifas públicas de Firestore Standard (US): {formatUsd(RATE_READS_PER_100K)}/100k
        lecturas, {formatUsd(RATE_WRITES_PER_100K)}/100k escrituras y{' '}
        {formatUsd(RATE_DELETES_PER_100K)}/100k borrados. El cargo es el del día: uso por encima
        de la cuota diaria, con el margen de la app incluido. El almacenamiento incluye PITR y
        backup, prorrateados por los bytes guardados. Las mediciones las hace la app: sirven para
        transparencia, pero el cobro real tendrá que medirlas el servidor. El cobro con tarjeta
        todavía no está habilitado: los pedidos de recarga quedan pendientes.
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

function QuotaBar({
  label,
  used,
  limit,
  percent,
  warning,
}: {
  label: string
  used: string
  limit: string
  percent: number
  warning: 'none' | 'soft' | 'hard'
}) {
  return (
    <div className="quota-line">
      <div className="quota-head">
        <span className="usage-label">{label}</span>
        <span className="usage-value">
          {used} / {limit}
          {warning === 'hard' ? ' · sin cuota' : warning === 'soft' ? ' · cerca del tope' : ''}
        </span>
      </div>
      <div
        className="quota-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent * 100)}
      >
        <div
          className={`quota-fill${warning === 'hard' ? ' is-over' : warning === 'soft' ? ' is-soft' : ''}`}
          style={{ width: `${Math.round(percent * 100)}%` }}
        />
      </div>
    </div>
  )
}
