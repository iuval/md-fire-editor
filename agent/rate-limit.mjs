// Guardas de costo para la CLI y el MCP. Un agente en bucle puede quemar el
// saldo prepago en minutos; estas dos piezas son el freno:
//
// - `createRateLimiter`: ventana fija por minuto. Al agente se le devuelve un
//   error con el tiempo de espera, así no reintenta a ciegas.
// - `createBudget`: techo de requests por corrida. Es el cortacircuitos: un
//   comando humano normal no se acerca, un bucle lo agota enseguida.
//
// Los defaults salen de variables de entorno para que el usuario los ajuste
// sin recompilar: FIREMD_AGENT_RATE_LIMIT (operaciones/minuto) y
// FIREMD_REQUEST_BUDGET (requests por corrida).

export class RateLimitError extends Error {
  constructor(message, retryAfterMs = 0) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

export function createRateLimiter({ limit = 60, windowMs = 60_000, now = Date.now } = {}) {
  let start = now()
  let count = 0
  return {
    limit,
    charge(n = 1) {
      const t = now()
      if (t - start >= windowMs) {
        start = t
        count = 0
      }
      if (count + n > limit) {
        const retryAfterMs = Math.max(0, start + windowMs - t)
        throw new RateLimitError(
          `límite de ${limit} operaciones por minuto; reintentá en ${Math.ceil(retryAfterMs / 1000)} s`,
          retryAfterMs
        )
      }
      count += n
      return { used: count, remaining: limit - count }
    },
  }
}

export function createBudget({ limit = 2000 } = {}) {
  let used = 0
  return {
    limit,
    get used() {
      return used
    },
    charge(n = 1) {
      if (used + n > limit) {
        throw new RateLimitError(
          `presupuesto de ${limit} requests agotado; subí FIREMD_REQUEST_BUDGET si la operación es legítima`
        )
      }
      used += n
      return { used, remaining: limit - used }
    },
    reset() {
      used = 0
    },
  }
}

/** Lee un entero positivo del entorno, con default. */
export function envLimit(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
