// Guardas de costo del CLI/MCP sin emulador: la ventana por minuto y el
// presupuesto por corrida son lógica pura.
import { describe, expect, it } from 'vitest'
import { createBudget, createRateLimiter, envLimit, RateLimitError } from '../agent/rate-limit.mjs'

describe('rate limiter por minuto', () => {
  it('permite hasta el límite y rechaza la siguiente operación', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now })
    expect(limiter.charge().remaining).toBe(1)
    expect(limiter.charge().remaining).toBe(0)
    expect(() => limiter.charge()).toThrow(RateLimitError)
  })

  it('se renueva cuando pasa la ventana', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    limiter.charge()
    now = 1000
    expect(() => limiter.charge()).not.toThrow()
  })

  it('dice cuánto falta para reintentar', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    limiter.charge()
    now = 250
    try {
      limiter.charge()
      throw new Error('debería haber lanzado')
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError)
      expect(error.retryAfterMs).toBe(750)
    }
  })
})

describe('presupuesto de requests por corrida', () => {
  it('cuenta y corta en el límite', () => {
    const budget = createBudget({ limit: 2 })
    budget.charge()
    budget.charge()
    expect(() => budget.charge()).toThrow(RateLimitError)
    expect(budget.used).toBe(2)
  })

  it('se resetea por comando o por tool call', () => {
    const budget = createBudget({ limit: 1 })
    budget.charge()
    budget.reset()
    expect(() => budget.charge()).not.toThrow()
  })
})

describe('envLimit', () => {
  it('lee un entero positivo del entorno y cae al default', () => {
    process.env.FIREMD_TEST_LIMIT = '120'
    expect(envLimit('FIREMD_TEST_LIMIT', 60)).toBe(120)
    process.env.FIREMD_TEST_LIMIT = '0'
    expect(envLimit('FIREMD_TEST_LIMIT', 60)).toBe(60)
    delete process.env.FIREMD_TEST_LIMIT
    expect(envLimit('FIREMD_TEST_LIMIT', 60)).toBe(60)
  })
})
