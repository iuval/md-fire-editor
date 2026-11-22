import { describe, expect, it } from 'vitest'
import { MAX_AGENT_NAME, cleanAgentName, renameAgent } from '../src/lib/agents'

describe('nombre de agente', () => {
  it('recorta y colapsa espacios', () => {
    expect(cleanAgentName('  MacBook   de  Ana  ')).toBe('MacBook de Ana')
  })

  it('devuelve null si queda vacío', () => {
    expect(cleanAgentName('')).toBeNull()
    expect(cleanAgentName('   \n\t ')).toBeNull()
  })

  it('corta en el máximo en vez de fallar', () => {
    const long = 'a'.repeat(MAX_AGENT_NAME + 40)
    expect(cleanAgentName(long)).toHaveLength(MAX_AGENT_NAME)
  })

  it('respeta acentos y emojis', () => {
    expect(cleanAgentName('Notebook de Joaquín 🚀')).toBe('Notebook de Joaquín 🚀')
  })
})

describe('renameAgent', () => {
  it('rechaza un nombre vacío antes de tocar Firestore', async () => {
    await expect(renameAgent('abc123', '   ')).rejects.toThrow('The name cannot be empty')
  })
})
