/**
 * Las piezas puras de `agent/agents.mjs`: nombre por defecto y tabla de la
 * terminal. El registro contra Firestore se prueba con reglas en
 * `tests/agent.test.ts` (necesita el emulador).
 */
import { describe, expect, it } from 'vitest'
import { MAX_NAME, cleanName, defaultAgentName, formatAgents } from '../agent/agents.mjs'

describe('nombre por defecto', () => {
  it('usa el host y marca el tipo', () => {
    const name = defaultAgentName()
    expect(name).toContain('cli')
    expect(name.length).toBeLessThanOrEqual(MAX_NAME)
    expect(name).not.toContain('.local')
  })
})

describe('cleanName', () => {
  it('colapsa espacios y recorta', () => {
    expect(cleanName('  Notebook   de  Ana ')).toBe('Notebook de Ana')
  })

  it('rechaza vacío', () => {
    expect(() => cleanName('   ')).toThrow(/vacío/)
    expect(() => cleanName(null)).toThrow(/vacío/)
  })

  it('rechaza más de 80 caracteres', () => {
    expect(() => cleanName('x'.repeat(MAX_NAME + 1))).toThrow(/80/)
  })
})

describe('formatAgents', () => {
  const agents = [
    { id: '3f9a1c2b7d4e', name: 'MacBook de Ana', kind: 'cli', lastSeenAt: new Date('2026-02-11T10:00:00Z') },
    { id: '9d2e4f01aa11', name: 'iPad', kind: 'desktop', lastSeenAt: new Date('2026-02-10T10:00:00Z') },
  ]

  it('una línea por agente, cuatro columnas', () => {
    const lines = formatAgents(agents).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('3f9a1c2b\tMacBook de Ana\tcli\t2026-02-11')
    expect(lines[1]).toBe('9d2e4f01\tiPad\tdesktop\t2026-02-10')
  })

  it('marca la sesión actual con un asterisco', () => {
    const lines = formatAgents(agents, { currentId: '9d2e4f01aa11' }).split('\n')
    expect(lines[0]).not.toContain('*')
    expect(lines[1]).toContain('9d2e4f01 *')
  })

  it('sin agentes devuelve vacío', () => {
    expect(formatAgents([])).toBe('')
  })
})
