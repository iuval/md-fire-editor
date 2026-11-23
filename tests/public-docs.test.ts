import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CREDIT_PACKS } from '../src/lib/credits'
import { CREDIT_EXPIRY_MONTHS, MAX_TOP_UP_USD } from '../src/lib/usage'

/**
 * The two files an AI agent reads before touching anything: `/llms.txt` (the index) and
 * `/agent.md` (the CLI contract). They were Spanish and told the reader to clone a
 * repository that is private, which is worse than saying nothing.
 *
 * These assertions keep them English, keep the repo URL out, and keep the numbers in line
 * with the code that charges.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const llms = readFileSync(resolve(ROOT, 'public/llms.txt'), 'utf8')
const agent = readFileSync(resolve(ROOT, 'public/agent.md'), 'utf8')

/** Words that only show up if a Spanish sentence came back. */
const SPANISH = [
  'Para agentes',
  'Empezá',
  'Instalar',
  'cuota gratuita',
  'saldo prepago',
  'vencimiento',
  'Reglas de oro',
  'Comandos',
  'Códigos de salida',
  'contraseña',
]

describe('public docs: no dead ends', () => {
  it('neither file sends the reader to the private repository', () => {
    for (const [name, body] of [
      ['llms.txt', llms],
      ['agent.md', agent],
    ] as const) {
      expect(body, name).not.toContain('github.com')
      expect(body, name).not.toContain('git clone')
    }
  })

  it('says out loud that the CLI is not publicly distributed yet', () => {
    expect(llms).toMatch(/not on a public registry yet/)
    expect(agent).toMatch(/not published to a public registry yet/)
  })

  it('is written in English', () => {
    for (const [name, body] of [
      ['llms.txt', llms],
      ['agent.md', agent],
    ] as const) {
      const found = SPANISH.filter((word) => body.includes(word))
      expect(found, name).toEqual([])
    }
  })
})

describe('llms.txt', () => {
  it('follows the llms.txt shape: a title and a blockquote summary', () => {
    expect(llms.startsWith('# FireMD\n')).toBe(true)
    expect(llms).toMatch(/\n> FireMD is a collaborative Markdown notes app/)
  })

  it('points at the guide and the pricing page', () => {
    expect(llms).toContain('https://firemd.app/agent.md')
    expect(llms).toContain('https://firemd.app/pricing')
  })

  it('lists the seven MCP tools by name', () => {
    for (const tool of [
      'notes_list',
      'notes_read',
      'notes_patch',
      'notes_append',
      'notes_search',
      'notes_create',
      'folders_list',
    ]) {
      expect(llms).toContain(tool)
    }
  })

  it('quotes the packs and the expiry the app enforces', () => {
    expect(llms).toContain(`packs of USD ${CREDIT_PACKS.slice(0, -1).join(', ')} and ${CREDIT_PACKS.at(-1)}`)
    expect(llms).toContain(`up to USD ${MAX_TOP_UP_USD}`)
    expect(llms).toContain(`${CREDIT_EXPIRY_MONTHS} months`)
    expect(llms).toContain('Polar')
  })
})

describe('agent.md', () => {
  it('documents every command an agent needs, including the etag flow', () => {
    for (const command of [
      'firemd login',
      'firemd whoami',
      'firemd ls',
      'firemd cat',
      'firemd find',
      'firemd patch',
      'firemd append',
      'firemd new',
      'firemd rm',
      'firemd vault pull',
      'firemd vault push',
    ]) {
      expect(agent).toContain(command)
    }
    expect(agent).toContain('--etag')
  })

  it('keeps the exit-code contract intact', () => {
    for (const code of ['E_ETAG', 'E_NOT_FOUND', 'E_AMBIGUOUS', 'E_USAGE']) {
      expect(agent).toContain(code)
    }
    expect(agent).toMatch(/\| 64 \|/)
  })

  it('warns that permissions are the user’s, not something to work around', () => {
    expect(agent).toContain('PERMISSION_DENIED')
    expect(agent).toMatch(/Do not try to work around it/)
  })
})

describe('public surfaces stay plain', () => {
  it('uses no em dashes, in the copy or in the titles', () => {
    const files = [
      'index.html',
      'public/pricing/index.html',
      'public/privacy/index.html',
      'public/llms.txt',
      'public/agent.md',
    ]
    for (const file of files) {
      const body = readFileSync(resolve(ROOT, file), 'utf8')
      // The character itself, not the intent: a stray U+2014 is the tell.
      expect(body.includes('\u2014'), file).toBe(false)
    }
  })
})

describe('privacy policy', () => {
  const privacy = readFileSync(resolve(ROOT, 'public/privacy/index.html'), 'utf8')
  const sitemap = readFileSync(resolve(ROOT, 'public/sitemap.xml'), 'utf8')

  it('is served as a real page, in English, with its own canonical', () => {
    expect(privacy).toContain('<html lang="en">')
    expect(privacy).toContain('<link rel="canonical" href="https://firemd.app/privacy/" />')
    expect(privacy).toContain('<link rel="alternate" hreflang="en"')
    expect(sitemap).toContain('<loc>https://firemd.app/privacy/</loc>')
  })

  it('names the processors the app actually uses', () => {
    for (const party of ['Google Cloud', 'Firebase', 'Polar']) {
      expect(privacy).toContain(party)
    }
  })

  it('answers the questions a policy has to answer', () => {
    for (const section of ['What is stored', 'Why it is stored', 'How long it is kept', 'What you can do']) {
      expect(privacy).toContain(section)
    }
    // Export and delete are real features, not promises: both must be described.
    expect(privacy).toMatch(/exports every note as Markdown/)
    expect(privacy).toMatch(/deleting a note removes it and its content/)
    // A contact route that actually exists: the domain has no mailbox yet.
    expect(privacy).toMatch(/mailto:iuvalgoldansky@gmail\.com/)
  })

  it('does not promise an inbox the domain cannot receive', () => {
    // `firemd.app` has no MX records, so privacy@firemd.app would bounce.
    expect(privacy).not.toContain('privacy@firemd.app')
  })

  it('is reachable from the pricing page footer', () => {
    const pricing = readFileSync(resolve(ROOT, 'public/pricing/index.html'), 'utf8')
    expect(pricing).toContain('href="/privacy/"')
  })
})
