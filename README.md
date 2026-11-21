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

## Cómo funciona la colaboración

Firestore no trae un motor de colaboración, así que el documento se modela como un
**CRDT** y Firestore se usa solo como bitácora de updates:

```
folders/{folderId}                nombre + ACL de la carpeta
notes/{noteId}                    título, markdown serializado, ACL (propia o heredada)
notes/{noteId}/updates/{id}       updates incrementales de Yjs (base64)
notes/{noteId}/collab/state       snapshot compactado del documento
notes/{noteId}/presence/{uid}     presencia + cursor (heartbeat 15 s)
userIndex/{sha256(email)}         directorio para agregar colaboradores
profiles/{uid}                    nombre visible de cada persona
```

- Cada cliente tiene un `Y.Doc`. Los edits locales se agrupan cada 400 ms y se
  agregan como un documento en `updates`.
- `onSnapshot` entrega los updates de los demás y se aplican al mismo `Y.Doc`.
  Yjs es idempotente y conmutativo, así que el orden de llegada no importa y
  re-aplicar no duplica texto.
- Cuando la bitácora pasa de 120 updates, un cliente escribe el estado completo en
  `collab/state` y poda los updates ya incluidos.
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

## Tests

```bash
npm test             # 19 tests: convergencia CRDT, ACL/carpetas, editor en jsdom
npm run test:rules   # 63 tests de firestore.rules contra el emulador
npm run test:collab  # 7 tests de colaboración real (2 clientes, presencia, viewer)
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
tests/                            reglas + colaboración + editor
```

## UI

Estética deliberadamente sobria, al estilo Obsidian: un sidebar de archivos, una franja de
36 px con el título del documento y el estado, y el documento a pantalla completa con
título editable en línea. Sin botones grandes ni tarjetas: el estado de sync es un punto
de color (verde/ámbar/rojo) y el único acento es el violeta de la nota activa. El panel
lateral se colapsa y se recuerda en `localStorage`; en mobile entra como drawer.

## Licencia

MIT
