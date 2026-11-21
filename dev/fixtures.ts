import type { Folder, Note } from '../src/lib/notes'
import { colorForUid } from '../src/lib/collab/presenceColors'

const owner = 'u-owner'

const acl = (extra: string[] = [], access: Note['access'] = 'restricted') => ({
  memberIds: [owner, ...extra],
  roles: Object.fromEntries([
    [owner, 'owner' as const],
    ...extra.map((uid) => [uid, 'editor' as const] as const),
  ]),
  access,
})

const ts = (day: number) => ({ seconds: Date.UTC(2025, 10, day) / 1000, nanoseconds: 0 })

export const folders: Folder[] = [
  {
    id: 'f-product',
    ownerId: owner,
    name: 'Producto',
    parentId: null,
    order: 0,
    tags: ['trabajo'],
    ...acl(['u-ana']),
    createdAt: ts(3),
    updatedAt: ts(20),
  },
  {
    id: 'f-specs',
    ownerId: owner,
    name: 'Especificaciones',
    parentId: 'f-product',
    order: 0,
    tags: [],
    ...acl(),
    createdAt: ts(4),
    updatedAt: ts(19),
  },
  {
    id: 'f-journal',
    ownerId: owner,
    name: 'Diario',
    parentId: null,
    order: 1,
    tags: [],
    ...acl(),
    createdAt: ts(5),
    updatedAt: ts(18),
  },
  {
    id: 'f-clients',
    ownerId: owner,
    name: 'Clientes / Acme',
    parentId: null,
    order: 2,
    tags: ['clientes'],
    ...acl(['u-bruno'], 'link-view'),
    createdAt: ts(6),
    updatedAt: ts(17),
  },
]

export const notes: Note[] = [
  {
    id: 'n-sync',
    ownerId: owner,
    folderId: 'f-specs',
    aclSource: 'folder',
    title: 'Diseño de sincronización',
    markdown: `---
status: en curso
prioridad: alta
fecha: 2025-11-20
---

# Diseño de sincronización

Firestore no trae un motor de colaboración, así que el documento se modela como un
**CRDT** y Firestore se usa solo como bitácora de updates. Ver #colaboracion y #arquitectura.

## Por qué un CRDT

Dos escrituras al mismo campo se pisan. Para texto compartido hace falta un CRDT
(Yjs) o un servidor de OT.

> La presencia viaja por \`presence/{uid}\` con heartbeats de 20 s.

### Bloques

| pieza | costo | nota |
|---|---|---|
| manifiesto | 1 lectura | snapshot + state vector |
| update | 1 escritura | hash verificado antes de aplicar |
| presencia | 1 escritura / 1,2 s | se ignora después de 45 s |

\`\`\`ts
const provider = new FirestoreYjsProvider(note.id, doc)
provider.connect()
\`\`\`

- Throttle de 350 ms, no debounce.
- Backpressure de 2 escrituras en vuelo.
- Compactación por bloques, bytes o inactividad.

---

Texto de cierre con *énfasis*, \`código en línea\` y un [enlace](https://example.com).
`,
    tags: ['colaboracion', 'arquitectura'],
    order: 0,
    version: 7,
    ...acl(['u-ana']),
    createdAt: ts(3),
    updatedAt: ts(20),
  },
  {
    id: 'n-acl',
    ownerId: owner,
    folderId: 'f-specs',
    aclSource: 'folder',
    title: 'Permisos heredados de carpeta',
    markdown: 'Una nota dentro de una carpeta tiene `aclSource: folder`.\n\n#arquitectura #permisos',
    tags: ['arquitectura', 'permisos'],
    order: 1,
    version: 3,
    ...acl(),
    createdAt: ts(7),
    updatedAt: ts(16),
  },
  {
    id: 'n-roadmap',
    ownerId: owner,
    folderId: 'f-product',
    aclSource: 'folder',
    title: 'Roadmap Q4',
    markdown: '- Tags\n- Vault de Obsidian\n- Sync local\n\n#producto',
    tags: ['producto'],
    order: 0,
    version: 2,
    ...acl(),
    createdAt: ts(8),
    updatedAt: ts(15),
  },
  {
    id: 'n-hoy',
    ownerId: owner,
    folderId: 'f-journal',
    aclSource: 'folder',
    title: '2025-11-20',
    markdown: 'Hoy cerré el rediseño del sidebar. #diario',
    tags: ['diario'],
    order: 0,
    version: 1,
    ...acl(),
    createdAt: ts(9),
    updatedAt: ts(14),
  },
  {
    id: 'n-acme',
    ownerId: owner,
    folderId: 'f-clients',
    aclSource: 'folder',
    title: 'Kickoff Acme',
    markdown: 'Reunión inicial. #clientes/acme',
    tags: ['clientes/acme'],
    order: 0,
    version: 4,
    ...acl(['u-bruno'], 'link-view'),
    createdAt: ts(10),
    updatedAt: ts(13),
  },
  {
    id: 'n-inbox',
    ownerId: owner,
    folderId: null,
    aclSource: 'own',
    title: 'Ideas sueltas',
    markdown: 'Probar un modo de enfoque sin sidebar. #producto',
    tags: ['producto'],
    order: 0,
    version: 1,
    ...acl(),
    createdAt: ts(11),
    updatedAt: ts(12),
  },
  {
    id: 'n-empty',
    ownerId: owner,
    folderId: null,
    aclSource: 'own',
    title: 'Sin título',
    markdown: '',
    tags: [],
    order: 1,
    version: 0,
    ...acl(),
    createdAt: ts(12),
    updatedAt: null,
  },
]

export const activeNote = notes[0]

// Colors come from the app, not from taste: the harness must show what users see.
export const presence = [
  { uid: 'u-ana', name: 'Ana', color: colorForUid('u-ana'), clientId: 1 },
  { uid: 'u-bruno', name: 'Bruno', color: colorForUid('u-bruno'), clientId: 2 },
]

export const connectedStatus = { connected: true, pendingWrites: 0, error: null }
export const savingStatus = { connected: true, pendingWrites: 2, error: null }
