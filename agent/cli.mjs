#!/usr/bin/env node
// mdfire — token-lean CLI over FireMD notes, authenticated as the agent's own
// Firebase account (paired from the web app). Security rules apply.

import { login, logout, whoami, pairingCode } from './auth.mjs'
import { AgentError, openStore, listNotes, listFolders, readNote, patchNote, appendNote, createNote, deleteNote, searchNotes } from './core.mjs'
import { parseArgs } from './args.mjs'

const HELP = `mdfire — notas FireMD desde la terminal (con permisos del agente)

  login                                     crea la identidad del agente
  whoami                                    uid a vincular en la web app
  logout                                    revoca y borra credenciales
  ls [--folder <f|root>] [--limit n]         id\\ttítulo\\tfecha\\tcarpeta
  folders                                   id\\tnombre
  cat <id> [--max-bytes n] [--etag]          markdown crudo
  find <texto> [--limit n] [--context n]     id:línea: texto
  patch <id> [--etag e] [--find a --replace b]... [--all]
  append <id> [--text t]                     agrega al final (o stdin)
  new --folder f --title t [--body t]
  rm <id>

ids: 8 caracteres (prefijo único alcanza). Salida en texto, nunca JSON.
El agente solo ve lo que le compartieron: el dueño lo agrega como miembro de
una carpeta con rol "Lectura" o "Escritura" y puede quitarlo cuando quiera.
env: MDFIRE_API_KEY, MDFIRE_PROJECT, MDFIRE_ID_TOKEN (tests)`

if (!process.argv[2] || ['-h', '--help', 'help'].includes(process.argv[2])) {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}

const [command, ...rest] = process.argv.slice(2)
const args = parseArgs(rest)

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

try {
  switch (command) {
    case 'login': {
      const creds = await login()
      process.stdout.write(
        `ok uid ${creds.uid}\ncodigo ${pairingCode(creds.uid)}\n\n` +
          `Pegá el código en la app: menú de cuenta → "Agentes de IA", elegí carpeta y rol.\n`
      )
      break
    }

    case 'whoami': {
      const me = await whoami()
      if (!me) fail('no estás logueado: corré `mdfire login`', 3)
      process.stdout.write(`${me.uid}\ncodigo ${pairingCode(me.uid)}\n`)
      break
    }

    case 'logout': {
      await logout()
      process.stdout.write('ok\n')
      break
    }

    default: {
      const db = await openStore()

      switch (command) {
        case 'ls':
          process.stdout.write(withNewline(await listNotes(db, { folder: args.folder, limit: args.limit })))
          break

        case 'folders':
          process.stdout.write(withNewline(await listFolders(db)))
          break

        case 'cat': {
          const note = await readNote(db, args._[0], { maxBytes: Number(args['max-bytes']) || 0 })
          if (args.etag === true) process.stdout.write(`${note.etag}\n`)
          process.stdout.write(note.body.endsWith('\n') ? note.body : `${note.body}\n`)
          break
        }

        case 'find': {
          const out = await searchNotes(db, args._.join(' '), {
            limit: Number(args.limit) || 20,
            context: Number(args.context) || 0,
          })
          process.stdout.write(withNewline(out))
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
          process.stdout.write(`ok ${result.id.slice(0, 8)} ${result.edits} edits ${signed(result.delta)} ${result.etag}\n`)
          break
        }

        case 'append': {
          const text = typeof args.text === 'string' ? args.text : await readStdin()
          const result = await appendNote(db, args._[0], text)
          process.stdout.write(`ok ${result.id.slice(0, 8)} ${signed(result.delta)} ${result.etag}\n`)
          break
        }

        case 'new': {
          const result = await createNote(db, {
            title: args.title,
            folder: args.folder,
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
    }
  }
} catch (error) {
  if (error instanceof AgentError) {
    const code = { E_NOT_FOUND: 3, E_ETAG: 2, E_AMBIGUOUS: 4, E_USAGE: 64 }[error.code] ?? 1
    fail(error.message, code)
  }
  const message = String(error?.message ?? error)
  if (/no estás logueado|falta MDFIRE_API_KEY/.test(message)) fail(message, 3)
  if (error?.status === 403 || /PERMISSION_DENIED|Missing or insufficient permissions/i.test(message)) {
    fail('el agente no tiene permiso para esto (revisá el rol en la app)', 3)
  }
  fail(error?.stack || message)
}

function signed(delta) {
  return delta >= 0 ? `+${delta}` : String(delta)
}

function withNewline(text) {
  return text ? `${text}\n` : ''
}
