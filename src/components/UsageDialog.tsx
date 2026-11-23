import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  BookOpen,
  Coins,
  CreditCard,
  Database,
  Download,
  FileText,
  Folder,
  Gauge,
  HardDrive,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import {
  MAX_TOP_UP_USD,
  MIN_AUTO_TOP_UP_USD,
  MIN_TOP_UP_USD,
  RATE_DELETES_PER_100K,
  RATE_READS_PER_100K,
  RATE_WRITES_PER_100K,
  formatBytes,
  formatUsd,
  type CostBreakdown,
  type Credits,
  type UsageTotals,
} from '../lib/usage'
import {
  FREE_TIER,
  dailyCharge,
  dailyChargeBreakdown,
  dailyCostBreakdown,
  freeTierStatus,
  quotaWarning,
} from '../lib/quota'
import { proxyEnabled, startPortal } from '../lib/proxy'
import { localeTag, useT, type MessageKey } from '../i18n/index.ts'
import type { ServerAllowance } from '../lib/allowance'
import {
  CREDIT_PACKS,
  validateCreditSettings,
  type CreditSettings,
} from '../lib/credits'

const TABS = ['usage', 'balance', 'diagnostics'] as const
type UsageTab = (typeof TABS)[number]

const TAB_LABELS: Record<UsageTab, MessageKey> = {
  usage: 'usage.tabs.usage',
  balance: 'usage.tabs.balance',
  diagnostics: 'usage.tabs.diagnostics',
}

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
  /** Cuota contada por el proxy: es la que se cobra, no la del cliente. */
  serverAllowance?: ServerAllowance | null
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
  serverAllowance = null,
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
  const t = useT()
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
  // Cuando el proxy ya contó el día, su cuenta es la que se cobra: el contador
  // del cliente queda como referencia y para dispositivos sin proxy.
  const chargedTotals: UsageTotals = serverAllowance
    ? {
        ...totals,
        writes: serverAllowance.writes,
        deletes: serverAllowance.deletes,
        agentOps: Math.max(0, serverAllowance.opsUsed - serverAllowance.writes - serverAllowance.deletes),
      }
    : totals
  // Se cobra solo lo que pasa la cuota diaria; el uso dentro de la cuota es gratis.
  // El héroe y el detalle usan la misma base para no mostrar dos cifras distintas.
  const charge = dailyChargeBreakdown(chargedTotals, isAdmin)
  const cost = dailyCostBreakdown(chargedTotals, isAdmin)
  const todayCharge = dailyCharge(chargedTotals, isAdmin)
  const quota = freeTierStatus(totals, isAdmin)
  const [settings, setSettings] = useState<CreditSettings>({
    thresholdUsd: credits?.thresholdUsd ?? 1,
    topUpUsd: credits?.topUpUsd ?? 5,
    autoTopUp: credits?.autoTopUp ?? false,
  })
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  /** Monto libre: los presets son atajos, el input manda. */
  const [customAmount, setCustomAmount] = useState('')
  const settingsError = validateCreditSettings(settings)
  /** Three tabs, because the receipt does not belong on the same page as the bill. */
  const [tab, setTab] = useState<UsageTab>('usage')
  const tabRefs = useRef(new Map<UsageTab, HTMLButtonElement | null>())

  /** Arrow keys move between tabs, as the tablist pattern expects. */
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null
    if (!step && jump === null) return
    event.preventDefault()
    const index = TABS.indexOf(tab)
    const next = jump ?? (index + step + TABS.length) % TABS.length
    setTab(TABS[next])
    tabRefs.current.get(TABS[next])?.focus()
  }

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
      setFeedback({ tone: 'ok', text: t('usage.topUp.saved') })
    } catch (error) {
      setFeedback({ tone: 'error', text: String((error as Error)?.message ?? error) })
    }
  }

  const openPortal = async () => {
    try {
      const session = await startPortal()
      location.assign(session.url)
    } catch (error) {
      setFeedback({ tone: 'error', text: String((error as Error)?.message ?? error) })
    }
  }

  const requestPack = async (amountUsd: number) => {
    try {
      if (!Number.isFinite(amountUsd) || amountUsd < MIN_TOP_UP_USD || amountUsd > MAX_TOP_UP_USD) {
        setFeedback({
          tone: 'error',
          text: t('usage.topUp.range', {
            min: formatUsd(MIN_TOP_UP_USD),
            max: formatUsd(MAX_TOP_UP_USD),
          }),
        })
        return
      }
      await onRequestTopUp(amountUsd)
      setFeedback({
        tone: 'ok',
        text: t('usage.topUp.requested', { amount: formatUsd(amountUsd) }),
      })
    } catch (error) {
      setFeedback({ tone: 'error', text: String((error as Error)?.message ?? error) })
    }
  }

  return (
    <Modal labelledBy="usage-heading" onClose={onClose} className="share usage">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="usage-heading">{t('usage.heading')}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={15} />
        </button>
      </div>

      <div className="usage-hero">
        <div className="usage-hero-main">
          <span className="usage-hero-value">{formatUsd(todayCharge)}</span>
          <span className="usage-hero-label">
            {t('usage.todayCharge')}
            {totals.day ? ` · ${totals.day}` : ''}
          </span>
        </div>
        <span className={`usage-badge${isAdmin ? ' is-admin' : ''}`}>
          {isAdmin ? t('usage.badge.admin') : t('usage.badge.prepaid')}
        </span>
      </div>

      <div
        className="usage-tabs"
        role="tablist"
        aria-label={t('usage.heading')}
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((key) => (
          <button
            key={key}
            ref={(element) => {
              tabRefs.current.set(key, element)
            }}
            id={`usage-tab-${key}`}
            className="usage-tab"
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`usage-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
          >
            {t(TAB_LABELS[key])}
          </button>
        ))}
      </div>

      <div
        className="usage-panel"
        role="tabpanel"
        id="usage-panel-usage"
        aria-labelledby="usage-tab-usage"
        hidden={tab !== 'usage'}
      >
        <section className="usage-section">
          <div className="usage-section-head">
            <Gauge size={14} />
            <p className="usage-section-title">{isAdmin ? t('usage.quota.admin') : t('usage.quota.daily')}</p>
          </div>
          <div className="usage-meters">
            <QuotaMeter
              label={t('usage.storage')}
              icon={<Database size={14} />}
              used={formatBytes(quota.storage.used)}
              limit={
                quota.storage.unlimited ? t('usage.unlimited') : formatBytes(FREE_TIER.storageBytes)
              }
              percent={quota.storage.percent}
              warning={quotaWarning(quota.storage)}
            />
            <QuotaMeter
              label={t('usage.operations')}
              icon={<Activity size={14} />}
              used={quota.ops.used.toLocaleString(localeTag())}
              limit={
                quota.ops.unlimited
                  ? t('usage.unlimited')
                  : FREE_TIER.opsPerDay.toLocaleString(localeTag())
              }
              percent={quota.ops.percent}
              warning={quotaWarning(quota.ops)}
            />
          </div>
          <p className="hint">
            {isAdmin
              ? t('usage.quotaAdminHint')
              : t('usage.quotaHint', {
                  storage: formatBytes(FREE_TIER.storageBytes),
                  ops: FREE_TIER.opsPerDay.toLocaleString(localeTag()),
                })}
          </p>
        </section>

        <section className="usage-section">
          <div className="usage-section-head">
            <Coins size={14} />
            <p className="usage-section-title">{t('usage.chargeTitle')}</p>
            <span className="usage-section-value">{formatUsd(charge.total)}</span>
          </div>
          <CostChart charge={charge} cost={cost} />
          <p className="hint">
            {serverAllowance
              ? t('usage.chargeServerHint', {
                  used: serverAllowance.opsUsed.toLocaleString(localeTag()),
                  quota: serverAllowance.quota.toLocaleString(localeTag()),
                })
              : t('usage.chargeHint')}
          </p>
        </section>

        <section className="usage-section">
          <div className="usage-section-head">
            <Activity size={14} />
            <p className="usage-section-title">{t('usage.operations')}</p>
          </div>
          <p className="stat-group-label">{t('usage.group.content')}</p>
          <div className="stat-grid">
            <Stat label={t('usage.stat.notes')} value={String(notes)} icon={<FileText size={14} />} />
            <Stat label={t('usage.stat.folders')} value={String(folders)} icon={<Folder size={14} />} />
            <Stat label={t('usage.stat.storage')} value={formatBytes(totals.storageBytes)} icon={<HardDrive size={14} />} />
          </div>
          <p className="stat-group-label">{t('usage.group.sync')}</p>
          <div className="stat-grid">
            <Stat label={t('usage.stat.writes')} value={totals.writes.toLocaleString(localeTag())} icon={<Pencil size={14} />} />
            <Stat label={t('usage.stat.reads')} value={totals.reads.toLocaleString(localeTag())} icon={<BookOpen size={14} />} />
            <Stat label={t('usage.stat.deletes')} value={totals.deletes.toLocaleString(localeTag())} icon={<Trash2 size={14} />} />
            <Stat label={t('usage.stat.sent')} value={formatBytes(totals.bytesWritten)} icon={<Upload size={14} />} />
            <Stat label={t('usage.stat.received')} value={formatBytes(totals.bytesRead)} icon={<Download size={14} />} />
          </div>
          {serverAllowance && (
            <>
              <p className="stat-group-label">{t('usage.group.server')}</p>
              <div className="stat-grid">
                <Stat
                  label={t('usage.stat.countedOps')}
                  value={`${serverAllowance.opsUsed.toLocaleString(localeTag())} / ${serverAllowance.quota.toLocaleString(localeTag())}`}
                  icon={<Server size={14} />}
                  accent
                />
              </div>
            </>
          )}
        </section>
      </div>

      <div
        className="usage-panel"
        role="tabpanel"
        id="usage-panel-balance"
        aria-labelledby="usage-tab-balance"
        hidden={tab !== 'balance'}
      >
        <section className="usage-section">
          <div className="usage-section-head">
            <CreditCard size={14} />
            <p className="usage-section-title">{t('usage.balance.title')}</p>
          </div>
          <div className="balance-card">
            <div className="balance-main">
              <span className="balance-value">{credits ? formatUsd(credits.balanceUsd) : t('usage.balance.notLoaded')}</span>
              <span className="balance-label">{t('usage.balance.available')}</span>
            </div>
            <div className="balance-meta">
              <span>{t('usage.balance.model')}</span>
              <strong>{isAdmin ? t('usage.balance.modelAdmin') : t('usage.balance.modelPrepaid')}</strong>
              <span>{t('usage.balance.today')}</span>
              <strong>{formatUsd(todayCharge)}</strong>
            </div>
          </div>
          {!credits && <p className="hint">{t('usage.balance.notLoadedHint')}</p>}
          <div className="pack-grid">
            {CREDIT_PACKS.map((pack) => (
              <button key={pack} className="pack-btn" onClick={() => void requestPack(pack)}>
                <span className="pack-plus" aria-hidden="true">
                  +
                </span>
                <span className="pack-label">{t('usage.topUp.pack', { amount: formatUsd(pack) })}</span>
              </button>
            ))}
          </div>
          <div className="custom-topup">
            <label className="custom-topup-label" htmlFor="custom-amount">
              {t('usage.topUp.other')}
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="custom-amount"
                className="field"
                type="number"
                inputMode="decimal"
                min={MIN_TOP_UP_USD}
                max={MAX_TOP_UP_USD}
                step="0.5"
                placeholder={`${formatUsd(MIN_TOP_UP_USD)} – ${formatUsd(MAX_TOP_UP_USD)}`}
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
              />
              <button
                className="btn"
                disabled={!customAmount}
                onClick={() => {
                  void requestPack(Number(customAmount))
                  setCustomAmount('')
                }}
              >
                {t('usage.topUp.submit')}
              </button>
            </div>
          </div>
          <p className="hint">
            {t('usage.topUp.hint', {
              min: formatUsd(MIN_TOP_UP_USD),
              max: formatUsd(MAX_TOP_UP_USD),
            })}
          </p>
        </section>

        <section className="usage-section">
          <div className="usage-section-head">
            <RefreshCw size={14} />
            <p className="usage-section-title">{t('usage.auto.title')}</p>
          </div>
          <div className="settings-card">
            <label className="switch-row">
              <input
                type="checkbox"
                checked={settings.autoTopUp}
                onChange={(event) => setSettings({ ...settings, autoTopUp: event.target.checked })}
              />
              <span>{t('usage.auto.enable')}</span>
            </label>
            <div className="settings-fields">
              <label className="field-label">
                {t('usage.auto.whenBelow')}
                <input
                  className="field"
                  type="number"
                  min={0}
                  step={0.5}
                  aria-label={t('usage.auto.threshold')}
                  value={settings.thresholdUsd}
                  onChange={(event) => setSettings({ ...settings, thresholdUsd: Number(event.target.value) })}
                />
              </label>
              <label className="field-label">
                {t('usage.auto.topUpBy')}
                <input
                  className="field"
                  type="number"
                  min={MIN_AUTO_TOP_UP_USD}
                  step={0.5}
                  aria-label={t('usage.auto.amount')}
                  value={settings.topUpUsd}
                  onChange={(event) => setSettings({ ...settings, topUpUsd: Number(event.target.value) })}
                />
              </label>
              <button className="btn" disabled={Boolean(settingsError)} onClick={() => void saveSettings()}>
                {t('usage.auto.save')}
              </button>
              {proxyEnabled && (
                <button className="btn ghost" onClick={() => void openPortal()}>
                  {t('usage.auto.saveCard')}
                </button>
              )}
            </div>
          </div>
          <p className="hint">
            {t('usage.auto.hint', {
              min: formatUsd(MIN_AUTO_TOP_UP_USD),
              first: formatUsd(CREDIT_PACKS[0]),
            })}
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
        </section>

        <p className="hint">
          {t('usage.footer', {
            reads: formatUsd(RATE_READS_PER_100K),
            writes: formatUsd(RATE_WRITES_PER_100K),
            deletes: formatUsd(RATE_DELETES_PER_100K),
          })}
        </p>
      </div>

      <div
        className="usage-panel"
        role="tabpanel"
        id="usage-panel-diagnostics"
        aria-labelledby="usage-tab-diagnostics"
        hidden={tab !== 'diagnostics'}
      >
        <section className="usage-section">
          <div className="usage-section-head">
            <HardDrive size={14} />
            <p className="usage-section-title">{t('usage.diagnostics.title')}</p>
          </div>
          <div className="stat-grid">
            <Stat
              label={t('usage.diagnostics.heap')}
              value={
                diagnostics.usedHeap === null
                  ? t('usage.diagnostics.heapUnavailable')
                  : `${formatBytes(diagnostics.usedHeap)}${diagnostics.heapLimit ? ` ${t('usage.diagnostics.heapOf', { limit: formatBytes(diagnostics.heapLimit) })}` : ''}`
              }
              icon={<Gauge size={14} />}
            />
            <Stat label={t('usage.diagnostics.domNodes')} value={diagnostics.domNodes.toLocaleString(localeTag())} icon={<Activity size={14} />} />
            <Stat label={t('usage.diagnostics.openNotes')} value={String(diagnostics.openNoteSessions)} icon={<FileText size={14} />} />
            <Stat
              label={t('usage.diagnostics.pendingBodies')}
              value={
                diagnostics.pendingBodies.count === 0
                  ? t('usage.diagnostics.pendingNone')
                  : t('usage.diagnostics.pendingListed', {
                      count: diagnostics.pendingBodies.count,
                      size: formatBytes(diagnostics.pendingBodies.characters * 2),
                    })
              }
              icon={<Database size={14} />}
            />
            <Stat
              label={t('usage.diagnostics.cache')}
              value={diagnostics.storage ? formatBytes(diagnostics.storage.usage) : t('usage.diagnostics.cacheUnavailable')}
              icon={<HardDrive size={14} />}
            />
          </div>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            {diagnostics.pendingBodies.count > 0 && (
              <button className="btn ghost" onClick={onMigrateBodies}>
                {t('usage.diagnostics.migrate')}
              </button>
            )}
            <button className="btn ghost" onClick={onRefreshDiagnostics}>
              <RefreshCw size={13} />
              {t('usage.diagnostics.refresh')}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  )
}

/** A quota meter: icon, label, used/limit and a bar that carries the state. */
function QuotaMeter({
  label,
  icon,
  used,
  limit,
  percent,
  warning,
}: {
  label: string
  icon: React.ReactNode
  used: string
  limit: string
  percent: number
  warning: 'none' | 'soft' | 'hard'
}) {
  const width = Math.max(0, Math.min(100, Math.round(percent * 100)))
  const t = useT()
  return (
    <div className={`quota-card${warning === 'hard' ? ' is-over' : warning === 'soft' ? ' is-soft' : ''}`}>
      <div className="quota-card-head">
        <span className="quota-icon">{icon}</span>
        <span className="quota-label">{label}</span>
        <span className="quota-value">
          {used} / {limit}
        </span>
      </div>
      <div
        className="quota-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
      >
        <div className="quota-fill" style={{ width: `${width}%` }} />
      </div>
      <span className="quota-note">
        {warning === 'hard'
          ? t('usage.quota.over')
          : warning === 'soft'
            ? t('usage.quota.near')
            : t('usage.quota.used', { percent: width })}
      </span>
    </div>
  )
}

/** The cost lines the chart draws, in stack order. `total` is the sum, not a line. */
type CostKey = Exclude<keyof CostBreakdown, 'total'>

const COST_KEYS: CostKey[] = ['writes', 'reads', 'deletes', 'storage', 'pitr', 'backup', 'egress']

/** One stacked bar plus chips: the charge is a picture, not a table. */
function CostChart({ charge, cost }: { charge: CostBreakdown; cost: CostBreakdown }) {
  const t = useT()
  const total = charge.total
  const margin = Math.max(0, charge.total - cost.total)
  const segments = COST_KEYS.filter((key) => charge[key] > 0)
  const labelOf = (key: CostKey) => t(`usage.cost.${key}`)

  if (segments.length === 0 || total <= 0) {
    return (
      <div className="cost-chart">
        <div className="cost-empty">
          <span className="cost-empty-dot" />
          <span>{t('usage.cost.none')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="cost-chart">
      <div
        className="cost-stack"
        role="img"
        aria-label={t('usage.cost.title', { amount: formatUsd(total) })}
      >
        {segments.map((key) => {
          const pct = (charge[key] / total) * 100
          const label = labelOf(key)
          return (
            <span
              key={key}
              className={`cost-seg cost-${key}`}
              style={{ width: `${pct}%` }}
              title={`${label}: ${formatUsd(charge[key])}`}
            >
              {pct >= 16 && <span className="cost-seg-label">{label}</span>}
            </span>
          )
        })}
      </div>
      <div className="cost-legend">
        {segments.map((key) => (
          <span className={`cost-chip cost-${key}`} key={key}>
            <span className="cost-dot" />
            <span className="cost-chip-label">{labelOf(key)}</span>
            <span className="cost-chip-value">{formatUsd(charge[key])}</span>
          </span>
        ))}
      </div>
      {margin > 0 && (
        <p className="cost-margin-note">
          {t('usage.cost.margin', { amount: formatUsd(margin) })}
        </p>
      )}
    </div>
  )
}

/** A small stat card: big value, quiet label, optional icon. */
function Stat({
  label,
  value,
  icon,
  accent = false,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  accent?: boolean
}) {
  return (
    <div className={`stat-card${accent ? ' is-accent' : ''}`}>
      <span className="stat-card-head">
        {icon && <span className="stat-icon">{icon}</span>}
        <span className="stat-label">{label}</span>
      </span>
      <span className="stat-value">{value}</span>
    </div>
  )
}
