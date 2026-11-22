# Huella de memoria: dónde se va, qué se arregló y qué falta

Investigación y ejecución sobre la memoria del cliente web (React + Tiptap/ProseMirror + Yjs +
Firestore). Cada número sale de `tests/memory.probe.test.tsx` (heap de V8 después de forzar GC) o
del bundle de producción.

## 0. Estado

| # | Hallazgo | Estado | Medido antes | Medido ahora |
| --- | --- | --- | --- | --- |
| H3 | Trabajo y basura por tecla | **hecho** | ~3,2 ms y ~1 MB de basura por tecla (100 KB) | 0 ms de serialización; ~0,3 ms de comparación por edición; 0 basura |
| H2 | Un editor por panel, sin tope | **hecho (tope 4)** | paneles sin límite (4 paneles de 250 KB = 68 MB) | `MAX_PANES = 4`, acción deshabilitada con el presupuesto agotado |
| H5 | Bundle entero sin split | **hecho** | 1.692.553 B en un chunk | 76 KB gzip para el primer pintado; 208 KB (`AppTree`, Firebase) y 212 KB (`NotePane`, editor) diferidos |
| H6 | Import/export con picos de 2-3× | **hecho** | todas las entradas infladas + todos los cuerpos decodificados | plan de rutas + un cuerpo a la vez; export vía `Blob` |
| H4 | Cache de Firestore y contabilidad del log | **parcial** | LRU por defecto 40 MB; ids duplicados en `Set` + array | `cacheSizeBytes` 20 MB; un solo `Set` |
| H1 | El listado retiene todos los cuerpos | **hecho** | 300 notas × 20.000 car. = +5,91 MB | +0,05 MB de metadata; el cuerpo se lee sólo para la nota abierta |

## 1. Cómo se mide

```bash
NODE_OPTIONS="--expose-gc" npx vitest run --reporter=verbose --silent=false tests/memory.probe.test.tsx
```

`tests/memory.probe.test.tsx` construye notas, editores y documentos reales (las mismas extensiones
que la app, vía `buildEditorExtensions`) y mide el heap de V8 tras forzar GC. Está fuera de
`npm test` a propósito: los números se mueven con la versión de V8 y con la máquina; el valor está
en comparar antes/después, no en un umbral absoluto.

Cómo leer cada número:

- **Cuerpos de notas (strings)**: exacto. Un string JS es UTF-16, 2 bytes por carácter, igual en
  jsdom y en Chrome. 19,5 KB de UTF-8 con acentos ocupan 39,1 KB de heap.
- **Editor (ProseMirror)**: **cota inferior**. En jsdom no hay nodos de DOM; la forma de la curva
  (lineal en el tamaño del documento, ~88 plugins por editor) sí es representativa.

En el navegador: DevTools → Memory → *Heap snapshot* antes/después de abrir N notas, comparados por
*Size delta* (`JSObject`, strings, nodos de ProseMirror, `QueryDocumentSnapshotImpl`).

## 2. Números de referencia (sin cambios)

| Escenario | Heap |
| --- | --- |
| 300 notas × 20.000 caracteres, tal como las guarda el listado (H1) | **+5,91 MB** |
| Las mismas 300 notas sin `markdown` | +0,05 MB |
| Un cuerpo de 20.000 caracteres | 39,1 KB de heap (19,5 KB de UTF-8) |
| Editor con documento de 10 KB | +2,84 MB |
| Editor con documento de 50 KB | +4,67 MB |
| Editor con documento de 100 KB | +7,35 MB |
| Editor con documento de 250 KB (= `MAX_MARKDOWN_BYTES`) | +16,92 MB |
| Segunda vista (split) sobre el **mismo** documento | +1,51 MB |
| Segunda nota de 100 KB en otro panel | +7,32 MB |

Costo de un editor: **~2,5 MB fijos + ~50× el tamaño del Markdown**.

## 3. H3 — lo que se hacía en cada tecla (hecho)

**Antes.** `CollaborativeEditor.onUpdate` serializaba el documento entero a Markdown en **cada
tecla** (0,55 ms + una copia del cuerpo: ~198 KB en una nota de 100 KB) para compararlo con lo
último emitido. Después `sameMarkdown` normalizaba **los dos** strings completos (0,85 ms y hasta
dos copias más), y el mismo par de pasadas se repetía en `NotePane.handleMarkdownChange`. Encima,
`TagHighlight` recalculaba todas las decoraciones en **cada transacción**: tecla propia, movimiento
de cursor y update de presencia de otro peer (0,98 ms y ~429 objetos `Decoration` por vez en una
nota de 100 KB).

**Ahora.**

- `src/lib/editor/markdownEmitter.ts`: la serialización es trailing-debounced (400 ms). Una ráfaga
  de teclas produce **una** serialización; el resto sólo marca "sucio". El emisor conserva las
  reglas que evitaban escribir al abrir una nota: adoptar un cambio externo (agente, otro
  dispositivo) y no emitir el documento vacío transitorio del rebuild. Además vacía lo pendiente al
  desmontar, así que cerrar una pestaña ya no descarta lo último tipeado.
- `sameMarkdown` (`src/lib/markdown.ts`) compara en una sola pasada, sin normalizar y **sin asignar
  memoria**: recorre los dos strings salteando exactamente lo que `normalizeMarkdown` recorta (`\r`
  de un `\r\n`, espacios/tabs antes de un salto, whitespace final). Tiene un test que verifica la
  equivalencia con `normalizeMarkdown` sobre 22 documentos × 22 (484 pares, incluidos CRLF, `\r`
  suelto y espacios al final de línea).
- `TagHighlight` guarda el `DecorationSet` como estado del plugin: sólo se reconstruye cuando el
  documento cambió. Mover el cursor, seleccionar o recibir presencia de un peer ya no escanea nada.

**Medido ahora** (documento de 100 KB, 429 tags):

| | antes | ahora |
| --- | --- | --- |
| serialización por tecla | 0,55 ms + 197,6 KB | 0 (una vez por ráfaga) |
| comparación por edición | 0,87 ms × 2 + 2 copias | 0,29 ms (contenido distinto) / 0,67 ms (sólo whitespace final), 0 bytes asignados |
| decoraciones por transacción | 0,98 ms + 429 objetos | 0,013 ms (reusa el set) |
| **total por tecla** | **~3,2 ms + ~1 MB de basura** | **~0 ms de serialización; sólo el rebuild de tags cuando el texto cambia** |

Los tests que sostienen esto: `tests/markdownEmitter.test.ts` (6 casos: ráfaga, eco, vacío
transitorio, adopción externa, flush al desmontar), `tests/markdown.test.ts` (equivalencia de
`sameMarkdown`) y `tests/editor.test.tsx` (el set de decoraciones se reusa en una transacción de
selección y se reconstruye al tipear un tag nuevo).

## 4. H2 — un editor por panel, con tope (hecho)

Cada panel monta su propio editor para su pestaña activa (`src/components/NotePane.tsx`), y
`panes.ts` no limitaba cuántos: sólo la profundidad del árbol (`MAX_DEPTH = 24`). Cuatro paneles con
notas de 250 KB son ~68 MB.

Ahora `MAX_PANES = 4` (`src/lib/panes.ts`), `canSplit()` decide, `splitPaneAt` no hace nada si el
presupuesto está agotado y los menús muestran la acción deshabilitada con la etiqueta
`Máximo de paneles (4)` (`MenuItem.disabled` en `src/components/Menu.tsx`). Cerrar un panel devuelve
el presupuesto (test en `tests/panes.test.ts`).

Queda pendiente, y no es memoria sino política de producto: bajar `MAX_MARKDOWN_BYTES` de 250 KB o
abrir por encima de ese umbral en modo lectura (sin ProseMirror), que es lo que hace Obsidian con
archivos enormes. Hoy 250 KB sigue siendo posible y cuesta ~17 MB por editor.

## 5. H5 — el bundle ya no entra entero (hecho)

`dist`: **1.693 kB → 967 kB** en el chunk inicial, más `NotePane-*.js` (729 kB) que se carga sólo
cuando hay una nota abierta. El stack Tiptap + ProseMirror + Yjs + serializador de markdown dejó de
parsearse en la pantalla de login.

```tsx
const NotePane = lazy(() =>
  import('./components/NotePane').then((module) => ({ default: module.NotePane }))
)
```

con un `Suspense` que muestra `Cargando editor…` dentro del área de trabajo. `Workspace` sigue
eager: son 146 líneas que sólo dependen de `panes.ts`.

**Segunda pasada: Firebase fuera del arranque.** El chunk inicial seguía pesando 972 kB porque el
SDK (Firestore + Auth) se importaba desde `App`, el primer módulo que toca React. El árbol
autenticado se mudó a `src/AppTree.tsx` y `src/App.tsx` quedó como shell de ~40 líneas que lo pide
con `lazy()`:

| chunk | raw | gzip | brotli | cuándo |
| --- | --- | --- | --- | --- |
| `index-*.js` + `index-*.css` (shell) | 261 kB | **76 kB** | 66 kB | primer pintado |
| `AppTree-*.js` (Firebase + lógica) | 699 kB | 208 kB | 176 kB | `modulepreload`, en paralelo |
| `NotePane-*.js` (Tiptap + Yjs) | 635 kB | 212 kB | 178 kB | al abrir una nota |

El primer pintado pasó de **296 kB gzip a 76 kB (−74 %)** y su parseo de 14,3 ms a 3,1 ms. Para que
el `lazy()` no costara un round trip extra, `preloadAppTree()` en `vite.config.ts` inyecta un
`<link rel="modulepreload">` al chunk de `AppTree`: los dos bajan en paralelo, así que el pintado es
mucho más temprano y la interactividad no cambia.

**`re2js`: 46 kB gzip de peso muerto.** `@firebase/firestore` lo importa con un `import 're2js'` de
sólo efectos secundarios, que ningún bundler puede sacar por tree-shaking. Sus únicos tres usos son
`RE2JS.compile` en los evaluadores de *Pipelines* (`regex_match`, `regex_contains`, `LIKE`), que
esta app no usa, y cada llamada ya está en `try/catch`. `resolve.alias` lo reemplaza por
`src/lib/vendor/re2js-stub.ts`, que tira un error explicando el motivo. Medido: 151 kB min / 46,7 kB
gzip.

`tests/bundle-budget.test.ts` camina el grafo de imports estáticos desde `main.tsx` y falla si
Firebase vuelve a entrar por esa puerta, si el grafo de arranque crece, o si el alias desaparece.

## 6. H6 — import/export sin picos de 2-3× (hecho)

**Import.** Se separó en dos pasadas:

1. `planVault(zipBytes)` (`src/lib/vault.ts`) lee **sólo el directorio del ZIP** (nombres y
   tamaños, `zipEntryInfos` en `src/lib/unzip.ts`): decide qué es nota, qué se descarta y qué
   carpeta le toca, incluido el strip de la carpeta wrapper. Costo: unos cientos de KB por vault.
2. `streamVaultNotes(zipBytes, plan)` infla y decodifica **una entrada por vez**
   (`unzipEach`, generador async) y el importador la escribe y la suelta.

**Export.** `zipStoredBlob` (`src/lib/export.ts`) entrega los chunks de ZIP a un `Blob` en vez de
armar un `Uint8Array` contiguo, y `download` acepta el `Blob` directamente: se eliminaron dos copias
completas del vault (la armada y la que hacía `download`).

Nota sobre los límites: `unzip` mantiene sus dos topes —`maxBytes` por entrada **y** acumulado
(lanza `el ZIP es demasiado grande`), `maxEntries` 2.000— y `MAX_MARKDOWN_BYTES` (250 KB) sigue
aplicando a las notas, pero ahora se evalúa sobre el tamaño que declara el ZIP antes de inflar nada.
`readVault` sigue existiendo (compone plan + stream) para tests y para el CLI.

## 7. H4 — Firestore: cache acotado y contabilidad sin duplicados (parcial)

Hecho:

- `persistentLocalCache({ cacheSizeBytes: 20 * 1024 * 1024 })` (`src/firebase.ts`) en lugar del LRU
  por defecto de 40 MB. Un documento abierto vive dos veces en el cache (la query del sidebar y la
  del documento), así que el tope importa.
- `appliedIds` era un `Set` **y** un array en paralelo con los mismos ids
  (`src/lib/collab/provider.ts`). Ahora es un solo `Set`, que en JS conserva el orden de inserción:
  sirve para "¿ya lo apliqué?" y para saber qué pliega el snapshot al compactar.

Pendiente (deliberadamente): la query de `notes/{id}/updates` no tiene `limit()`
(`src/lib/collab/provider.ts:151`). La idea es `orderBy('jid','desc') + limit(N)` apoyada en el
manifest (todo bloque con `jid <= manifest.jid` ya está plegado en el snapshot). No se hizo porque
**no se pudo validar**: los tests de emulador (`npm run test:collab`, `test:rules`, `bench:sync`)
no corren en esta máquina —`firebase emulators` aborta con `Unable to locate a Java Runtime`—, y
tocar la query de sync sin poder correr esa suite es la clase de cambio que pierde texto en
silencio. El detalle está en §9.

## 8. H1 — el listado ya no baja los cuerpos (hecho)

**Qué pasaba.** `subscribeMyNotes` se suscribe a toda la colección `notes`, sin límite y sin
proyección, y el cuerpo viajaba en el mismo documento: 5,91 MB de heap para 300 notas de
20.000 caracteres, más todo el vault en la primera descarga, con `loading` apagándose recién
cuando llegaba el último cuerpo.

**Qué se hizo.**

- El cuerpo vive en `notes/{id}/body/main` (`markdown`, `bytes`, `version`, `updatedAt`), con la
  misma ACL que su nota. La nota conserva `markdownBytes`, así que el listado puede totalizar
  almacenamiento sin bajar texto.
- `subscribeNoteBody` reemplaza a la suscripción de documento por nota abierta: la metadata ya
  viene del listado, así que una pestaña sólo pide el texto. Un `?note=` que el listado todavía
  no conoce cae en `subscribeNote` (una sola vez, mientras el listado no lo tenga).
- `saveNoteContent` escribe cuerpo + metadata en **un commit** (un round trip, nunca media nota
  guardada) y borra el `markdown` inline heredado con `deleteField()`.
- `fetchNoteBodies` lee cuerpos bajo demanda para las dos operaciones masivas: exportar el vault y
  renombrar un tag. La migración (`migrateNoteBodies`) mueve los cuerpos inline que el listado
  todavía entregue, una vez, sin bloquear y sin perder nada si falla.
- El import crea nota + cuerpo en el mismo lote; el agente (`agent/core.mjs`) lee y escribe el
  cuerpo con `patchMany` (CAS sobre la nota) y su `etag` ahora cubre el texto, no la metadata.

**Efecto medido.** Un vault de 300 notas × 20.000 caracteres pasa de **+5,91 MB** permanentes a
**+0,05 MB** (sólo metadata); el cuerpo de la nota abierta se lee una vez y sólo esa. La primera
carga deja de descargar el corpus entero, y con él el bloqueo de `loading`.

**Compatibilidad.** Las notas viejas siguen funcionando: `toNote` mantiene el cuerpo inline como
`markdown`, `fetchNoteBodies` cae al documento de la nota si no hay `body/main`, y la migración se
dispara sola cuando el listado muestra una nota en el formato viejo.

## 9. Orden y estado

| Etapa | Cambios | Estado |
| --- | --- | --- |
| 1 | H3: emitir al guardar, comparación barata, decoraciones memoizadas | hecho |
| 2 | H2 (tope de paneles) + H5 (code splitting) + H6 (streaming) | hecho |
| 3 | H4 (tope de cache + contabilidad; falta el `limit` de `updates`) | parcial |
| 4 | H1 (metadata/cuerpo separados + migración) | hecho |

## 10. Latencia percibida (el resto del triage)

Los cuatro cambios que no son memoria, todos medibles en "cuántos round trips espera el usuario":

| Punto | Antes | Ahora |
| --- | --- | --- |
| Importar un vault | 2 escrituras **secuenciales** por nota (crear + contenido): 1.000 RTT para 500 notas, minutos | 2 documentos por nota en **un commit por lote de 50**: ~10 RTT para 500 notas |
| Reordenar (subir/bajar) | renumera y reescribe **todos** los hermanos (100 escrituras en una carpeta de 100), y >500 rompía el batch | 1 escritura en el caso normal (`moveOrder` usa el hueco de 10), renumber sólo cuando el hueco se agota, lotes de 400 |
| Ver el reorden aplicado | esperar el snapshot (≈RTT) | `applyOrderOverride` muestra el orden nuevo en el frame; se descarta cuando el servidor coincide o la escritura falla |
| Crear carpeta | 2 RTT (alta + snapshot) | 1: id reservado en cliente, fila optimista, y se revierte con aviso si falla |

Dos detalles de implementación que evitan sorpresas: el override de orden deja al final los
items que no conoce (una nota creada en otro dispositivo no desaparece), y el import reintenta
un lote fallido nota por nota para no perder las otras 49.

`subscribeEntitlement` y `subscribeUserSettings` quedaron como estaban: dos documentos de pocos
campos, un listener cada uno, y condicionan menús ya visibles (hacerlos perezosos cambia un
listener por un parpadeo).

## 11. Cómo verificar

- **Probe**: `NODE_OPTIONS="--expose-gc" npx vitest run --reporter=verbose --silent=false
  tests/memory.probe.test.tsx` y comparar con §2 y §3.
- **Tests unitarios**: `npm run test:unit` (209 tests, incluidos los nuevos
  `markdownEmitter.test.ts`, la equivalencia de `sameMarkdown`, el tope de paneles, el plan/stream
  del vault y el reuso de decoraciones).
- **Sin cobertura ejecutable en esta máquina**: `test:rules`, `test:collab`, `test:agent`,
  `test:vault` y `bench:sync` necesitan el emulador de Firestore y aquí no hay runtime de Java. Los
  cambios de esta tanda no tocan reglas ni el transporte (`provider.ts` sólo cambia la estructura
  que registra ids aplicados), pero conviene correr las cuatro suites en una máquina con Java antes
  de dar por cerrado H4.
- **Navegador**: heap snapshot antes/después de abrir 10 notas y de escribir un párrafo en una nota
  de 100 KB; es el único lugar donde se ve el costo real de los nodos de DOM que jsdom no tiene.
