# Primer contacto: onboarding y revelación de producto

**Estado**: propuesta con implementación inicial. **Fecha**: 22-nov-2026. **Alcance**: qué ve alguien que abre
`firemd.app` por primera vez, qué falta hoy y en qué orden construirlo.

Este documento responde al brief de "Editor Vivo + Capa de Descubrimiento No Invasiva".
Documenta el estado real con evidencia (`archivo:línea`), enumera los gaps y arma el plan.
La sección 5b registra lo ya implementado; el resto sigue siendo plan. El veredicto de abajo
describe el punto de partida (el muro de login) y se conserva como registro: el modo visitante
ya existe y la sección 5b dice qué cambió.

---

## 0. Veredicto

Tres cosas del brief no se sostienen contra el código actual:

1. **"Abrir `firemd.app` directamente en el lienzo editable" no es lo que pasa hoy.** Hoy
   hay un **muro de login**: sin sesión no se renderiza editor, ni nota, ni nada. La premisa
   del brief es aspiracional; lo que hay que construir es el modo visitante, y recién después
   la capa de descubrimiento.
2. **El modelo comercial del brief contradice el modelo implementado.** El brief pide
   *pay-per-use con cuota gratuita + auto top-up*. El código tiene **planes flat** (`free` /
   `paid`, `$4/mes` y `$12/mes`), y `docs/pricing.md` declara el pay-per-use como **propuesta
   sin medición server-side**. No se puede escribir la landing de precios antes de decidir
   cuál de los dos se vende.
3. **"Funciona sin conexión"** es parcial: hay PWA instalable y caché persistente de
   Firestore, pero no hay edición offline de un visitante sin sesión (no hay dónde guardar).

Orden correcto: **(1)** decisión de modelo comercial → **(2)** modo visitante con borrador
local → **(3)** capa de descubrimiento → **(4)** `/planes` + SEO.

---

## 1. Estado actual verificado

| # | Hecho | Evidencia |
|---|---|---|
| 1 | Sin sesión no hay editor: se renderiza una pantalla de login con "Entrar con Google" | `src/AppTree.tsx:1462-1497` (`if (!user) return <div className="auth">`) |
| 2 | Todo el árbol de datos pasa por Firestore: notas, cuerpos, CRDT, presencia | `src/lib/notes.ts:153-233`, `src/lib/collab/noteSession.ts:50-60`, `src/lib/collab/provider.ts:1-40` |
| 2b | No hay store local de cuerpos: el único `localStorage` de contenido es la migración de esquema v1→v2 (Firestore→Firestore) | `src/lib/notes.ts:906-950`, `src/hooks/useFirebase.ts:165-171` |
| 3 | `localStorage` guarda **solo preferencias**: nota activa, sidebar, paneles, tema, ancho, snap de canvas | `src/AppTree.tsx:185,193,201,211,609-620`, `src/components/Sidebar.tsx:74-164`, `src/components/CanvasSurface.tsx:120,227` |
| 4 | No hay router: cero `history.pushState` / `location.pathname`; los links compartidos son `/?note=<id>` | `src/components/ShareDialog.tsx:53`; grep sin resultados en `src/` (solo `legacyHost.ts:27` lee `pathname` para el redirect de origen) |
| 5 | `firebase.json` **no tiene `rewrites`** → una ruta `/planes` daría 404 | `firebase.json` (clave `hosting`, sin `rewrites`) |
| 6 | SEO: `index.html` con meta genérica; **no hay `robots.txt` ni `sitemap.xml`** en `public/` | `index.html:13-40`, `ls public/` |
| 7 | `public/llms.txt` existe y describe CLI/MCP, pero **no menciona planes, precios ni cuota** | `public/llms.txt` |
| 8 | Planes: `entitlements/{uid}` con `plan: 'free' \| 'paid'`; compartir y agentes se cortan por regla | `src/lib/entitlements.ts:1-40`, `firestore.rules:90,99` |
| 9 | Copy de plan en la app: "**$4/mes solo · $12/mes hasta 5 personas**" | `src/components/UpgradeDialog.tsx:33` |
| 10 | `docs/pricing.md` propone **pay-per-use con créditos prepagos y auto top-up**; `MIN_TOP_UP_USD = 2` | `docs/pricing.md` §1, `src/lib/usage.ts:50` |
| 11 | Se **mide** consumo por usuario pero **no hay tope ni enforcement** en reglas | `src/lib/usage.ts:131` (`subscribeUsage`), `firestore.rules` |
| 12 | El free tier sin medidor es la principal exposición de costo | `docs/comercial-review.md` §2 |
| 13 | Primer login cae en workspace vacío: no hay nota de bienvenida ni seed | `src/AppTree.tsx:1634` (`emptyWorkspace={notes.length === 0}`) |
| 14 | No existe modo enfoque / escritura limpia (solo sidebar colapsable) | grep `focus.?mode|zen` sin resultados |
| 15 | Analítica: 7 eventos fijos; ninguno del embudo visitante → cuenta | `src/lib/analytics.ts:16-24` |
| 16 | PWA instalable con headers de manifest y SW | `firebase.json` (headers `manifest.webmanifest`, `sw.js`), `vite-plugin-pwa` en `package.json` |

**Conclusión del estado**: el producto no tiene primer contacto. Tiene un portón. El brief
describe el destino, no el punto de partida.

---

## 2. Gaps priorizados

### P0 — bloquean el brief entero

**G1. Modo visitante inexistente.** No hay camino de código que renderice el editor sin
`user`. Sin esto no hay "editor-ancla", ni nota de bienvenida, ni CTA progresivo.

**G2. Borrador local inexistente.** No hay persistencia de cuerpo de nota fuera de Firestore.
Un visitante no puede escribir y recargar sin perder todo. `localStorage` solo tiene
preferencias; el cuerpo vive en `notes/{id}/body/main` y en el CRDT.

**G3. Modelo comercial contradictorio.** Flat (`$4/$12`) vs pay-per-use con créditos. El
brief, `UpgradeDialog`, `pricing.md` y `comercial-review.md` dicen cosas distintas. Cualquier
copy de landing va a prometer algo que el producto no hace.

**G4. `/planes` daría 404.** No hay router y `firebase.json` no reescribe. La ruta del brief
no existe como superficie.

### P1 — la capa de descubrimiento en sí

**G5. No hay landing / sección de beneficios.** Ni debajo del editor, ni en ruta aparte.

**G6. No hay nota de bienvenida.** El primer login es un workspace vacío: el peor primer
contacto posible para una herramienta de escritura.

**G7. No hay CTA progresivo de guardar.** No existe el estado "escribiste algo → invitación
sutil a crear cuenta". No aplica hoy porque no hay visitante; se construye con G1/G2.

**G8. SEO no indexable.** Sin `robots.txt`, sin `sitemap.xml`, y el contenido informativo
viviría detrás de un `lazy()` de React: un crawler sin JS no ve nada. `llms.txt` no habla de
planes.

**G9. Cuota gratuita sin tope.** Se mide el consumo, no se limita. Si la landing promete
"cuota gratuita generosa", el costo sin techo sigue siendo el riesgo #1 de
`comercial-review.md`.

### P2 — después

**G10. Modo enfoque inexistente.** El brief pide ocultar los enlaces informativos en modo
enfoque; el modo no existe. El sidebar colapsable es lo más cercano.

**G11. Sin embudo medido.** Faltan eventos tipo `guest_draft_started`, `guest_signin_clicked`,
`landing_viewed`, `pricing_viewed`. `analytics.ts` exige uid, así que el visitante no se
puede medir con el sistema actual (requiere `track` sin uid o contador local).

**G12. Diferenciación de entrada.** El brief §3.3 pide no mostrar la landing en notas
compartidas ni en sesión logueada. Hoy no aplica; al construir G1 hay que dejarlo explícito
desde el principio para no tener que corregirlo después.

---

## 3. Decisiones que hay que tomar (bloqueantes)

> **Cerradas el 22-nov-2026.** El modelo comercial quedó definido por el usuario:
> **cuota gratuita permanente + saldo prepago con top-up**. Eso resuelve D1 y
> convierte el "flat ahora" de la recomendación original en una alternativa
> descartada. Las cuatro decisiones se registran acá para que el código y el copy
> no vuelvan a contradecirse.
>
> | # | Decisión | Implementación |
> |---|---|---|
> | D1 | **Cuota gratuita permanente + créditos prepagos** (no flat, no pay-per-use puro). | `src/lib/quota.ts`, `src/lib/credits.ts`, `docs/pricing.md` |
> | D2 | **Borrador local-first** en `localStorage` (`firemd-guest-draft`), migrado al entrar. | `src/lib/guestDraft.ts`, `src/lib/guestMigration.ts` |
> | D3 | **Página estática** `public/planes/index.html` con HTML prerenderizado y rewrite en `firebase.json`. | `public/planes/index.html`, `firebase.json` |
> | D4 | **La franja y la landing solo en visitante sin sesión y sin nota compartida.** | `src/lib/guestMode.ts`, `src/AppTree.tsx` |

**D1 — Modelo comercial: flat o pay-per-use.**
Recomendación: **flat ahora, pay-per-use cuando el medidor sea confiable**. Razones:
`docs/pricing.md` §6 dice que el cobro por uso requiere medición server-side (Blaze +
Functions) que no existe; `comercial-review.md` ya marcó que $0.05–0.10 por sesión es
imposible con tarjeta (fee mínimo $0.30) y que Stripe no opera desde Uruguay. Vender
pay-per-use antes de tener medidor confiable es vender algo que no se puede facturar.
*Si se elige flat*: la landing habla de plan gratuito + $4/$12. *Si se elige pay-per-use*:
primero hay que construir el medidor y el checkout; la landing espera.

**D2 — ¿Cómo se guarda el borrador del visitante?**
(a) **100% local** (`localStorage` + migración al login) o (b) **auth anónima de Firebase**
(`signInAnonymously`, cuenta real que después se enlaza).
Recomendación: **(a) local-first**. El anónimo agrega una cuenta que hay que enlazar, mete
`memberIds` en las reglas y complica la revocación; el borrador local no toca Firestore hasta
que el usuario decide guardar. Costo: hay que escribir el adapter local (G2) y la migración.

**D3 — ¿Cómo existe `/planes`?**
(a) rewrite a `index.html` + chequeo de `pathname` en `main.tsx` (barato, malo para SEO);
(b) **página estática propia** generada en build (Vite multi-page o `public/planes/index.html`)
con su meta y su HTML prerenderizado (bueno para SEO, un poco más de trabajo).
Recomendación: **(b)**. El objetivo del brief incluye tráfico de búsqueda; una landing que
solo existe después de ejecutar React no captura nada.

**D4 — ¿Dónde se muestra la landing?**
Solo en vista de visitante sin sesión y en `/planes` (brief §3.3). Nunca en nota compartida ni
en sesión logueada. Se deja escrito en el código como una condición única, no repartida.

---

## 4. Plan por fases

### Fase 0 — Decisiones y copy (½ día)

- [x] Cerrar D1, D2, D3, D4 y anotarlas acá (decision log numerado).
- [x] Escribir el copy final de la nota de bienvenida y de la sección de beneficios, con la
      lista de claims **verificados** (ver §5). Cada claim con su evidencia o se borra.
- [x] Aceptación: documento con las 4 decisiones cerradas y el copy aprobado. Nada de código.

### Fase 1 — Modo visitante + borrador local (2–3 días)

- [x] Interfaz mínima: `guestDraft.ts` (persistencia local) y `guestMigration.ts` (crear la
      nota real con `createNote` + `saveNoteContent`). No se reescribió `notes.ts`.
- [x] `AppTree`: si no hay `user` y no hay nota compartida, monta `GuestWorkspace` con el
      editor local. Sin modal, sin muro. El cursor queda listo.
- [x] Persistencia: guardado con debounce + flush en `beforeunload`/desmontaje. Clave
      `firemd-guest-draft`.
- [x] Migración al login: `GuestDraftDialog` ofrece guardar; el borrador se borra solo
      después de que la escritura confirma.
- [x] Tests: `tests/guest-draft.test.ts`, `tests/guest-mode.test.tsx`.
- [ ] Aceptación end-to-end en incógnito contra producción (requiere deploy).

### Fase 2 — Capa de descubrimiento no invasiva (1–2 días)

- [x] Franja mínima (~36 px) en la vista de visitante: `¿Qué es FireMD?` + `Planes y uso` +
      `Guardar / Entrar con Google`. Sin hero encima del editor.
- [x] CTA progresivo: aparece al primer cambio real del borrador, nunca como popup. Botón en
      la franja, no modal.
- [x] Nota de bienvenida: placeholder editable con los 4 pilares y espacio para probar.
- [x] Regla D4 explícita en `shouldShowGuestView()`: solo `!user && !sharedNote`.
- [x] Tests: `tests/guest-mode.test.tsx` (render sin sesión, franja, CTA, restauración).
- [ ] Aceptación en navegador real (requiere deploy).

### Fase 3 — `/planes` + landing informativa (1–2 días)

- [x] Según D3: `public/planes/index.html` con `<title>`, meta, canonical y HTML prerenderizado.
- [x] Contenido: propuesta de valor, 4 pilares, modelo de cuota + créditos, FAQ corta.
- [x] Enlazada desde la franja y desde el pie de la vista de visitante. Nunca desde el editor
      en sesión.
- [ ] Aceptación contra producción: `curl -s https://firemd.app/planes | grep -F "..."` y
      `scripts/check-site.mjs` con el host agregado.

### Fase 4 — SEO y medición (½–1 día)

- [x] `public/robots.txt` + `public/sitemap.xml` (con `/` y `/planes`).
- [x] `public/llms.txt` actualizado con planes, cuota y ruta `/planes`.
- [x] Eventos del embudo: `landing_viewed`, `pricing_viewed`, `guest_draft_started`,
      `guest_signin_clicked`, `guest_draft_saved`. Contador local
      (`firemd-guest-events`) y volcado a `analytics` al entrar; reglas actualizadas.
- [ ] Aceptación contra producción: `curl -s https://firemd.app/robots.txt` y
      `/sitemap.xml` responden 200 con contenido.

---

## 5. Copy propuesto (borrador; cada claim verificado)

**Propuesta de valor en una línea**
> Editor Markdown colaborativo en tiempo real con carpetas, permisos por carpeta y acceso
> directo para agentes de IA vía CLI/MCP. Sin suscripción obligatoria.

**Los 4 pilares (con evidencia; si un claim no tiene evidencia, se borra)**

| Pilar | Claim | Evidencia |
|---|---|---|
| Edición simultánea | CRDT (Yjs) sobre Firestore con compactación y cursores remotos; dos personas en el mismo párrafo no se pisan | `src/lib/collab/provider.ts`, `awareness.ts`, `docs/sync-algorithms.md` |
| Permisos reales | `Dueño` / `Escritura` / `Lectura` por nota y por carpeta; revocación con corte inmediato | `src/lib/acl.ts`, `firestore.rules:105-140` |
| Hecho para agentes | Salida en texto plano, edición atómica con `etag` y preconditions; identidad propia con permisos mínimos | `public/agent.md`, `agent/cli.mjs`, `agent/mcp.mjs` |
| Offline / PWA | Instalable como app; el caché persistente de Firestore mantiene lo leído y encola escrituras | `firebase.json` (headers), `src/firebase.ts:46`, `vite-plugin-pwa` |

**Claims que NO se pueden usar** (los marca `docs/comercial-review.md` §1):
- "archivos `.md` en disco" / "abrir la misma carpeta" → no existe acceso a filesystem.
- "cifrado E2E" → no existe y es incompatible con búsqueda server-side y agentes.
- "pay-per-use con auto top-up" → no hay checkout ni medidor server-side (hasta cerrar D1).
- "cuota gratuita generosa" con cifra → no hay tope definido (G9).

**Nota de bienvenida (10 líneas, borrador)**
> Esto es FireMD. Escribí acá ahora: no hace falta cuenta.
> Lo que escribas queda en este navegador hasta que decidas guardarlo.
> **Colaboración:** dos personas en el mismo párrafo sin pisarse (CRDT).
> **Carpetas y permisos:** Dueño, Escritura, Lectura, por carpeta y por nota.
> **Agentes:** `firemd ls`, `firemd cat`, `firemd patch --etag …` y un servidor MCP.
> **Tu Markdown sigue siendo Markdown:** exportá el vault cuando quieras.
> Guardá esta nota en tu cuenta cuando quieras compartirla.

**FAQ corta**
- ¿Qué pasa con lo que escribo antes de entrar? Queda en tu navegador; al entrar te ofrecemos
  guardarlo en tu cuenta.
- ¿Cómo revoco un acceso? Desde el panel de compartir de la nota o de la carpeta; el corte es
  inmediato.
- ¿Cómo funciona el CLI/MCP? Ver `agent.md`; la CLI devuelve texto plano y usa `etag`.
- ¿Cómo controlo mi gasto? Ver página de uso; *(completar según D1)*.

---

## 5b. Implementación (22-nov-2026)

Archivos nuevos:

| Archivo | Qué hace |
|---|---|
| `src/lib/guestDraft.ts` | Persistencia local del borrador, validación y título derivado. |
| `src/lib/guestMigration.ts` | Crea la nota real con `createNote` + `saveNoteContent`. |
| `src/lib/guestMode.ts` | Condición única D4: `!user && !sharedNote`. |
| `src/lib/guestAnalytics.ts` | Contador local del embudo y volcado a `analytics` al entrar. |
| `src/components/GuestWorkspace.tsx` | Editor local + franja + CTA progresivo. |
| `src/components/GuestDraftDialog.tsx` | Oferta de guardar el borrador al entrar. |
| `public/planes/index.html` | Landing estática con SEO propio. |
| `public/robots.txt`, `public/sitemap.xml` | Indexación. |

Cambios:

- `src/AppTree.tsx`: sin sesión y sin `?note=` monta `GuestWorkspace`; con sesión ofrece
  migrar el borrador. Se retiró el gating flat (`UpgradeDialog`, `entitlements`) porque el
  modelo decidido es cuota + créditos.
- `firestore.rules`: compartir dejó de exigir plan pago; eventos de embudo agregados a la
  lista validada.
- `firebase.json`: rewrite `/planes` → `public/planes/index.html`.
- `public/llms.txt`: planes, cuota y `/planes`.

Pendiente y por qué:

1. **Aceptación en navegador/incógnito y contra producción**: requiere deploy.
2. **Tope duro de la cuota gratuita**: se muestra y se avisa, pero bloquear escrituras
   necesita medición server-side (Cloud Functions), que no existe.
3. **Cobro real y débito de créditos**: requiere checkout y backend.
4. **Eventos del visitante en servidor**: hoy son locales y se vuelcan al entrar; una
   colección anónima con reglas propias es la alternativa si se quiere medir sin login.

---

## 6. Riesgos

1. **Prometer pay-per-use sin medidor** → disputas de facturación y costo sin techo. Mitigación:
   D1 antes de escribir la landing.
2. **Duplicar el árbol de datos con el store local** → dos caminos que se desincronizan.
   Mitigación: interfaz mínima (crear/leer/escribir cuerpo/título), no un segundo `notes.ts`.
3. **Service worker sirviendo el shell cacheado para `/planes`** → la landing estática no se
   actualiza. Mitigación: excluir `/planes` del precache o versionar el SW.
4. **CSP**: `img-src 'self' data: blob: https:` permite imágenes externas; si la landing usa
   fuentes o scripts externos, hay que ajustar `script-src`/`font-src` en `firebase.json`.
5. **Analítica del visitante**: `track` exige uid y las reglas validan nombres. Agregar eventos
   sin uid requiere cambiar reglas y el contrato de `analytics.ts`.

---

## 7. Qué NO hacer

- No poner un hero comercial encima del editor.
- No disparar popup de login al teclear.
- No mostrar la landing en notas compartidas ni en sesión logueada.
- No prometer E2EE, archivos en disco ni "exportable siempre" sin export.
- No publicar cifras de cuota antes de definir el tope (G9).

---

## 8. Cómo verificar el estado documentado

```bash
# el muro de login
grep -n "if (!user)" src/AppTree.tsx

# sin router y sin rewrites
grep -rn "pushState\|location.pathname" src/ ; grep -c rewrites firebase.json

# sin robots/sitemap
ls public | grep -iE 'robots|sitemap'

# planes flat vs pay-per-use
grep -n "Plan(es)? previstos" src/components/UpgradeDialog.tsx
grep -n "MIN_TOP_UP_USD" src/lib/usage.ts
```
