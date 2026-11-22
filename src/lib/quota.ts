import type { UsageTotals } from './usage'

/**
 * Free tier permanente.
 *
 * La edición humana (notas, carpetas y colaboración) es ilimitada: es lo que
 * sostiene la adopción y compartir links no cuesta cuota. Lo que se mide es lo
 * que escala con volumen: el almacenamiento guardado y las operaciones que
 * ejecutan los agentes CLI/MCP.
 *
 * Las operaciones se cuentan por mes calendario UTC, en el mismo bucket
 * `usage/{uid}/months/{YYYY-MM}` que ya usa el medidor. La cuota es una
 * política de producto: el cliente la muestra y la CLI/MCP la respetan, pero
 * el cobro real necesita medición server-side (ver docs/pricing.md §6).
 */
export const FREE_TIER = {
  /** 250 MB de notas, historial y snapshots. */
  storageBytes: 250 * 1024 * 1024,
  /** 10.000 operaciones de agente por mes. */
  agentOpsPerMonth: 10_000,
} as const

export interface QuotaLine {
  used: number
  limit: number
  remaining: number
  /** 0..1, recortado para barras de progreso. */
  percent: number
  over: boolean
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

export interface FreeTierStatus {
  storage: QuotaLine
  agentOps: QuotaLine
}

export function freeTierStatus(
  usage: Pick<UsageTotals, 'storageBytes' | 'agentOps'> | null
): FreeTierStatus {
  return {
    storage: quotaLine(usage?.storageBytes ?? 0, FREE_TIER.storageBytes),
    agentOps: quotaLine(usage?.agentOps ?? 0, FREE_TIER.agentOpsPerMonth),
  }
}

export type QuotaWarning = 'none' | 'soft' | 'hard'

/** Aviso suave al 80%; duro cuando se pasó del tope. */
export function quotaWarning(line: QuotaLine, softAt = 0.8): QuotaWarning {
  if (line.over) return 'hard'
  if (line.percent >= softAt) return 'soft'
  return 'none'
}

/** ¿La cuenta puede seguir usando agentes este mes? */
export function agentOpsAllowed(usage: Pick<UsageTotals, 'agentOps'> | null): boolean {
  return quotaLine(usage?.agentOps ?? 0, FREE_TIER.agentOpsPerMonth).over === false
}
