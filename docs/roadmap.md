# Backlog de producto (ideas para después)

Cinco pedidos anotados el 21-nov-2026, con el diseño técnico que ya se desprende del código
actual. **Nada de esto está implementado**; el orden sugerido está al final.

Contexto que condiciona todo: hoy el cliente es la única parte con lógica de negocio
(el proyecto está en Blaze, pero todavía no hay Cloud Functions). Varias de estas features
—cobro por uso, auto top-up, medición real— necesitan una parte **confiable** del lado
servidor: sin Functions, cualquier medición hecha en el cliente se puede falsear y sirve solo
para *mostrar*, no para *cobrar*.

---

## 1. Tags en notas y carpetas (estilo Obsidian) — ✅ implementado (21-nov-2026)

**Qué**: `#tag`, `#a/b` anidados y `tags:` en frontmatter, con filtro en el sidebar.

**Diseño**

- Fuente de verdad: el markdown (igual que Obsidian). Se derivan al guardar y se denormalizan
  en el documento para poder consultarlos:
  - `notes/{id}.tags: string[]` (≤ 30 tags, cada uno ≤ 50 chars, `[a-z0-9/_-]`)
  - `folders/{id}.tags: string[]` (mismos límites)
- Parseo: `#tag` fuera de bloques de código y de URLs, más `tags: [a, b]` del frontmatter.
  Se normaliza a minúsculas, sin `#`, con `/` para anidar.
- Consulta: `where('tags','array-contains', tag)` + `orderBy updatedAt` → **índice compuesto
  nuevo** en `firestore.indexes.json`. El sidebar suma una fila de chips con los tags de la
  sesión (derivados de las notas ya cargadas, sin lectura extra).
- Reglas: validar el array en `validNote`/`validFolder` (tipo, tamaño, cantidad, regex).
  Los tags no cambian permisos: quien puede escribir la nota puede cambiar sus tags.
- Superficie: chips bajo el título (editables), panel de filtro, y `firemd tags` en el CLI.

**Riesgos / decisiones**: ¿tags de carpeta se heredan a las notas? (propuesta: no, son
independientes, para no confundir con la ACL). ¿Los tags entran en la búsqueda del agente?
(propuesta: sí, `firemd find --tag`).

**Tamaño**: M · **Depende de**: nada.

**Carpetas anidadas** (implementado 21-nov-2026): `folders.parentId` con árbol en el sidebar,
"Nueva subcarpeta…" en el menú de carpeta, mover carpeta con control de ciclos
(`canMoveFolder`), tope de profundidad 6, borrar una carpeta re-cuelga sus hijas del padre, y
el import/export reconstruye la jerarquía real. **Cada carpeta mantiene su propia ACL**: no hay
herencia entre carpetas (las reglas no pueden recorrer una cadena), así que compartir un padre
no comparte hijas — documentado y cubierto por tests.

**Paridad con Obsidian**: resaltado inline en el editor (`TagHighlight`, decoración de
ProseMirror), mayúsculas conservadas con agrupación case-insensitive (`tagKey`), árbol de
etiquetas en el sidebar con conteos de descendientes, filtro múltiple con semántica **AND** y
prefijo (`#clientes` incluye `#clientes/acme`), renombrado/fusión de etiqueta en todas las notas
editables, y **paneles colapsados por defecto** (etiquetas y propiedades). Verificado: `#123` no
es tag, `tag:` singular soportado. **Falta**: autocompletado al escribir `#` (el único punto de
paridad pendiente).

**Implementado**: `src/lib/tags.ts` (parseo de `#tag`, `#a/b`, frontmatter, código y URLs
excluidos), `tags: string[]` denormalizado en notas y carpetas, chips de filtro en el sidebar,
etiquetas visibles bajo el título, "Etiquetas…" en el menú de carpeta, y en el CLI
`firemd tags`, `firemd find --tag` (también como `tags_list` en MCP). El CLI mantiene el campo
al parchear; reglas validan lista y tope de 30 (no pueden recorrer elementos).

---

## 2. Importar / exportar vault de Obsidian — ✅ implementado (21-nov-2026)

**Qué**: botón "Importar vault…" y "Exportar vault…" que produzcan/consuman la estructura
real de una carpeta Obsidian.

**Diseño**

- **Export** (ya hay base: `src/lib/export.ts` escribe ZIP *store* sin dependencias):
  - mismo ZIP, pero con nombres y contenidos compatibles: notas en `.md` respetando carpetas,
    frontmatter intacto, `[[wikilinks]]` sin tocar, y un `.obsidian/` mínimo **opcional**
    (solo `app.json` vacío) para que Obsidian abra la carpeta sin quejarse.
  - nombre sugerido `firemd-vault-YYYY-MM-DD.zip`.
- **Import**: aceptar `.zip` (vault completo) o `.md` sueltos (ya implementado).
  - Descomprimir **sin dependencias** con `DecompressionStream('deflate-raw')`
    (Baseline: Chrome/Safari/Firefox modernos) y un lector de ZIP propio: parsear el directorio
    central, ignorar `.obsidian/`, `.trash/`, binarios y `.git/`.
  - Mapear cada carpeta del ZIP a una carpeta de la app (crear si falta) y cada `.md` a una
    nota; el título sale del `# H1`, del frontmatter `title:` o del nombre del archivo.
  - Conflictos: si ya existe una nota con el mismo título en la misma carpeta, sufijar ` (2)`.
  - Límites: máx. 500 archivos / 20 MB por import, con progreso y resumen al final.
- **Bloqueante conocido**: **adjuntos** (imágenes, PDFs). El modelo actual no tiene blobs
  (`notes` solo guarda markdown). Un vault con imágenes importa el `.md` pero los links quedan
  rotoa. Decidir antes: (a) soportar adjuntos en Cloud Storage + `attachments/{uid}` (requiere
  Blaze, cambia el modelo y el export), o (b) importar solo el texto y avisar explícitamente.

**Riesgos**: ZIPs de Obsidian usan deflate (por eso `deflate-raw`), nombres no ASCII,
archivos de más de 250 KB (límite actual por nota), wikilinks que apuntan a notas renombradas.

**Tamaño**: M (sin adjuntos) / L (con adjuntos) · **Depende de**: nada para texto; adjuntos
dependen de Blaze.

**Implementado**: `src/lib/unzip.ts` (lector ZIP propio: EOCD, directorio central, método
*stored* y **DEFLATE** con `DecompressionStream('deflate-raw')`, sin dependencias),
`src/lib/vault.ts` (import: carpetas por primer segmento, `.obsidian/`, `.trash/`, `.git/` y
adjuntos omitidos y reportados; export: notas por carpeta + `.obsidian/app.json`).
Verificado leyendo un ZIP armado con el comando `zip` (deflate real) y `unzip -l` sobre el
ZIP que generamos.

---

## 3. Archivos locales: CLI o app de sync (Windows/Mac) — ✅ CLI y app implementados

**Qué**: mantener una carpeta local (el vault) espejada con la nube, para editar con cualquier
editor y con Obsidian.

**Diseño**

- **CLI primero** (reusa `agent/core.mjs`, que ya habla Firestore REST con la identidad del
  agente y respeta reglas):
  - `firemd vault pull [--dir ~/Vault]` → escribe `carpeta/nota.md` desde la nube.
  - `firemd vault push` → sube cambios locales por nota, comparando **etag** (el hash de
    contenido que ya existe) para no pisar ediciones remotas.
  - `firemd vault watch` → `fs.watch` + debounce 500 ms; cada archivo modificado se aplica con
    `patch` sobre el documento (no reescritura completa) para no romper el CRDT del editor.
  - Manifiesto local `.firemd/sync.json` con `{ ruta: { id, etag, updatedAt } }`.
- **App de escritorio** (hecha): Tauri 2 con bandeja del sistema, login con la cuenta del
  sitio (Google, por loopback al navegador) o con un agente anónimo, selector de carpeta base,
  start/stop y vista de conflictos. Ciclo automático cada 15 s (pull y
  después push) en vez de `fs.watch`: menos casos raros con los guardados atómicos de Obsidian
  y el mismo resultado para el usuario. Windows: MSI/NSIS; Mac: DMG (firmar requiere cuenta
  Apple Developer, $99/año — costo a presupuestar; el build sin firmar funciona con Gatekeeper
  avisando la primera vez).
- **Conflictos**: gana el último etag; si los dos lados cambiaron, se guarda
  `nota.conflicto-YYYYMMDD.md` con la versión local en vez de perderla.
- **Convivencia con el editor**: escribir desde disco es una edición externa; el editor ya
  reconcilia cambios externos al documento Yjs (`CollaborativeEditor`), así que la ventana de
  carrera es la misma que con un agente.

**Riesgos**: permisos (el agente es miembro con rol Lectura/Escritura: sirve), adjuntos
(mismo bloqueante que el punto 2), watch en Windows con rename/atomic saves de Obsidian.

**Tamaño**: M (CLI) + M (app de escritorio) · **Depende de**: nada para CLI; app depende de
certificados y de decidir adjuntos.

**Implementado (CLI)**: `firemd vault pull|push` (`agent/vault.mjs`) con manifiesto
`.firemd/manifest.json`, escritura por `replaceNote` con precondición de `updateTime`, y
**archivo de conflicto** `<nota>.conflicto-YYYYMMDD-HHMM.md` si el remoto cambió: nunca pisa ni
descarta. Los archivos nuevos solo se aceptan dentro de una carpeta compartida (el agente no
puede crear notas sueltas ajenas).

**Implementado (app de escritorio)**: `desktop/` (Rust + Tauri 2), mismo manifiesto y mismos
archivos de conflicto que el CLI, así que se puede usar la misma carpeta con los dos. El motor
en Rust reusa el modelo de datos y las reglas de Firestore tal cual (sin Admin SDK): entra con
tu cuenta del sitio o con un agente anónimo. Ciclo automático: pull (no toca archivos con
cambios locales sin subir) y push (etag viejo → conflicto, nunca pisa). Ver `desktop/README.md`.

**Login con la cuenta (loopback)**: Google rechaza el OAuth dentro de webviews embebidos, así
que la app abre el navegador del sistema en `/?desktop=<puerto>&state=<nonce>` (página
`src/DesktopLink.tsx`), y esa página le devuelve el refresh token a un servidor local efímero
en `127.0.0.1`. Es el patrón de `gh auth login`. Requiere deployar el sitio con el `connect-src`
de `http://127.0.0.1:*` en el CSP (`firebase.json`).

**Documentación para agentes**: `/agent.md` (publicado desde `public/`, servido como
`text/plain`) con instalación, login y todos los comandos, más `/llms.txt` como índice. Es la
referencia que se le pasa a un agente en vez de un prompt ad-hoc.

**Agentes conectados**: cada sesión que entra con la cuenta se registra en `agents/{id}`
(`agent/agents.mjs`) y aparece en la app (menú de cuenta → *Agentes conectados*), donde se
puede renombrar; `firemd name` hace lo mismo desde la terminal. El registro no concede
permisos: desde que la sesión entra con la cuenta del usuario, ya tiene los suyos. El pareado
por uid (`login --agent`) sigue disponible para el modelo anónimo.

---

## 4. Página de uso (transferencia / datos / almacenamiento) — ✅ implementado (21-nov-2026)

**Qué**: pantalla donde el usuario ve qué consume y cuánto costaría.

**Diseño**

- **Lo que ya se puede medir hoy, gratis y sin servidor**: el provider de sync ya expone
  `stats` (bloques escritos/leídos, bytes escritos/leídos, compactaciones,
  bloques rechazados) y el editor conoce el tamaño de cada nota.
- Propuesta: `usage/{uid}` con `{ month: 'YYYY-MM', blocksWritten, blocksRead, bytesWritten,
  bytesRead, storageBytes, updatedAt }`, actualizado por el cliente con incrementos
  debounced (1 escritura cada ~30 s como mucho, no por keystroke).
  - **Almacenamiento**: suma de `markdown.length` de las notas del usuario (se recalcula al
    abrir la página, no se guarda por nota).
  - **Transferencia**: bytes del sync + export/import.
- La página muestra: notas y carpetas, almacenamiento, escrituras/lecturas del mes, y una
  estimación de costo con la tabla pública de Firestore ($0.03/100k lecturas, $0.09/100k
  escrituras) más el precio del plan.
- **Honestidad**: la medición es del cliente → sirve para *transparencia*, no para facturar.
  Si se cobra por uso, la medición tiene que venir de un contador del servidor (Cloud
  Function que agregue por evento) o de los contadores de Firestore por proyecto.
- Reglas: `usage/{uid}` propio, solo lectura de su dueño, escritura validada (mes con formato
  `YYYY-MM`, enteros no negativos, ≤ 12 registros por año).

**Tamaño**: S · **Depende de**: nada para transparencia; cobro real depende de Blaze.

**Implementado**: `usage/{uid}/months/{YYYY-MM}` con contadores incrementales (escrituras,
lecturas, borrados y bytes), alimentado por los `stats` del provider cada 30 s, más
`storageBytes` recalculado desde las notas. El bucket mensual evita mezclar meses y el
diálogo muestra el desglose completo (operaciones, storage, PITR/backup y egress). Reglas:
solo el dueño escribe, id `YYYY-MM`, enteros no negativos. El documento viejo `usage/{uid}`
queda escribible un ciclo de deploy para clientes cacheados.

La CLI y el MCP también escriben en el mismo bucket: `agent/firestore-rest.mjs` cuenta
reads/writes/deletes por request y `flushUsage()` los vuelca con incrementos; la CLI
vuelca al terminar cada comando y el MCP cada 30 s y al recibir SIGINT/SIGTERM. Un agente
anónimo mide en su propio bucket (su uid), no en el del dueño de la carpeta: las reglas
solo dejan escribir el bucket propio. El rate limit y el presupuesto por corrida siguen
frenando el costo; el medidor ahora además lo mide.

**Cuota y créditos**: `src/lib/quota.ts` define la cuota diaria renovable (100 MB y 700
operaciones/día) y el diálogo muestra barras de uso con aviso al 80%. La CLI y el MCP cortan
al llegar al tope de operaciones; las cuentas admin no tienen tope. `src/lib/credits.ts`
define los packs de $5/$15/$50 con vencimiento a 24 meses, la configuración de auto top-up
(el dueño la edita sin tocar el saldo) y las solicitudes de recarga en
`credits/{uid}/topups`. Falta el backend que debite saldo y acredite recargas, y el proveedor
de pagos.

> **Superado** por [`prepaid-usage-model.md`](prepaid-usage-model.md) D6: la gratuidad pasa a
> ser una **cuota diaria renovable de 100 MB + 700 operaciones** (mismo contador para humanos
> y agentes), y el tiempo real pasa a ser pago (D1). El cobro es **por día**: uso sobre la
> cuota + margen. `quota.ts` deja de ser decorativo recién cuando el proxy es el único
> escritor (§3.2 de ese documento).

---

## 5. Auto top-up de créditos (mínimo $5) — 🟡 modelo, UI y solicitudes listos, falta el cobro

**Qué**: recarga automática cuando el saldo baja de un umbral, con un mínimo de $5.

**Diseño**

- Modelo: `credits/{uid}` con `{ balanceUsd, thresholdUsd, topUpUsd, autoTopUp }`
  y un libro mayor `credits/{uid}/ledger/{id}` (cargo/recarga, motivo, timestamp) para que el
  usuario pueda auditar. El dueño edita la configuración; el saldo y el ledger los escribe
  solo el servidor. Cada recarga pedida queda en `credits/{uid}/topups` como solicitud
  pendiente.
- Flujo: al quedar el saldo bajo el umbral, se dispara un cargo **off-session** al método
  guardado. Eso **exige backend** (webhook + idempotencia + reintentos + factura): no se puede
  hacer desde el cliente sin exponer la clave del proveedor.
- **El mínimo de $2 es caro**: las comisiones se comen el margen.
  | Monto | Stripe (2.9% + $0.30) | Merchant of Record (~5% + $0.50) |
  |---|---|---|
  | $2 | $0.36 (18%) | $0.60 (30%) |
  | $5 | $0.45 (9%) | $0.75 (15%) |
  | $10 | $0.59 (6%) | $1.00 (10%) |
  Recomendación: aceptar $2 como mínimo **configurable** pero empujar packs de $5/$10; o
  absorber el fee como costo de adquisición y reflejarlo en el precio del uso.
- Proveedor: Stripe **no opera desde Uruguay**; alternativas con cobros recurrentes/off-session
  y cobertura LatAm: MercadoPago (UY), dLocal, o un Merchant of Record (Paddle/Lemon Squeezy)
  que además resuelve IVA. Decidir antes de escribir código.
- Requisitos no obvios: **SCA/3DS** en el primer cobro, política de reintentos, tope de
  recargas por día, notificación al usuario, y reembolsos.

**Tamaño**: L · **Depende de**: Blaze + el proxy de [`prepaid-usage-model.md`](prepaid-usage-model.md)
§3 (es el que debita y acredita), proveedor de pagos elegido y punto 4 (medición real).
Ya **no** depende de `entitlements`: ese eje se retira (D8 de ese documento).

**Hecho**: `credits/{uid}` con `balanceUsd`, `thresholdUsd`, `topUpUsd` (regla: **≥ $5**),
`autoTopUp` y libro mayor `ledger/` **inmutable**; el usuario solo lee, un admin escribe (un
cliente no puede acreditarse saldo). La UI muestra saldo, umbral y recarga mínima dentro del
diálogo de uso. **Falta**: cobro off-session, webhook idempotente, SCA/3DS, reintentos,
factura y proveedor (Stripe no opera en UY).

---

## Orden recomendado

| Fase | Qué | Por qué en ese orden |
|---|---|---|
| 1 | **Tags** (1) | Aislado, sin dependencias, valor inmediato para organizar. |
| 2 | **Export/Import de vault** (2, sin adjuntos) | Cierra la promesa "tus archivos" del plan comercial; hoy no hay import de vault. |
| 3 | **CLI `vault`** (3) | Reusa el CLI que ya existe; convierte la app en algo que convive con Obsidian. |
| 4 | **Página de uso** (4) | Transparencia y base para decidir precios; requiere el contador de `usage`. |
| 5 | **Blaze + Functions** | Prerrequisito de todo lo que factura. |
| 6 | **Adjuntos** (2 completo) | Sin blobs, los vaults reales quedan a medias. |
| 7 | **Auto top-up** (5) | Último: depende de 4, 5 y del proveedor de pagos. |

## Decisiones abiertas

1. ¿Los tags de carpeta se heredan a las notas? (propuesta: no)
2. ¿Se soportan adjuntos? (define si el import/export es compatible de verdad)
3. ¿Proveedor de pagos: MoR global o MercadoPago/dLocal local?
4. ¿El mínimo de recarga es $2 fijo o configurable por usuario?
5. ¿La mini app se hace con Tauri (liviana) o Electron (más simple, 5× más pesada)?
