#!/usr/bin/env node
// firemd — token-lean CLI over FireMD notes, authenticated as the agent's own
// Firebase account (paired from the web app). Security rules apply.

import { login, loginWithBrowser, logout, whoami, pairingCode, saveAgentSession } from './auth.mjs'
import { AgentError, openStore, listNotes, listFolders, listTags, readNote, patchNote, appendNote, createNote, deleteNote, searchNotes } from './core.mjs'
import { defaultAgentName, formatAgents, listAgents, registerAgent, renameAgent } from './agents.mjs'
import { parseArgs } from './args.mjs'
import { defaultDir, pull, push } from './vault.mjs'

const HELP = `firemd — notas FireMD desde la terminal (con permisos del agente)

  login                                     entra con tu cuenta del sitio
  login --agent                             crea en cambio un agente anónimo
  whoami                                    quién soy (email, agente, uid)
  agents                                    agentes conectados a esta cuenta
  name <nombre>                             renombra este agente
  logout                                    revoca y borra credenciales
  ls [--folder <f|root>] [--limit n]         id\\ttítulo\\tfecha\\tcarpeta
  folders                                   id\\tnombre
  cat <id> [--max-bytes n] [--etag]          markdown crudo
  find <texto> [--tag t] [--limit n]         id:línea: texto
  tags                                      etiqueta\tnotas
  vault pull [--dir ruta] [--prune]         nube → archivos .md
  vault push [--dir ruta]                   archivos .md → nube (etag: nunca pisa)
  patch <id> [--etag e] [--find a --replace b]... [--all]
  append <id> [--text t]                     agrega al final (o stdin)
  new --folder f --title t [--body t]
  rm <id>

ids: 8 caracteres (prefijo único alcanza). Salida en texto, nunca JSON.
Al loguearte con tu cuenta sos vos: ves tus carpetas con tus permisos.
login --agent crea una cuenta anónima aparte, que sólo ve lo que el dueño le
comparta como miembro de una carpeta (rol "Lectura" o "Escritura").
env: FIREMD_API_KEY, FIREMD_PROJECT, FIREMD_ID_TOKEN (tests), FIREMD_SITE`

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
      if (args.agent === true) {
        const creds = await login()
        process.stdout.write(
          `ok uid ${creds.uid}\ncodigo ${pairingCode(creds.uid)}\n\n` +
            `Pegá el código en la app: menú de cuenta → "Agentes de IA", elegí carpeta y rol.\n`
        )
        break
      }

      const creds = await loginWithBrowser()
      const db = await openStore()
      const agent = await registerAgent(db, { id: creds.agentId, name: creds.agentName || defaultAgentName() })
      await saveAgentSession(agent)
      process.stdout.write(
        `ok ${agent.name}\n${creds.email ?? creds.uid}\nagente ${agent.id.slice(0, 8)}\n`
      )
      break
    }

    case 'whoami': {
      const me = await whoami()
      if (!me) fail('no estás logueado: corré `firemd login`', 3)
      const lines = [me.email ?? me.uid]
      if (me.agentName) lines.push(`agente ${me.agentName} ${me.agentId ? me.agentId.slice(0, 8) : ''}`.trim())
      if (!me.email) lines.push(`codigo ${pairingCode(me.uid)}`)
      process.stdout.write(`${lines.join('\n')}\n`)
      break
    }

    case 'agents': {
      const db = await openStore()
      const me = await whoami()
      const agents = await listAgents(db)
      process.stdout.write(withNewline(formatAgents(agents, { currentId: me?.agentId })))
      break
    }

    case 'name': {
      const name = args._.join(' ').trim()
      if (!name) fail('uso: firemd name "MacBook de Ana"', 64)
      const db = await openStore()
      const me = await whoami()
      if (!me?.agentId) fail('esta sesión no está registrada: corré `firemd login`', 3)
      const agent = await renameAgent(db, me.agentId, name)
      await saveAgentSession({ id: agent.id, name: agent.name })
      process.stdout.write(`ok ${agent.name}\n`)
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

        case 'vault': {
          const action = args._[1]
          const dir = typeof args.dir === 'string' ? args.dir : defaultDir()
          if (action === 'pull') {
            const result = await pull(db, { dir, prune: args.prune === true })
            process.stdout.write(`ok ${result.written} notas en ${result.dir}\n`)
          } else if (action === 'push') {
            const result = await push(db, { dir })
            process.stdout.write(
              `ok ${result.updated} actualizadas, ${result.created.length} creadas, ${result.unchanged} sin cambios\n`
            )
            result.conflicts.forEach((c) => process.stdout.write(`conflicto ${c.file} → ${c.conflict}\n`))
            result.errors.forEach((e) => process.stderr.write(`aviso ${e}\n`))
          } else {
            fail('uso: firemd vault pull|push [--dir ruta]', 64)
          }
          break
        }

        case 'tags':
          process.stdout.write(withNewline(await listTags(db)))
          break

        case 'find': {
          const out = await searchNotes(db, args._.join(' '), {
            limit: Number(args.limit) || 20,
            context: Number(args.context) || 0,
            tag: typeof args.tag === 'string' ? args.tag : undefined,
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
  if (/no estás logueado|falta FIREMD_API_KEY/.test(message)) fail(message, 3)
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
