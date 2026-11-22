import { chargeBreakdown, type UsageTotals } from './usage'

/**
 * Cuota gratuita diaria (D6 de `docs/prepaid-usage-model.md`).
 *
 * El tiempo real es pago (D1). La cuota se renueva cada día calendario UTC y
 * tiene dos muros: almacenamiento y acciones. Leer los datos propios nunca se
 * cobra (D9). Lo que pasa la cuota se cobra **por día**: uso + el porcentaje de
 * ganancia de la app. Las cuentas admin no pagan ni tienen tope.
 */
export const FREE_TIER = {
  /** 100 MB de storage; es un stock, no un flujo diario. */
  storageBytes: 100 * 1024 * 1024,
  /** 700 acciones por día (≈ 20.000/mes). */
  opsPerDay: 700,
} as const

export interface QuotaLine {
  used: number
  limit: number
  /** 0..1, recortado para barras de progreso. */
  percent: number
  over: boolean
  unlimited?: boolean
}

export function quotaLine(used: number, limit: number): QuotaLine {
  const safeUsed = Math.max(0, Number(used) || 0)
  const safeLimit = Math.max(0, Number(limit) || 0)
  const raw = safeLimit === 0 ? (safeUsed > 0 ? 1 : 0) : safeUsed / safeLimit
  return {
    used: safeUsed,
    limit: safeLimit,
    percent: Math.min(1, raw),
    over: safeUsed > safeLimit,
  }
}

export function unlimitedQuota(used: number): QuotaLine {
  return { used: Math.max(0, Number(used) || 0), limit: 0, percent: 0, over: false, unlimited: true }
}

export interface FreeTierStatus {
  storage: QuotaLine
  ops: QuotaLine
  /** Alias histórico. */
  agentOps: QuotaLine
}

export function freeTierStatus(
  usage: Pick<UsageTotals, 'storageBytes' | 'writes' | 'deletes' | 'agentOps'> | null,
  admin = false
): FreeTierStatus {
  const storageUsed = usage?.storageBytes ?? 0
  const opsUsed = dailyOps(usage)
  const storage = admin ? unlimitedQuota(storageUsed) : quotaLine(storageUsed, FREE_TIER.storageBytes)
  const ops = admin ? unlimitedQuota(opsUsed) : quotaLine(opsUsed, FREE_TIER.opsPerDay)
  return { storage, ops, agentOps: ops }
}

export type QuotaWarning = 'none' | 'soft' | 'hard'

/** Aviso al 80%; tope al 100%. */
export function quotaWarning(line: QuotaLine, softAt = 0.8): QuotaWarning {
  if (line.unlimited) return 'none'
  if (line.over) return 'hard'
  if (line.percent >= softAt) return 'soft'
  return 'none'
}

/** Acciones del día: escrituras, borrados y operaciones de agente. */
export function dailyOps(
  usage: Pick<UsageTotals, 'writes' | 'deletes' | 'agentOps'> | null
): number {
  if (!usage) return 0
  return Math.max(0, (usage.writes ?? 0) + (usage.deletes ?? 0) + (usage.agentOps ?? 0))
}

/** ¿Queda cuota de acciones hoy? */
export function opsAllowed(
  usage: Pick<UsageTotals, 'writes' | 'deletes' | 'agentOps'> | null,
  admin = false
): boolean {
  if (admin) return true
  return dailyOps(usage) <= FREE_TIER.opsPerDay
}

/** Alias histórico. */
export const agentOpsAllowed = opsAllowed

/**
 * Lo que se cobra hoy: precio publicado del uso que pasa la cuota diaria.
 * Devuelve 0 para admin y para uso dentro de la cuota.
 */
export function dailyCharge(
  usage: Pick<UsageTotals, 'writes' | 'deletes' | 'reads' | 'storageBytes' | 'bytesRead'> | null,
  admin = false
): number {
  if (!usage || admin) return 0
  const free = FREE_TIER.opsPerDay
  const writes = Math.max(0, (usage.writes ?? 0) - free)
  const afterWrites = Math.max(0, free - (usage.writes ?? 0))
  const deletes = Math.max(0, (usage.deletes ?? 0) - afterWrites)
  const storageBytes = Math.max(0, (usage.storageBytes ?? 0) - FREE_TIER.storageBytes)
  // D9: leer los datos propios nunca se cobra. Solo se factura lo que escribe
  // el usuario (o su agente) por encima de la cuota diaria.
  return chargeBreakdown({
    reads: 0,
    writes,
    deletes,
    storageBytes,
    bytesRead: 0,
  }).total
}
