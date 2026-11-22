import { describe, expect, it } from 'vitest'
import type { ProviderStatus } from '../src/lib/collab/provider'
import { classifyTransportError } from '../src/lib/collab/transportError'
import { syncDetail, syncText, syncTone } from '../src/lib/syncStatus'

const base: ProviderStatus = {
  connected: true,
  pendingWrites: 0,
  updateCount: 0,
  error: null,
}
const status = (patch: Partial<ProviderStatus> = {}): ProviderStatus => ({ ...base, ...patch })

describe('sync tone', () => {
  it('is ok only when connected, online and fully flushed', () => {
    expect(syncTone(status())).toBe('ok')
  })

  it('is pending while the listener has not delivered anything yet', () => {
    expect(syncTone(status({ connected: false }))).toBe('pending')
  })

  it('is pending while there are writes in flight', () => {
    expect(syncTone(status({ pendingWrites: 3 }))).toBe('pending')
  })

  // Before this the dot stayed green while the user typed into a dead
  // connection: no state said "not on the server" without also being an error.
  it('is pending when the transport says it is offline', () => {
    expect(syncTone(status({ offline: true }))).toBe('pending')
  })

  it('gives a real error precedence over a dropped connection', () => {
    expect(syncTone(status({ offline: true, error: 'No tenés permiso' }))).toBe('error')
  })
})

describe('sync words', () => {
  it('names each state in words a person reads', () => {
    expect(syncText(status())).toBe('Synced')
    expect(syncText(status({ pendingWrites: 2 }))).toBe('Saving')
    expect(syncText(status({ connected: false }))).toBe('Connecting')
    expect(syncText(status({ offline: true }))).toBe('Offline')
    expect(syncText(status({ error: 'No tenés permiso' }))).toBe('Sync error')
  })

  it('does not call a broken change "Offline"', () => {
    expect(syncText(status({ error: 'Se descartó un cambio dañado' }))).not.toBe('Offline')
  })
})

describe('sync detail', () => {
  it('says nothing extra when everything is fine', () => {
    expect(syncDetail(status())).toBeNull()
  })

  it('counts what is still on its way, in singular and plural', () => {
    expect(syncDetail(status({ pendingWrites: 1 }))).toBe('1 change not sent yet')
    expect(syncDetail(status({ pendingWrites: 4 }))).toBe('4 changes not sent yet')
  })

  it('reassures instead of alarming when the connection drops', () => {
    expect(syncDetail(status({ offline: true }))).toMatch(/sync when you reconnect/)
  })

  it('passes the reason of a real error through', () => {
    expect(syncDetail(status({ error: 'No tenés permiso para editar esta nota' }))).toBe(
      'No tenés permiso para editar esta nota'
    )
  })
})

describe('transport error classification', () => {
  it('treats a permission failure as an error with a readable reason', () => {
    const seen = classifyTransportError(new Error('Missing or insufficient permissions.'))
    expect(seen.offline).toBe(false)
    expect(seen.error).toBe('No tenés permiso para editar esta nota')
  })

  it('treats an unreachable backend as offline, not as an error', () => {
    for (const message of [
      'unavailable',
      'Failed to get document because the client is offline.',
      'DEADLINE_EXCEEDED: Deadline exceeded',
      'network error',
    ]) {
      const seen = classifyTransportError(new Error(message))
      expect(seen.offline, message).toBe(true)
      expect(seen.error, message).toBeNull()
    }
  })

  it('keeps an unknown failure as-is so it can be reported', () => {
    expect(classifyTransportError(new Error('boom'))).toEqual({ offline: false, error: 'boom' })
  })

  it('never throws on a non-Error rejection', () => {
    expect(classifyTransportError('nope')).toEqual({ offline: false, error: 'nope' })
  })
})
