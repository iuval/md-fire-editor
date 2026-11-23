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
| **E1** proxy del canal caliente | **parcial** | `block` (1 escritura) y `body` (3) por HTTP. Presencia y compactación siguen del lado del cliente. |
| **E2** cerrar escrituras directas | **hecho, apagado** | Interruptor `config/proxy.enforced` en las rules: bloques y `body` update. Se prende después del despliegue. |
| **E3** cuota + débito + libro | **hecho** | `allowance/{uid}/days/{d}`, débito del saldo, libro inmutable, idempotencia por `opId`, reserva por operación (nunca negativo), auto top-up. |
| **E6** checkout MoR | **hecho** | Sesión de Lemon Squeezy + webhook firmado que acredita saldo, packs $5/$15/$50 y vencimiento a 24 meses. Falta cargar las claves del MoR. |
| E4 agents/MCP por el proxy | pendiente | Hoy los agentes escriben por REST con su propio token. |
| E5 storage exacto + compactación server-side | pendiente | El stock se mueve en cada `body`; la compactación sigue siendo del cliente. |
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
| `POST` | `/v1/billing/checkout` | `{ packUsd, successUrl? }` | `{ url, id, packUsd }` |
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
recibo de idempotencia). El cargo se calcula con el precio publicado
(`$0,50/100k` escrituras, `$0,10/100k` borrados) sobre lo que cruza la cuota.

## 4. Datos que escribe

| Documento | Contenido |
|---|---|
| `notes/{id}`, `notes/{id}/body/main` | contenido, en la misma transacción del cobro |
| `notes/{id}/updates/{opId}` | bloque del log Yjs (el `opId` es el id) |
| `allowance/{uid}` | `storageBytes` (stock, se mueve con cada `body`) |
| `allowance/{uid}/days/{YYYY-MM-DD}` | `opsUsed`, `writes`, `deletes`, `quota`, `renewsAt` |
| `credits/{uid}` | `balanceUsd`, `totalToppedUpUsd`, `expiresAt` (24 meses) |
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
| `LEMONSQUEEZY_API_KEY` / `_STORE_ID` / `_VARIANT_ID` | checkout (E6) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | firma HMAC del webhook |

La service account necesita `roles/datastore.user` y `roles/firebaseauth.viewer`.

```bash
# 2. Cliente: el proxy pasa a ser el escritor
VITE_PROXY_URL=https://firemd-proxy-xxx.run.app npm run build && firebase deploy --only hosting
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

Tests automáticos que cubren 1-5 sin emulador: `tests/proxy-core.test.ts`
(24 casos) y `tests/proxy-http.test.ts` (13 casos). El 6 lo cubre
`tests/firestore.rules.test.ts` ("allowance y corte del proxy").

## 7. Lo que falta para cerrar E1/E5

- **Presencia**: hoy se escribe directo (`presence/{uid}`), no se cobra.
- **Compactación**: el cliente sigue borrando bloques con un batch directo; con
  E2 prendido esos deletes fallan. Antes de prender el interruptor hay que
  mover `maybeCompact()` al proxy (`kind: 'compact'`, 1 borrado por bloque).
- **Agentes CLI/MCP**: escriben por REST con el token del agente; siguen fuera
  del medidor hasta E4.
- **Escritorio**: sigue con pull/push cada 15 s contra Firestore (D4).
- **Storage**: el cargo mensual por MB extra no se debita todavía (E5).

**Riesgo abierto, sin verificar en el árbol**: el adaptador de Firestore
(`server/src/firestore.mjs`) y la verificación de ID tokens (`server/src/auth.mjs`) no se
llegaron a ejecutar — dependen de `firebase-admin`, que no está instalado en el repo. El
core, el router y el webhook están cubiertos por tests con un store en memoria. Primer paso
del despliegue: `npm --prefix server install` y un smoke test contra el emulador
(`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node server/src/index.mjs`) antes de tocar el
proyecto real.
