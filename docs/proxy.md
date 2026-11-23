# Proxy prepago (Cloud Run) — E1, E2, E3, E6

El proxy es el **punto único de control** de [`prepaid-usage-model.md`](prepaid-usage-model.md):
recibe las escrituras del canal caliente, resuelve el ACL, cuenta la operación,
cobra contra la cuota diaria o el saldo, y escribe datos de usuario con el Admin
SDK (que no pasa por `firestore.rules`). El cliente no puede mentir porque no
tiene otro camino.

Código: `server/` (JS ESM, sin framework). Tests: `tests/proxy-core.test.ts`,
`tests/proxy-http.test.ts`, `tests/checkout.test.ts` (`npm run test:proxy`).

---

## 1. Qué está implementado

| Etapa | Estado | Nota |
|---|---|---|
| **E1** proxy del canal caliente | **parcial** | `block` (1 escritura), `body` (3) y `compact` (1 + N borrados) por HTTP. Presencia sigue del cliente: cobrarla antes de separar modo liviano rompería la cuota gratuita (§7). |
| **E2** cerrar escrituras directas | **hecho, apagado** | Interruptor `config/proxy.enforced` en las rules: bloques y `body` update. Se prende después del despliegue. |
| **E3** cuota + débito + libro | **hecho** | `allowance/{uid}/days/{d}`, débito del saldo, libro inmutable, idempotencia por `opId`, reserva por operación (nunca negativo), auto top-up. |
| **E6** checkout MoR | **hecho (Polar)** | Checkout con precio ad-hoc por pack, webhook `order.paid` con Standard Webhooks, packs $1/$5/$20 (recarga automática desde $5) y vencimiento a 24 meses. |
| E4 agents/MCP por el proxy | pendiente | Hoy los agentes escriben por REST con su propio token. |
| **E5** storage exacto + compactación server-side | **parcial** | El stock se mueve en cada `body` y la compactación (manifest + borrados) ya la escribe el proxy, cobrando los borrados. Falta el cargo mensual por MB extra. |
| E7 retirar `usage`/copy | pendiente | `usage` sigue siendo el contador de transparencia del cliente. |

## 2. API

Todas las rutas salvo el health check y el webhook piden
`Authorization: Bearer <Firebase ID token>`.

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| `GET` | `/health` | — | `{ ok: true }` (`/healthz` lo intercepta el frontend de Cloud Run) |
| `GET` | `/v1/account` | — | cuota del día, storage, saldo, estado |
| `POST` | `/v1/notes/{noteId}/blocks` | `{ opId, block }` | recibo de la operación |
| `POST` | `/v1/notes/{noteId}/body` | `{ opId, body }` | recibo de la operación |
| `POST` | `/v1/notes/{noteId}/compact` | `{ opId, compact: { blockIds, manifest } }` | recibo (hasta 400 borrados por mensaje) |
| `POST` | `/v1/billing/checkout` | `{ packUsd, successUrl? }` | `{ url, id, packUsd }` |
| `POST` | `/v1/billing/portal` | `{ returnUrl? }` | `{ url, id }` (portal de Polar para guardar la tarjeta) |
| `POST` | `/v1/billing/webhook` | evento del MoR (crudo) | `{ ok, idempotent }` |

Recibo:

```json
{
  "ok": true,
  "id": "opId",
  "kind": "block",
  "idempotent": false,
  "chargeUsd": 0,
  "balanceUsd": 5,
  "state": "free",
  "allowance": { "day": "2026-11-23", "opsUsed": 1, "writes": 1, "deletes": 0,
                 "quota": 700, "remaining": 699, "renewsAt": "2026-11-24T00:00:00.000Z" }
}
```

Rechazos (no escriben nada, `402`):

| `error` | `state` | Significado |
|---|---|---|
| `no-funds` | `free-exhausted` | tope diario y nunca hubo saldo |
| `no-funds` | `pay-exhausted` | tope diario y el saldo se terminó |
| `storage-over` | `storage-over` | la escritura cruza los 100 MB |

`403 forbidden` = el ACL de la nota (o de su carpeta) no le da escritura al
remitente; `404 note-not-found`; `400` = payload inválido (no se cobra).

## 3. Orden de decisión (implementado en `server/src/core.mjs`)

1. ACL efectiva de la nota (la carpeta manda si `aclSource == 'folder'`).
2. **Pagador = `note.ownerId`**, no el remitente (D7: el invitado gasta la cuota
   y el saldo del dueño).
3. Idempotencia: el `opId` es el id del bloque; un reenvío no vuelve a cobrar.
4. Cuota: 700 operaciones/día UTC. Un op que cruza el tope se cobra solo por la
   parte que cruza.
5. Saldo: se debita en la **misma transacción** que aplica la escritura
   (no hay camino donde se cobre sin escribir ni se escriba sin cobrar).
6. Sin cuota ni saldo: rechazo con estado explícito; nunca saldo negativo.
7. Auto top-up: si `credits.autoTopUp` y el saldo quedó bajo el umbral, se deja
   una orden `credits/{uid}/topups/{id}` pendiente para el MoR.

Escrituras por operación (`OP_WRITES`): `block` = 1, `body` = 3 (body + nota +
recibo de idempotencia), `compact` = 1 (manifest) + 1 por bloque podado. El cargo
se calcula con el precio publicado (`$0,50/100k` escrituras, `$0,10/100k`
borrados) sobre lo que cruza la cuota.

### 3.1 Recarga automática (cobro off-session)

Cuando un débito deja `balanceUsd` bajo `thresholdUsd` y `autoTopUp` está prendido,
el recibo de la operación trae `autoTopUp` y el proxy intenta el cobro **después**
de la transacción (un fallo de cobro no rompe la operación ya cobrada):

```text
POST /v1/orders/   { customer_id, product_id, amount: centavos, currency: usd, metadata: { uid } }
POST /v1/orders/{id}/finalize   → 200 paid | 402 tarjeta/3DS | 403 flag apagado
```

El webhook `order.paid` acredita el saldo con el mismo `creditTopUp` idempotente
por `order.id`, así que no hay camino donde se cobre dos veces. El `customer_id`
de Polar se guarda en `credits/{uid}.polarCustomerId` la primera vez que el
usuario paga.

Estados que devuelve el recibo en `autoTopUp.charge.status`:

| `status` | Qué pasó | Qué hace la app |
|---|---|---|
| `paid` | cobró; el saldo se acredita por webhook | nada |
| `needs-card` | no hay cliente/tarjeta en Polar todavía | ofrece "Guardar tarjeta" (`/v1/billing/portal`) |
| `unavailable` | falta el flag `off_session_charges_enabled` en la organización | deja el pedido `pending` |
| `failed` | rechazo de la tarjeta o 3DS que no se puede completar | deja el pedido `pending` |
| `order-4xx` | Polar rechazó la creación de la orden | deja el pedido `pending` |

**Requisitos** para que cobre solo: el OAT necesita `orders:write` (además de
`checkouts:write`) y Polar tiene que habilitar el flag en la organización. Sin
el flag, todo lo demás sigue funcionando: la recarga manual y el recordatorio.

## 4. Datos que escribe

| Documento | Contenido |
|---|---|
| `notes/{id}`, `notes/{id}/body/main` | contenido, en la misma transacción del cobro |
| `notes/{id}/updates/{opId}` | bloque del log Yjs (el `opId` es el id) |
| `allowance/{uid}` | `storageBytes` (stock, se mueve con cada `body`) |
| `allowance/{uid}/days/{YYYY-MM-DD}` | `opsUsed`, `writes`, `deletes`, `quota`, `renewsAt` |
| `credits/{uid}` | `balanceUsd`, `totalToppedUpUsd`, `expiresAt` (24 meses), `polarCustomerId` |
| `credits/{uid}/ledger/{id}` | asiento inmutable: `usage` (−) o `topup` (+) |
| `proxyOps/{uid}_{opId}` | recibo de idempotencia de `body` |
| `payments/{provider}_{eventId}` | idempotencia del webhook |

Desvío documentado respecto de §3.5: el stock de storage vive en
`allowance/{uid}`, no repetido por día — un stock por día no significa nada y se
desincroniza. La cuota sí es por día.

## 5. Despliegue

```bash
# 1. Servicio (Cloud Run, escala a 0)
cd server
gcloud run deploy firemd-proxy \
  --source . \
  --region southamerica-east1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=md-sync-app,ALLOWED_ORIGINS=https://md-sync-app.web.app
```

Variables:

| Variable | Uso |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | proyecto de Firestore (o el default de Cloud Run) |
| `ALLOWED_ORIGINS` | lista separada por comas para CORS (`https://md-sync-app.web.app`) |
| `POLAR_ACCESS_TOKEN` | OAT de Polar (`polar_oat_…`), scope `checkouts:write` (E6) |
| `POLAR_PRODUCT_1` / `_5` / `_20` | un producto por pack en Polar (`Firemd Credits — $1`, `— $5`, `— $20`) |
| `POLAR_PRODUCT_ID` | opcional: un solo producto + precio ad-hoc por checkout (fallback) |
| `POLAR_WEBHOOK_SECRET` | secreto del endpoint (`whsec_…`), firma Standard Webhooks |
| `POLAR_SERVER` | `production` (default) o `sandbox` |

La service account necesita `roles/datastore.user` y `roles/firebaseauth.viewer`.

### 5.1 Provisionar el MoR (Polar)

Lemon Squeezy ya no acepta altas nuevas y cierra el 31-mar-2027; el adaptador es
`server/src/providers/polar.mjs` (Polar es MoR y acepta comercios en Uruguay).

```bash
polar auth login --production
# Un producto por pack: así los tres se ven y se editan en el dashboard
for pack in 1 5 20; do
  polar products create --name "Firemd Credits — \$$pack" --visibility private \
    --prices "[{\"amount_type\":\"fixed\",\"price_amount\":$((pack*100))}]" --json
done
# Webhook: solo order.paid, formato raw, a la ruta del proxy
polar webhooks create_webhook_endpoint \
  --url https://firemd-proxy-XXX.southamerica-east1.run.app/v1/billing/webhook \
  --name "FireMD proxy" --format raw --events order.paid --json   # imprime el whsec_
# Token de la organización para el proxy (orders:write = recarga automática)
polar auth token --scope checkouts:write --scope orders:write
```

Los dos secretos van a Secret Manager, no a variables de entorno:

```bash
printf %s "$OAT"    | gcloud secrets create polar-access-token --data-file=-
printf %s "$WHSEC"  | gcloud secrets create polar-webhook-secret --data-file=-
gcloud run services update firemd-proxy --region southamerica-east1 \
  --set-secrets POLAR_ACCESS_TOKEN=polar-access-token:latest,POLAR_WEBHOOK_SECRET=polar-webhook-secret:latest \
  --update-env-vars POLAR_PRODUCT_1=<id_$1>,POLAR_PRODUCT_5=<id_$5>,POLAR_PRODUCT_20=<id_$20>,POLAR_SERVER=production
```

Cada pack es un producto del catálogo (precio fijo), así que cambiar un precio es
editar el producto en el dashboard, sin tocar código ni redeployar. Si en cambio
se configura un único `POLAR_PRODUCT_ID`, el monto viaja como precio ad-hoc en
cada checkout.

El saldo se acredita con el **neto** de la orden (`net_amount`), sin impuestos ni
descuentos, para que el saldo sea exactamente el valor del pack. `allow_discount_codes`
va en `false` para que el monto no se pueda manipular desde el checkout.

```bash
# 2. Cliente: el proxy pasa a ser el escritor
#    `.env.production` (versionado) ya fija `VITE_PROXY_URL=/api`, así que
#    cualquier `npm run build` de producción escribe por el proxy. Sin esa
#    variable, Vite pliega `proxyEnabled = false` y el minificador borra el
#    cliente del proxy del bundle: la app vuelve a escribir directo.
npm run build && firebase deploy --only hosting
```

**Mismo origen (recomendado)**: `firebase.json` ya tiene la rewrite
`{"source": "/api/**", "run": {"serviceId": "firemd-proxy", "region": "southamerica-east1"}}`,
así que el build del cliente va con `VITE_PROXY_URL=/api`. Ventajas: sin CORS y sin tocar la
CSP (`connect-src` no necesita el origen de `run.app`). El router descarta el prefijo
`/api` para que las rutas sigan siendo `/v1/...`.

Si el proxy queda en otro origen, la CSP de `firebase.json` tiene que incluir esa URL en
`connect-src` (hoy solo permite Google/Firebase), o el navegador bloquea el `fetch`.

```bash
# 3. E2: cortar la escritura directa del cliente (reversible)
#    Solo después de verificar que el cliente nuevo escribe por el proxy.
#    En la consola de Firestore: config/proxy { enforced: true }
```

Con `config/proxy.enforced == true`, `notes/{id}/updates` (create/delete) y
`notes/{id}/body` (update) dejan de aceptar escrituras de cliente. Las lecturas
no se tocan nunca (D9). Volver a `false` o borrar el documento restaura la
escritura directa sin deploy.

## 6. Verificación end-to-end (§8 del diseño)

| # | Escenario | Cómo se comprueba |
|---|---|---|
| 1 | 30 mensajes nuevos | `allowance/{uid}/days/{hoy}.opsUsed` sube; `credits.balanceUsd` no cambia |
| 2 | Tope a mitad de tipeo | el proxy responde `402 free-exhausted`; el texto queda en la cola local y la UI dice que se renovará a las 00:00 UTC |
| 3 | Cambia el día | `opsUsed` arranca en 0; el reintento del bloque usa un `opId` nuevo |
| 4 | Carga $5 | `credits.balanceUsd = 5`, asiento `topup` en el libro, `expiresAt` a 24 meses |
| 5 | Segundo usuario escribe | se debita el `uid` del **dueño** (`payerOf`), no el del invitado |
| 6 | Cliente directo | con `config/proxy.enforced` falla con `permission-denied` |

**Corrida real contra producción (24-nov-2026)**: 19/19. ID token de un usuario
sintético → `https://md-sync-app.web.app/api` → Cloud Run → `verifyIdToken` →
transacción: bloque contado, reenvío idempotente, débito `0,001 → 0,000995` con
asiento `−0,000005` en el libro, body con `storageBytes = 13`, compactación de 2
bloques (manifest + borrados, `opsUsed = 707`), bloque posterior intacto y `402
free-exhausted` que no escribe. El usuario y los documentos de prueba se
borraron al final.

Para repetirla hace falta un usuario real: `accounts:signUp?key=<apiKey>` desde
un contexto con `Referer: https://md-sync-app.web.app/` (la API key está
restringida por referrer) y un `config/proxy.enforced` apagado, o un custom
token firmado con IAM `signBlob` (el camino que se usó acá).

Tests automáticos que cubren 1-5 sin emulador: `tests/proxy-core.test.ts`
(24 casos) y `tests/proxy-http.test.ts` (13 casos). El 6 lo cubre
`tests/firestore.rules.test.ts` ("allowance y corte del proxy").

El adaptador real (`server/src/firestore.mjs`: transacción, `DELETE_FIELD`,
`Timestamp`) tiene su propio test contra el emulador, que necesita
`npm --prefix server install`:

```bash
npm run test:proxy:store
```

## 7. Por qué el corte (E2) sigue apagado

`config/proxy.enforced` ya no rompería la compactación ni el body del cliente
web, pero **rompería a los agentes CLI/MCP**: `agent/core.mjs:writeNoteBody`
escribe `notes/{id}/body/main` con un patch directo (y el `vault push`). El
corte se prende después de E4. Mientras tanto el medidor cobra igual: el
cliente web escribe por el proxy, y la escritura directa que quede (agentes,
escritorio) es la que E2/E4 van a cerrar.

## 8. Lo que falta para cerrar E1/E5

- **Presencia**: se escribe directo (`presence/{uid}`) y no se cobra. Cobrarla
  hoy agotaría la cuota gratuita en minutos (una escritura cada pocos segundos),
  así que primero hay que separar modo liviano (sin presencia) de modo live (D1).
- **Agentes CLI/MCP**: escriben por REST con el token del agente; siguen fuera
  del medidor hasta E4.
- **Escritorio**: sigue con pull/push cada 15 s contra Firestore (D4).
- **Storage**: el cargo mensual por MB extra no se debita todavía (E5).

**Verificado**: el adaptador de Firestore corre contra el emulador en
`tests/proxy-store.integration.test.ts` (5 casos: transacción, idempotencia, débito, libro,
`DELETE_FIELD`, rechazo sin escritura). El servicio desplegado arrancó, sirve `/health` y
rechaza tokens inválidos con `401`.

**Sin verificar todavía**: `verifyIdToken` con un ID token real de usuario — nadie escribió
desde una sesión firmada después del despliegue. La prueba de 30 segundos: abrir la app,
tipear en una nota y ver que `allowance/{tu-uid}/days/{hoy}.opsUsed` sube y que el diálogo
de uso muestra "Medido por el servidor".
