import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AGENT_OPS_PRICE_PER_100K,
  CREDIT_PACKS,
  REFUND_WINDOW_DAYS,
} from '../src/lib/credits'
import { FREE_TIER } from '../src/lib/quota'
import {
  CREDIT_EXPIRY_MONTHS,
  MAX_TOP_UP_USD,
  MIN_AUTO_TOP_UP_USD,
  MIN_TOP_UP_USD,
  PRICE_DELETES_PER_100K,
  PRICE_EGRESS_GIB,
  PRICE_READS_PER_100K,
  PRICE_STORAGE_GIB_MONTH,
  PRICE_WRITES_PER_100K,
} from '../src/lib/usage'

/**
 * The pricing page is static HTML in `public/`, so nothing links it to the code
 * at build time. This is that link: the published numbers are the constants the
 * app charges with, and a price change that forgets the page fails here.
 *
 * It also guards the two things that were wrong before: the page was Spanish
 * while the app is English, and it advertised packs ($5/$15/$50) the app never
 * sold ($1/$5/$20).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const page = readFileSync(resolve(ROOT, 'public/pricing/index.html'), 'utf8')
const sitemap = readFileSync(resolve(ROOT, 'public/sitemap.xml'), 'utf8')
const hosting = JSON.parse(readFileSync(resolve(ROOT, 'firebase.json'), 'utf8')).hosting

const money = (value: number) => `$${value.toFixed(2)}`
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

describe('pricing page: language and canonical', () => {
  it('is English, like the app', () => {
    expect(page).toContain('<html lang="en">')
    expect(page).toContain('<meta property="og:locale" content="en_US" />')
  })

  it('declares the canonical URL it is served from, plus hreflang for the next locale', () => {
    expect(page).toContain('<link rel="canonical" href="https://firemd.app/pricing/" />')
    expect(page).toContain('<link rel="alternate" hreflang="en" href="https://firemd.app/pricing/" />')
    expect(page).toContain('<link rel="alternate" hreflang="x-default"')
    // The sitemap must submit the URL the server actually answers without a redirect.
    expect(sitemap).toContain('<loc>https://firemd.app/pricing/</loc>')
    expect(sitemap).not.toContain('<loc>https://firemd.app/pricing</loc>')
  })

  it('keeps the retired Spanish slug working with a 301', () => {
    // The page shipped at /planes first; links and the merchant-of-record review
    // already point at it, so the old route must never 404.
    const redirects = hosting.redirects ?? []
    for (const source of ['/planes', '/planes/:rest*', '/plans', '/plans/:rest*']) {
      const rule = redirects.find((r: { source: string }) => r.source === source)
      expect(rule, `missing redirect for ${source}`).toBeTruthy()
      expect(rule.destination).toBe('/pricing')
      expect(rule.type).toBe(301)
    }
    // ...and no rewrite may keep serving the removed directory.
    const rewrites = hosting.rewrites ?? []
    expect(rewrites.some((r: { source?: string }) => r.source === '/planes')).toBe(false)
  })

  it('does not link to the repository, which is not public yet', () => {
    // A marketing page that points at a private repo is a dead end; the link
    // goes back in the day the repository is published with a licence.
    expect(page).not.toContain('github.com')
  })

  it('carries no leftover Spanish', () => {
    const spanish = [
      'planes y cuota',
      'Escribí',
      'Qué es',
      'gratuita',
      'saldo prepago',
      'Vence',
      'Preguntas frecuentes',
      'Compartir',
      'operaciones por día',
    ]
    const found = spanish.filter((word) => page.includes(word))
    expect(found).toEqual([])
  })
})

describe('pricing page: the numbers are the ones we charge', () => {
  it('publishes every per-unit price from the code', () => {
    expect(page).toContain(`${money(PRICE_WRITES_PER_100K)} / 100,000`)
    expect(page).toContain(`${money(PRICE_READS_PER_100K)} / 100,000`)
    expect(page).toContain(`${money(PRICE_DELETES_PER_100K)} / 100,000`)
    expect(page).toContain(`${money(AGENT_OPS_PRICE_PER_100K)} / 100,000`)
    expect(page).toContain(`${money(PRICE_STORAGE_GIB_MONTH)} / GB-month`)
    expect(page).toContain(`${money(PRICE_EGRESS_GIB)} / GB`)
  })

  it('publishes the packs, limits and expiry the app enforces', () => {
    const packs = CREDIT_PACKS.map((pack) => `$${pack}`)
    expect(page).toContain(`Packs of ${packs.slice(0, -1).join(', ')} and ${packs.at(-1)}`)
    expect(page).toContain(`up to $${MAX_TOP_UP_USD} per purchase`)
    expect(page).toContain(`from $${MIN_AUTO_TOP_UP_USD}`)
    expect(page).toContain(`$${MIN_TOP_UP_USD}–$${CREDIT_PACKS.at(-1)}`)
    expect(page).toContain(`expires ${CREDIT_EXPIRY_MONTHS} months after purchase`)
  })

  it('publishes the free tier the app grants', () => {
    expect(page).toContain(`${mb(FREE_TIER.storageBytes)} of storage`)
    expect(page).toContain(`${FREE_TIER.opsPerDay} operations per day`)
  })

  it('publishes the refund window with the merchant of record named', () => {
    expect(page).toContain(`within ${REFUND_WINDOW_DAYS} days of purchase`)
    expect(page).toContain('Polar')
    expect(page).toContain('merchant of record')
  })

  it('states what the balance cannot do, which is what a payment review asks', () => {
    expect(page).toContain('Non-transferable, no cash value')
    expect(page).toContain('cannot be withdrawn')
    expect(page).toContain('No discount codes')
  })
})
