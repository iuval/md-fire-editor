/**
 * Piezas puras de `agent/auth.mjs`. El handshake por loopback no se prueba acá:
 * necesita un navegador real. Su equivalente en Rust sí tiene tests
 * (`desktop/src/link.rs`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { siteUrl } from '../agent/auth.mjs'

const original = process.env.MDFIRE_SITE

afterEach(() => {
  if (original === undefined) delete process.env.MDFIRE_SITE
  else process.env.MDFIRE_SITE = original
})

describe('siteUrl', () => {
  it('usa el sitio de producción por defecto', () => {
    delete process.env.MDFIRE_SITE
    expect(siteUrl()).toBe('https://firemd.app')
  })

  it('respeta MDFIRE_SITE', () => {
    process.env.MDFIRE_SITE = 'http://localhost:5173'
    expect(siteUrl()).toBe('http://localhost:5173')
  })

  it('saca la barra final para no armar //', () => {
    process.env.MDFIRE_SITE = 'http://localhost:5173/'
    expect(siteUrl()).toBe('http://localhost:5173')
  })
})
