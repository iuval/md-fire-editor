#!/usr/bin/env node
// Minimal MCP server (stdio, JSON-RPC 2.0) exposing the same core as the CLI.
//
// Tool descriptions are deliberately one line each and every result is plain
// text, so a session pays ~200 tokens for the tool list and nothing for JSON
// envelopes.

import { createInterface } from 'node:readline'
import {
  AgentError,
  openStore,
  listNotes,
  listFolders,
  readNote,
  patchNote,
  appendNote,
  createNote,
  searchNotes,
} from './core.mjs'

const SERVER = { name: 'mdfire', version: '1.0.0' }

const TOOLS = [
  {
    name: 'notes_list',
    description: 'Lista notas: id, título, fecha, carpeta (TSV). Sin contenido.',
    inputSchema: {
      type: 'object',
      properties: { folder: { type: 'string' }, limit: { type: 'number' } },
    },
  },
  {
    name: 'notes_read',
    description: 'Devuelve el markdown crudo de una nota. Primera línea: #etag.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, max_bytes: { type: 'number' }, bare: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'notes_patch',
    description: 'Reemplaza substrings exactos (una vez cada uno). Devuelve solo el delta.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        etag: { type: 'string' },
        find: { type: 'string' },
        replace: { type: 'string' },
        all: { type: 'boolean' },
      },
      required: ['id', 'find'],
    },
  },
  {
    name: 'notes_append',
    description: 'Agrega texto al final de la nota.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, text: { type: 'string' } },
      required: ['id', 'text'],
    },
  },
  {
    name: 'notes_search',
    description: 'Busca texto en las notas: id:línea: texto.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' }, context: { type: 'number' } },
      required: ['query'],
    },
  },
  {
    name: 'notes_create',
    description: 'Crea una nota dentro de una carpeta. Devuelve el id corto.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, folder: { type: 'string' }, body: { type: 'string' } },
      required: ['title'],
    },
  },
  {
    name: 'folders_list',
    description: 'Lista carpetas: id y nombre.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function text(value) {
  return { content: [{ type: 'text', text: value }] }
}

async function callTool(db, name, a) {
  switch (name) {
    case 'notes_list':
      return text((await listNotes(db, { folder: a.folder, limit: a.limit })) || '(sin notas)')
    case 'notes_read': {
      const note = await readNote(db, a.id, { maxBytes: a.max_bytes })
      return text(a.bare ? note.body : `#etag ${note.etag}\n${note.body}`)
    }
    case 'notes_patch': {
      const result = await patchNote(
        db,
        a.id,
        [{ find: a.find, replace: a.replace ?? '' }],
        { etag: a.etag, replaceAll: !!a.all }
      )
      return text(`ok ${result.edits} edits ${result.delta >= 0 ? '+' : ''}${result.delta} ${result.etag}`)
    }
    case 'notes_append': {
      const result = await appendNote(db, a.id, a.text)
      return text(`ok ${result.delta >= 0 ? '+' : ''}${result.delta} ${result.etag}`)
    }
    case 'notes_search':
      return text((await searchNotes(db, a.query, { limit: a.limit, context: a.context })) || '(sin resultados)')
    case 'notes_create': {
      const result = await createNote(db, { title: a.title, folder: a.folder, body: a.body })
      return text(result.short)
    }
    case 'folders_list':
      return text((await listFolders(db)) || '(sin carpetas)')
    default:
      throw new AgentError(`tool desconocida: ${name}`, 'E_USAGE')
  }
}

const db = await openStore()
const rl = createInterface({ input: process.stdin })

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

rl.on('line', async (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    return
  }

  const { id, method, params } = message

  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER,
        },
      })
      return
    }

    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
      return
    }

    if (method === 'tools/call') {
      try {
        const result = await callTool(db, params?.name, params?.arguments ?? {})
        send({ jsonrpc: '2.0', id, result })
      } catch (error) {
        // Tool failures are reported as text: an agent reads them either way.
        send({
          jsonrpc: '2.0',
          id,
          result: { ...text(`error: ${error.message}`), isError: true },
        })
      }
      return
    }

    if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} })
      return
    }

    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `método no soportado: ${method}` } })
  } catch (error) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: error?.message ?? 'internal error' } })
  }
})
