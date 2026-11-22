import type { UsageTotals } from './usage'

/**
 * Cuota gratuita mensual renovable (D6 de `docs/prepaid-usage-model.md`).
 *
 * El tiempo real es pago (D1): el modo gratuito edita en modo liviano. La
 * cuota se renueva sola el 1° de cada mes calendario UTC y tiene dos muros:
 * almacenamiento y operaciones. Leer los datos propios nunca se corta y nunca
 * se borra nada por falta de pago (D9).
 *
 * Las cuentas admin no pagan ni tienen tope: `freeTierStatus` y
 * `agentOpsAllowed` reciben `admin` y devuelven una cuota ilimitada.
 *
 * El medidor de hoy es del cliente y sirve para transparencia; el cobro real
 * necesita el proxy (D2) y el tope duro se aplica ahí.
 */
export const FREE_TIER = {
  /** 100 MB de notas, historial y adjuntos. */
  storageBytes: 100 * 1024 * 1024,
  /** 20.000 operaciones por mes: mismas para humanos y agentes. */
  opsPerMonth: 20_000,
  /** Alias histórico: las operaciones de agente son operaciones. */
  agentOpsPerMonth: 20_000,
} as const

export interface QuotaLine {
  used: number
  limit: number
  remaining: number
  /** 0..1, recortado para barras de progreso. */
  percent: number
  over: boolean
  /** Cuenta admin: sin tope, sin cargo. */
  unlimited?: boolean
}

export function quotaLine(used: number, limit: number): QuotaLine {
  const safeUsed = Math.max(0, Number(used) || 0)
  const safeLimit = Math.max(0, Number(limit) || 0)
  const raw = safeLimit === 0 ? (safeUsed > 0 ? 1 : 0) : safeUsed / safeLimit
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - safeUsed),
    percent: Math.min(1, raw),
    over: safeUsed > safeLimit,
  }
}

export function unlimitedQuota(used: number): QuotaLine {
  return {
    used: Math.max(0, Number(used) || 0),
    limit: 0,
    remaining: 0,
    percent: 0,
    over: false,
    unlimited: true,
  }
}

export interface FreeTierStatus {
  storage: QuotaLine
  ops: QuotaLine
  /** Alias histórico de `ops`. */
  agentOps: QuotaLine
}

export function freeTierStatus(
  usage: Pick<UsageTotals, 'storageBytes' | 'agentOps'> | null,
  admin = false
): FreeTierStatus {
  const storageUsed = usage?.storageBytes ?? 0
  const opsUsed = usage?.agentOps ?? 0
  const storage = admin ? unlimitedQuota(storageUsed) : quotaLine(storageUsed, FREE_TIER.storageBytes)
  const ops = admin ? unlimitedQuota(opsUsed) : quotaLine(opsUsed, FREE_TIER.opsPerMonth)
  return { storage, ops, agentOps: ops }
}

export type QuotaWarning = 'none' | 'soft' | 'hard'

/** Aviso suave al 80%; duro cuando se pasó del tope. */
export function quotaWarning(line: QuotaLine, softAt = 0.8): QuotaWarning {
  if (line.unlimited) return 'none'
  if (line.over) return 'hard'
  if (line.percent >= softAt) return 'soft'
  return 'none'
}

/** ¿La cuenta puede seguir operando este mes? */
export function agentOpsAllowed(
  usage: Pick<UsageTotals, 'agentOps'> | null,
  admin = false
): boolean {
  if (admin) return true
  return quotaLine(usage?.agentOps ?? 0, FREE_TIER.opsPerMonth).over === false
}

/** Alias: la cuota de operaciones es una sola para humanos y agentes. */
export const opsAllowed = agentOpsAllowed
