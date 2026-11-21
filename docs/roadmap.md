# Backlog de producto (ideas para después)

Cinco pedidos anotados el 21-nov-2026, con el diseño técnico que ya se desprende del código
actual. **Nada de esto está implementado**; el orden sugerido está al final.

Contexto que condiciona todo: hoy el cliente es la única parte con lógica de negocio
(no hay Cloud Functions, el proyecto está en Spark). Varias de estas features —cobro por uso,
auto top-up, medición real— necesitan una parte **confiable** del lado servidor: hasta pasar a
Blaze + Functions, cualquier medición hecha en el cliente se puede falsear y sirve solo para
*mostrar*, no para *cobrar*.

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
- Superficie: chips bajo el título (editables), panel de filtro, y `mdfire tags` en el CLI.

**Riesgos / decisiones**: ¿tags de carpeta se heredan a las notas? (propuesta: no, son
independientes, para no confundir con la ACL). ¿Los tags entran en la búsqueda del agente?
(propuesta: sí, `mdfire find --tag`).

**Tamaño**: M · **Depende de**: nada.

**Implementado**: `src/lib/tags.ts` (parseo de `#tag`, `#a/b`, frontmatter, código y URLs
excluidos), `tags: string[]` denormalizado en notas y carpetas, chips de filtro en el sidebar,
etiquetas visibles bajo el título, "Etiquetas…" en el menú de carpeta, y en el CLI
`mdfire tags`, `mdfire find --tag` (también como `tags_list` en MCP). El CLI mantiene el campo
al parchear; reglas validan lista y tope de 30 (no pueden recorrer elementos).

---

## 2. Importar / exportar vault de Obsidian

**Qué**: botón "Importar vault…" y "Exportar vault…" que produzcan/consuman la estructura
real de una carpeta Obsidian.

**Diseño**

- **Export** (ya hay base: `src/lib/export.ts` escribe ZIP *store* sin dependencias):
  - mismo ZIP, pero con nombres y contenidos compatibles: notas en `.md` respetando carpetas,
    frontmatter intacto, `[[wikilinks]]` sin tocar, y un `.obsidian/` mínimo **opcional**
    (solo `app.json` vacío) para que Obsidian abra la carpeta sin quejarse.
  - nombre sugerido `mdfire-vault-YYYY-MM-DD.zip`.
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

---

## 3. Archivos locales: CLI o mini app de sync (Windows/Mac)

**Qué**: mantener una carpeta local (el vault) espejada con la nube, para editar con cualquier
editor y con Obsidian.

**Diseño**

- **CLI primero** (reusa `agent/core.mjs`, que ya habla Firestore REST con la identidad del
  agente y respeta reglas):
  - `mdfire vault pull [--dir ~/Vault]` → escribe `carpeta/nota.md` desde la nube.
  - `mdfire vault push` → sube cambios locales por nota, comparando **etag** (el hash de
    contenido que ya existe) para no pisar ediciones remotas.
  - `mdfire vault watch` → `fs.watch` + debounce 500 ms; cada archivo modificado se aplica con
    `patch` sobre el documento (no reescritura completa) para no romper el CRDT del editor.
  - Manifiesto local `.mdfire/sync.json` con `{ ruta: { id, etag, updatedAt } }`.
- **Mini app** (después): envoltorio de escritorio (Tauri, ~5 MB) con bandeja del sistema,
  login del agente, start/stop, log y conflictos. Windows: instalador MSI; Mac: DMG firmado
  (requiere cuenta Apple Developer, $99/año — costo a presupuestar).
- **Conflictos**: gana el último etag; si los dos lados cambiaron, se guarda
  `nota.conflicto-YYYYMMDD.md` con la versión local en vez de perderla.
- **Convivencia con el editor**: escribir desde disco es una edición externa; el editor ya
  reconcilia cambios externos al documento Yjs (`CollaborativeEditor`), así que la ventana de
  carrera es la misma que con un agente.

**Riesgos**: permisos (el agente es miembro con rol Lectura/Escritura: sirve), adjuntos
(mismo bloqueante que el punto 2), watch en Windows con rename/atomic saves de Obsidian.

**Tamaño**: M (CLI) + M (app de escritorio) · **Depende de**: nada para CLI; app depende de
certificados y de decidir adjuntos.

---

## 4. Página de uso (transferencia / datos / almacenamiento)

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

---

## 5. Auto top-up de créditos (mínimo $2)

**Qué**: recarga automática cuando el saldo baja de un umbral, con un mínimo de $2.

**Diseño**

- Modelo: `credits/{uid}` con `{ balanceUsd, thresholdUsd, topUpUsd, paymentMethodRef, enabled }`
  y un libro mayor `credits/{uid}/ledger/{id}` (cargo/recarga, motivo, timestamp) para que el
  usuario pueda auditar.
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

**Tamaño**: L · **Depende de**: Blaze + Cloud Functions, proveedor de pagos elegido,
punto 4 (medición real) y planes (ya hay `entitlements`).

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
