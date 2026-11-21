#!/usr/bin/env node
// mdfire — token-lean CLI over FireMD notes.
//
// Why a CLI and not only MCP: tool schemas cost tokens before the first call.
// A ~25 line --help is cheaper than six JSON schemas, and shell output is
// already the format a model wants (TSV, raw markdown, short ids).

import { AgentError, openStore, listNotes, listFolders, readNote, patchNote, appendNote, createNote, deleteNote, searchNotes } from './core.mjs'
import { parseArgs } from './args.mjs'

const HELP = `mdfire — notas FireMD desde la terminal

  ls [--folder <f|root>] [--limit n]        id\\ttítulo\\tfecha\\tcarpeta
  folders                                   id\\tnombre
  cat <id> [--max-bytes n] [--etag]         markdown crudo
  find <texto> [--limit n] [--context n]    id:línea: texto
  patch <id> [--etag e] [--find a --replace b]... [--all]
  append <id> [--text t]                    agrega al final (o stdin)
  new --title t [--folder f] [--owner uid] [--body t]
  rm <id>

ids: 8 caracteres (prefijo único alcanza). Salida en texto, nunca JSON.
env: GOOGLE_APPLICATION_CREDENTIALS | MDFIRE_ACCESS_TOKEN, MDFIRE_PROJECT`

async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

const [command, ...rest] = process.argv.slice(2)
if (!command || command === '-h' || command === '--help' || command === 'help') {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}

const args = parseArgs(rest)

try {
  const db = openStore()

  switch (command) {
    case 'ls': {
      const out = await listNotes(db, { folder: args.folder, limit: args.limit })
      process.stdout.write(out ? `${out}\n` : '')
      break
    }

    case 'folders': {
      const out = await listFolders(db)
      process.stdout.write(out ? `${out}\n` : '')
      break
    }

    case 'cat': {
      const note = await readNote(db, args._[0], { maxBytes: Number(args['max-bytes']) || 0 })
      if (args.etag) process.stdout.write(`${note.etag}\n`)
      process.stdout.write(note.body.endsWith('\n') ? note.body : `${note.body}\n`)
      break
    }

    case 'find': {
      const out = await searchNotes(db, args._.join(' '), {
        limit: Number(args.limit) || 20,
        context: Number(args.context) || 0,
      })
      process.stdout.write(out ? `${out}\n` : '')
      break
    }

    case 'patch': {
      const edits = args.find.map((find, index) => ({ find, replace: args.replace[index] ?? '' }))
      if (edits.length === 0) {
        const raw = await readStdin()
        if (raw.trim()) edits.push(...JSON.parse(raw))
      }
      const result = await patchNote(db, args._[0], edits, {
        etag: typeof args.etag === 'string' ? args.etag : undefined,
        replaceAll: args.all,
      })
      process.stdout.write(`ok ${result.short ?? result.id.slice(0, 8)} ${result.edits} edits ${result.delta >= 0 ? '+' : ''}${result.delta} ${result.etag}\n`)
      break
    }

    case 'append': {
      const text = typeof args.text === 'string' ? args.text : await readStdin()
      const result = await appendNote(db, args._[0], text)
      process.stdout.write(`ok ${result.id.slice(0, 8)} ${result.delta >= 0 ? '+' : ''}${result.delta} ${result.etag}\n`)
      break
    }

    case 'new': {
      const result = await createNote(db, {
        title: args.title,
        folder: args.folder,
        ownerId: args.owner || process.env.MDFIRE_UID,
        body: typeof args.body === 'string' ? args.body : '',
      })
      process.stdout.write(`${result.short}\n`)
      break
    }

    case 'rm': {
      const result = await deleteNote(db, args._[0])
      process.stdout.write(`ok ${result.id.slice(0, 8)}\n`)
      break
    }

    default:
      fail(`comando desconocido: ${command}\n\n${HELP}`)
  }
} catch (error) {
  if (error instanceof AgentError) {
    const code = { E_NOT_FOUND: 3, E_ETAG: 2, E_AMBIGUOUS: 4, E_USAGE: 64 }[error.code] ?? 1
    fail(error.message, code)
  }
  fail(error?.stack || String(error))
}
