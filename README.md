# FireMD Editor

Editor de Markdown colaborativo en tiempo real. Notas guardadas en Firestore, edición
simultánea con CRDT (Yjs), login con Google, PWA instalable y fallback offline.

- **Live:** https://md-sync-app.web.app
- **Stack:** React 19 + Vite + TypeScript · Tiptap (ProseMirror) · Yjs · Firebase Auth +
  Firestore + Hosting

## Carpetas y permisos

Un espacio de trabajo tiene **carpetas** y **notas sueltas**. Una nota puede vivir en la raíz
(ACL propia) o dentro de una carpeta (ACL heredada).

**Roles por persona:** `Dueño` (comparte y borra), `Escritura` (edita contenido),
`Lectura` (solo abre y lee).

**Acceso por enlace:** `Privada`, `Enlace de lectura` (cualquiera logueado con el link puede
leer) o `Enlace de escritura` (puede editar en simultáneo).

Carpeta y nota se comparten por separado:

| | permiso | alcance |
|---|---|---|
| Carpeta | lectura / escritura / por email | todas las notas que hereden de ella |
| Nota | lectura / escritura / por email | solo esa nota |

Una nota dentro de una carpeta tiene `aclSource: 'folder'`: **las reglas resuelven sus
permisos leyendo el documento de la carpeta en cada operación**. Revocar el acceso a la
carpeta corta el acceso a sus notas al instante, sin propagación ni esperas. La copia de
`memberIds` en la nota solo alimenta el listado del sidebar y se refresca con un batch
cuando el dueño cambia la carpeta.

Al mover una nota a una carpeta hereda su ACL; al sacarla vuelve a ser privada del dueño.

**Agregar gente por email** no requiere backend: cada usuario publica
`userIndex/{sha256(email)}` (legible uno por uno, nunca listable) y `profiles/{uid}` con su
nombre para mostrarlo en el panel. Si alguien nunca entró con Google, no existe en el
directorio y el panel lo avisa.

## Roadmap

Las features pedidas y todavía no implementadas (tags, vault de Obsidian, sync local,
página de uso, auto top-up) están especificadas en [`docs/roadmap.md`](docs/roadmap.md), con
modelo de datos, cambios de reglas, riesgos y orden sugerido. La revisión del plan comercial
está en [`docs/comercial-review.md`](docs/comercial-review.md).

## Cómo funciona la colaboración

El diseño está justificado en [`docs/sync-algorithms.md`](docs/sync-algorithms.md): cómo
sincronizan rsync, CDC/FastCDC, Dropbox (bloques + blocklist + journal + cursor), Git y
Google Docs (OT con servidor central), y qué de todo eso aplica a un editor CRDT.

Firestore no trae un motor de colaboración, así que el documento se modela como un
**CRDT** y Firestore se usa solo como bitácora de updates:

```
folders/{folderId}                nombre + ACL de la carpeta
notes/{noteId}                    título, markdown serializado, ACL (propia o heredada)
notes/{noteId}/updates/{id}       bloque: { v, jid, hash, bytes, data, clientId }
notes/{noteId}/collab/manifest    snapshot + state vector + jid más alto
notes/{noteId}/presence/{uid}     presencia + cursor (heartbeat 20 s, throttle 1,2 s)
userIndex/{sha256(email)}         directorio para agregar colaboradores
profiles/{uid}                    nombre visible de cada persona
```

Cada bloque lleva el **hash SHA-256** de su contenido y se verifica antes de aplicarlo; el
manifiesto separa metadatos de contenido, así que entrar a una nota es **1 lectura del
manifiesto + snapshot + una cola corta**, no replay de toda la bitácora. Los edits se emiten
con **throttle de 350 ms** (no debounce: el otro cliente ve el cambio aunque sigas tipeando) y
con **backpressure** de 2 escrituras en vuelo. La compactación dispara por cantidad de bloques,
por bytes o por inactividad, y poda **exactamente** los ids que entraron en el snapshot.

- Cada cliente tiene un `Y.Doc`. Los edits locales se agrupan (throttle 350 ms) en un
  **bloque** con hash y `jid` monotónico, y se agregan a `updates`.
- `onSnapshot` entrega los updates de los demás y se aplican al mismo `Y.Doc`.
  Yjs es idempotente y conmutativo, así que el orden de llegada no importa y
  re-aplicar no duplica texto.
- Cuando la bitácora pasa de 40 bloques o 160 KB (o queda inactiva 5 min), un cliente
  escribe el estado completo en `collab/manifest` y poda exactamente los ids incluidos.
- La presencia (nombre, color, cursor) viaja por `presence/{uid}` con heartbeats;
  los registros con más de 45 s se ignoran. Los cursores remotos usan
  `RelativePosition` de Yjs, así que sobreviven a ediciones concurrentes.

Consecuencia práctica: dos personas pueden escribir el mismo párrafo al mismo tiempo
y no se pierde texto de ninguna de las dos (last-write-wins destruiría contenido; un
CRDT no).

### ¿Por qué no "solo Firestore"?

Firestore es una base de documentos: dos escrituras al mismo campo se pisan. Para
texto compartido hace falta un CRDT (Yjs) o un servidor de OT. Yjs sobre Firestore
funciona bien y no requiere infraestructura extra; si más adelante necesitás menor
latencia o más de ~50 editores por documento, conviene un provider websocket
(y-websocket / Hocuspocus) manteniendo Firestore para persistencia.

## Seguridad

### Modelo de datos y permisos (`firestore.rules`)

| Acción | Quién |
|---|---|
| Leer nota o carpeta | cualquier rol (`lectura`+), o link `link-view`/`link-edit` |
| Editar contenido | rol `escritura`/`dueño`, o link `link-edit` |
| Cambiar ACL (`memberIds`, `roles`, `access`) | solo el dueño del documento |
| Cambiar nombre de carpeta | dueño o `escritura` (solo el campo `name`) |
| Mover nota de carpeta | dueño de la nota |
| Borrar nota / carpeta | solo el dueño |
| Escribir `updates` / `collab/state` / `presence` | quien pueda escribir la nota |
| Leer `userIndex` | uno por id (nunca `list`); escribir solo el propio `uid` |
| Colecciones no declaradas | denegado (catch-all) |

Una nota con `aclSource == 'folder'` no puede tener una ACL distinta a la de su carpeta:
la regla lo verifica con un `get()` de la carpeta, así que un cliente no puede
"auto-compartirse" editando el documento de la nota.

Validaciones activas en reglas: campos permitidos por colección (lista blanca), tipos,
`markdown` ≤ 250 KB, `title` ≤ 300 caracteres, `access` en enum, `ownerId` y
`createdAt` inmutables, el dueño no puede degradarse a sí mismo, `roles` y
`memberIds` deben estar sincronizados, updates ≤ 400 KB, presencia ≤ 4/8 KB.

Un editor nunca puede escalar privilegios: agregar miembros, cambiar el modo de
compartición, cambiar de dueño o reescribir `createdAt` está denegado por reglas
aunque el cliente lo intente a mano.

### Otras capas

- **API key restringida por referrer** a `md-sync-app.web.app`, `md-sync-app.firebaseapp.com`
  y `localhost` (5173/4173). Requests desde otro origen reciben 403.
- **Headers de seguridad** en Hosting: CSP (sin `unsafe-inline` en scripts, sin
  `object-src`, `frame-ancestors 'none'`), HSTS, `X-Frame-Options: DENY`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` (necesario para el popup de Google).
- **Cache**: assets hasheados inmutables; `index.html`, `sw.js` y el manifest sin cache
  (evita servir bundles viejos).
- **App Check** listo: definí `VITE_APPCHECK_SITE_KEY` (reCAPTCHA v3) y después
  *enforce* en la consola de Firebase. Sin la variable, la app funciona igual.
- **Auth**: solo Google. No hay usuario anónimo ni signup por email. La sesión se
  persiste en IndexedDB (`browserLocalPersistence`).
- **XSS**: el contenido se edita como documento ProseMirror y se serializa con
  `tiptap-markdown` (`html: false`), nunca se inyecta HTML crudo en el DOM.
- **Secretos**: `.env` no se commitea (la config web de Firebase no es secreta; lo que
  protege los datos son las reglas + la restricción de la API key).

### Recomendado para producción real

1. Habilitar **App Check** y pasar a *enforced*.
2. Plan **Blaze** + backups/PITR de Firestore.
3. Definir un presupuesto de alertas: cada sesión de tipeo escribe ~2 updates/s
   mientras se escribe (agrupados a 400 ms). Con uso intensivo conviene subir el
   debounce en `src/lib/collab/provider.ts` o mover el transporte a RTDB.

## Agentes de IA

Hay una CLI y un servidor MCP para que un agente lea y edite gastando lo mínimo. Ambos
devuelven **texto, no JSON**, y el agente es **una cuenta propia** (anónima de Firebase),
no la tuya: las reglas de seguridad se aplican igual que a una persona.

```bash
npm run mdfire -- login       # crea la identidad del agente
npm run mdfire -- whoami      # imprime el uid a vincular en la web
npm run mdfire -- ls          # id	título	fecha	carpeta
npm run mdfire -- cat 3f9a1c2b
npm run mdfire -- find harina
npm run mdfire -- patch 3f9a1c2b --etag 3-a1b2c3d4e5f6 --find '- dos' --replace '- dos
- tres'
npm run mdfire -- append 3f9a1c2b --text '- sal'
```

**Vinculación (2 pasos):**

1. `mdfire login` → imprime el uid del agente. El refresh token queda en
   `~/.config/mdfire/credentials.json` (0600) y se renueva solo.
2. En la app: menú de cuenta → **Agentes de IA** → pegás el uid, elegís carpeta y rol
   (**Lectura** o **Escritura**) → Vincular.

A partir de ahí el agente solo ve esa carpeta. Quitarle el acceso es quitarlo de
*Compartir* en la carpeta: el corte es inmediato porque la autoridad es el documento de la
carpeta, no la copia en cada nota.

### Por qué es barato

| Operación | Salida | Costo |
|---|---|---|
| `ls` (20 notas) | una línea por nota, 4 campos | ~10 tok/nota |
| `cat` | solo el markdown | = documento |
| `patch` | `ok 1 edits +7 4-9f2c1a` | ~12 tok |
| `find` | `id:línea: texto` | ~15 tok/hit |

Medido con los fixtures de `tests/agent.test.ts`: las mismas dos notas como JSON completo
son ~201 tokens; el listado TSV son ~20. `cat` devuelve un **etag**, así que el agente
edita sin releer: el parche se rechaza si el etag quedó viejo (`E_ETAG`), si el `find` no
existe, o si aparece más de una vez (`E_AMBIGUOUS`). Además del etag, el servidor manda el
`updateTime` leído como precondición del `commit`, así que una carrera falla en Firestore y
no pisa el trabajo de otra persona.

### Conectarlo como MCP

```jsonc
// .mcp.json de tu agente
{
  "mcpServers": {
    "mdfire": {
      "command": "node",
      "args": ["/ruta/al/repo/agent/mcp.mjs"]
    }
  }
}
```

Siete tools (`notes_list`, `notes_read`, `notes_patch`, `notes_append`, `notes_search`,
`notes_create`, `folders_list`), esquemas de una línea y resultados de texto.

### Autenticación en detalle

- `mdfire login` hace `accounts:signUp` con la API key web (pública) y guarda el refresh
  token; los ID tokens se renuevan contra `securetoken.googleapis.com`.
- Como la API key está restringida por referrer, las llamadas mandan
  `Referer: https://md-sync-app.web.app/` (configurable con `MDFIRE_REFERER`).
- Firestore se consume por **REST con el ID token del agente**, no con Admin SDK: si el
  agente no tiene permiso, Firestore devuelve `PERMISSION_DENIED` y la CLI explica que
  revise el rol.
- Para tests: `MDFIRE_ID_TOKEN` inyecta un token externo.

### Escrituras concurrentes

El editor sigue siendo la fuente de verdad del CRDT. Cuando el documento cambia por fuera
(agente, otra app), el editor detecta el markdown distinto al que él emitió y lo aplica al
documento Yjs (`tests/editor.test.tsx`). Si alguien está tipeando en ese momento, la
precondición del `commit` hace fallar al agente en vez de pisar el cambio.

## Tests

```bash
npm test             # 19 tests: convergencia CRDT, ACL/carpetas, editor en jsdom
npm run test:rules   # 63 tests de firestore.rules contra el emulador
npm run test:collab  # 7 tests de colaboración real (2 clientes, presencia, viewer)
npm run test:agent   # 17 tests de la CLI/MCP con reglas aplicadas (auth anónima real)
npm run test:all     # todo (requiere Java para el emulador)
```

Los tests de colaboración levantan el emulador de Firestore, conectan dos clientes Yjs
reales y verifican que convergen, que un cliente tardío se hidrata desde la bitácora y
que un extraño no puede leer ni escribir. `tests/editor.test.tsx` monta el editor en
jsdom para detectar roturas de wiring (extensiones, presence, modo solo lectura).

## Local

```bash
npm install
cp .env.example .env    # completar con la config del proyecto Firebase
npm run dev
```

```bash
npm run build
firebase deploy --only firestore:rules,firestore:indexes,hosting
```

> La query del sidebar (`memberIds array-contains` + `orderBy updatedAt`) necesita el
> índice compuesto de `firestore.indexes.json`. El emulador no lo exige; producción sí.

## Estructura

```
src/
├── components/
│   ├── CollaborativeEditor.tsx   Tiptap + Yjs + cursores remotos
│   ├── PaneBar.tsx               franja mínima: título, presencia, estado
│   ├── Menu.tsx                  menú contextual (compartir, mover, borrar, sesión)
│   ├── ShareDialog.tsx           roles, enlaces y alta por email
│   ├── InputDialog.tsx           crear / renombrar carpeta
│   ├── MoveDialog.tsx            mover nota entre carpetas
│   └── Sidebar.tsx               árbol de carpetas + notas
├── hooks/useFirebase.ts          sesión + workspace (notas/carpetas) + migración v1
├── lib/
│   ├── collab/provider.ts        transporte Yjs sobre Firestore
│   ├── collab/awareness.ts       presencia compatible con y-protocols
│   ├── collab/encoding.ts        base64 ↔ bytes/JSON
│   ├── acl.ts                    roles y cheques de permiso
│   ├── directory.ts              email → uid, nombres visibles
│   └── notes.ts                  modelo, CRUD, sharing, propagación
├── firebase.ts                   init, App Check, cache persistente
└── firebaseConfig.ts             config desde env
firestore.rules                   reglas (fuente de verdad de la seguridad)
agent/                            CLI + servidor MCP para agentes de IA
tests/                            reglas + colaboración + editor + agente
```

## UI

Estética deliberadamente sobria, al estilo Obsidian: un sidebar de archivos, una franja de
36 px con el título del documento y el estado, y el documento a pantalla completa con
título editable en línea. Sin botones grandes ni tarjetas: el estado de sync es un punto
de color (verde/ámbar/rojo) y el único acento es el violeta de la nota activa. El panel
lateral se colapsa y se recuerda en `localStorage`; en mobile entra como drawer.

## Licencia

MIT
