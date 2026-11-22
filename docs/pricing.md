# Costos de Firestore y modelo de precios — FireMD

**Estado**: propuesta. El cobro no está implementado; la medición y la UI sí (ver §6).
**Modelo comercial superado**: §4 y §7 los reemplaza
[`prepaid-usage-model.md`](prepaid-usage-model.md) (uso prepago + cuota gratuita mensual
renovable). Este documento sigue siendo la fuente de los costos (§1-§3), de la medición
(§6) y de las salvaguardas (§5).
**Fecha**: 22-nov-2026. **Fuente de los números**: `scripts/pricing-model.mjs`
(reproducible con `node scripts/pricing-model.mjs`; no depende de Firebase).

Este documento fija dos cosas: (1) cuánto cuesta operar la arquitectura actual en
Firestore Standard (US), y (2) qué se cobra y a quién. El punto 2 no se puede ejecutar
todavía porque falta medición confiable del lado servidor (§6).

---

## 1. Tarifas y cuota gratuita

Región **US** (`us-central1` / `nam5`). En `southamerica-east1` (São Paulo) las
operaciones cuestan ~50–60 % más: la base queda en US, como está hoy.

| Concepto | Cuota gratis (proyecto) | Precio excedente | Nota para FireMD |
|---|---|---|---|
| Escrituras | 20.000 / día | **$0,09 / 100k** ($0,90 / 1M) | Cada bloque del CRDT (throttle 350 ms), cada guardado de nota y cada heartbeat de presencia es 1 escritura. Es el costo dominante. |
| Lecturas | 50.000 / día | **$0,03 / 100k** ($0,30 / 1M) | Listeners `onSnapshot`, apertura de notas, `get()` de reglas y los `ls`/`find` de agentes. |
| Borrados | 20.000 / día | **$0,01 / 100k** ($0,10 / 1M) | Compactación de la subcolección `updates` y borrado de notas. |
| Almacenamiento | 1 GiB total | **$0,15 / GiB-mes** | ~4.000 notas markdown al límite de 250 KB, o ~1.700 lienzos de 600 KB, por GiB. |
| PITR | sin cuota | **$0,15 / GiB-mes** | Activo en producción (README §Operación). |
| Backup | sin cuota | **$0,03 / GiB-mes** | Activo en producción. |
| Egress | 10 GiB / mes | **$0,12 / GiB** | Markdown comprimido: consume poco. |
| Auth / Hosting | 50.000 MAU / 10 GiB | gratis hasta escalar | Login con Google sin costo hasta 50k MAU. |

La cuota de operaciones es **por día y por proyecto**, no por usuario. La de storage y
egress es mensual. Eso importa: el free tier se consume entre todos los usuarios a la
vez, así que el costo marginal de un usuario no es cero hasta agotar la cuota del día.

---

## 2. Costo por usuario y por flota

Perfil simulado: usuario intensivo, 22 días activos/mes, 30 min de tipeo real por día,
colabora con una persona y corre ~100 comandos de agente CLI/MCP por día. 20 MB de
notas + historial.

El script corre dos juegos de supuestos sobre el mismo modelo:

- **base** — las premisas del documento original (2 escrituras/s, heartbeat 20 s).
- **code** — las constantes reales del código (throttle 350 ms → 2,86 escrituras/s,
  heartbeat 10 s, borrados de compactación, guardados de nota y escrituras del medidor).

| | base | code (real) |
|---|---|---|
| Escrituras / día | 4.100 | 6.332 |
| Lecturas / día | 5.300 | 6.093 |
| Borrados / día | 3.600 | 5.144 |
| **Costo bruto usuario/mes** | **$0,1271** | **$0,1799** |
| — escrituras | $0,0812 | $0,1254 |
| — lecturas | $0,0350 | $0,0402 |
| — borrados | $0,0079 | $0,0113 |
| — storage | $0,0030 | $0,0030 |
| **100 DAU/mes (neto de cuota)** | **$16,02** | **$23,22** |
| Operaciones facturables (100 DAU) | 11,7M writes · 14,4M reads · 10,2M deletes | 18,4M writes · 16,8M reads · 14,8M deletes |

Salida literal del script:

```text
[base] usuario intensivo/mes: $0.1271
  writes=$0.0812 reads=$0.0350 deletes=$0.0079 storage=$0.0030
  100 DAU/mes (neto de cuota): $16.02
[code] usuario intensivo/mes: $0.1799
  writes=$0.1254 reads=$0.0402 deletes=$0.0113 storage=$0.0030
  100 DAU/mes (neto de cuota): $23.22
1M writes=$0.90 1M reads=$0.30 1M deletes=$0.10
Margen con $5/1M operaciones: reads 94%, writes 82%
Storage: costo $0.33/GiB-mes, precio $0.50 -> margen 34%
```

**Por qué el modelo original subestima ~40 %** (detalle en §3):

1. El comentario dice "throttle 350 ms (~2,8 writes/s)" pero después calcula con
   **2 writes/s**. El código usa 350 ms (`provider.ts:25`): 1.800 s / 0,35 = 5.143
   bloques, no 3.600.
2. El modelo asume heartbeat de presencia cada **20 s**; el código usa **10 s**
   (`awareness.ts:30`): 720 escrituras/día en 2 h, no 360.
3. No cuenta los **guardados de nota** (debounce 1,2 s en `NotePane.tsx:147-154`): cada uno
   escribe 2 documentos (`body/main` + `notes/{id}`).
4. No cuenta el **propio medidor de uso**: 1 escritura cada 30 s por editor activo
   (`CollaborativeEditor.tsx:80-92`).
5. No cuenta los **borrados reales** de la compactación (borra todos los bloques
   aplicados, `provider.ts:423-427`).

El orden de magnitud se mantiene: un usuario intensivo cuesta **centavos**, y 100 DAU
cuestan **decenas de dólares**, no cientos. El riesgo financiero no está en el usuario
humano: está en el agente en bucle y en el free tier sin medidor.

---

## 3. Discrepancias entre el modelo y el código

| # | Modelo dice | El código hace | Efecto |
|---|---|---|---|
| 1 | 2 escrituras/s | 2,86/s (`FLUSH_MS = 350`) | +43 % de bloques |
| 2 | Heartbeat 20 s | 10 s (`HEARTBEAT_MS = 10_000`) | +100 % de presencia |
| 3 | 3.600 borrados/día | Borra todos los bloques aplicados al compactar | Borrados ≈ escrituras de bloque |
| 4 | Compacta cada 40 bloques o 160 KB | Además compacta por inactividad a los 5 min (`COMPACT_IDLE_MS`) | Manifiestos extra al cerrar sesión |
| 5 | Costo = escrituras + lecturas | `estimateCost()` solo suma reads y writes (`usage.ts:43-44`) | El costo mostrado omite deletes, storage y egress |
| 6 | Cuota gratis por proyecto | No hay contabilidad de cuota ni tope en el cliente | El free tier se consume sin aviso |
| 7 | Egress $0,12/GiB | `bytesRead`/`bytesWritten` se miden pero no se cotizan | Egress no aparece en el costo |
| 8 | PITR + backup | Activos en producción (README), fuera del modelo | +$0,18/GiB-mes no contabilizado |

Nota menor: las reglas hacen `get()` de la nota y del entitlement. Cada `get()` en
reglas se factura como lectura (cacheada por request), así que abrir una nota puede
costar 1 lectura más de las que cuenta el modelo.

Las filas 2, 3, 4, 5, 7 y 8 ya están corregidas en el medidor: cuenta borrados y
manifiestos, presencia, prorratea storage/PITR/backup/egress y usa un bucket mensual. La
tabla queda como registro del diagnóstico original, no como estado actual.

---

## 4. Modelo comercial (decidido)

> **Superado por decisiones posteriores** (ver
> [`prepaid-usage-model.md`](prepaid-usage-model.md) D1, D3 y D6): el **tiempo real pasa a ser
> pago**, así que la «colaboración ilimitada» de §4A deja de ser gratuita; la gratuidad pasa
> de **permanente** a **cuota diaria renovable** (100 MB + 700 operaciones/día); y el cobro es
> **por día** (uso sobre la cuota + margen), no un fee mensual. El saldo prepago de §4B se
> mantiene, con mínimo de recarga $5 y vencimiento a 24 meses. Lo demás de esta sección sigue
> siendo el registro de la decisión anterior.

**Decisión:** cuota gratuita permanente + saldo prepago con top-up. La edición humana no
se cobra; se cobra el volumen (agentes, storage extra, historial). Ver §6 para lo que ya
está implementado.

El costo marginal es tan bajo que **no conviene poner barrera de pago en la edición
humana**: mata la adopción y el loop viral de compartir links. Se monetiza lo que
escala por volumen o automatización.

### A. Cuota gratuita permanente (sin tarjeta)

- Notas y carpetas ilimitadas, hasta **250 MB** de almacenamiento total (costo real
  máximo ~$0,04/mes).
- Colaboración en tiempo real ilimitada (o 3–5 editores por documento).
- **10.000 operaciones de agente/mes** (CLI/MCP). Costo < $0,01/mes por usuario; deja
  probar la integración con Claude/Cursor/OpenClaw sin fricción.

### B. Saldo prepago (packs que no vencen)

- Packs de **$5, $15 o $50**, con auto top-up opcional cuando el saldo baja de $1.
- Tarifas en la página de uso:
  - **Operaciones de agente: $0,50 / 100k** ($5 / 1M). Margen bruto 82 % (si son
    escrituras) a 94 % (si son lecturas).
  - **Almacenamiento extra: $0,50 / GB-mes** sobre los 250 MB gratis. Costo con PITR +
    backup: $0,33/GiB-mes → margen 34 %.
  - Historial extendido / snapshots / exportación automática: micro-cargo o
    desbloqueado con saldo cargado.

### C. Planes flat: decisión pendiente

La UI todavía muestra **planes flat de $4 (solo) y $12 (hasta 5 personas)**
(`UpgradeDialog.tsx`), y `entitlements` bloquea compartir y agentes con `plan === 'paid'`.
El modelo elegido es free tier + créditos, así que ese gating **sobra**: compartir es el
loop viral y no debería pagarse. Queda pendiente retirarlo (reglas `sharingUnlocked`,
`UpgradeDialog`, los tres puntos de `AppTree` y sus tests). Mientras siga, la promesa de
"colaboración ilimitada" del free tier no se cumple en el código.

### D. Proveedor de pagos

Stripe no opera desde Uruguay. Opciones: Merchant of Record (Paddle / Lemon Squeezy /
Polar, ~5 % + $0,50, resuelve IVA) o MercadoPago / dLocal local. El mínimo de $2 es
caro: en $2 el fee se lleva 18 % (Stripe) a 30 % (MoR). Empujar packs de $5/$10 y
aceptar $2 como mínimo configurable.

---

## 5. Salvaguardas financieras

1. **Throttle del CRDT según actividad**: subir de 350 ms a 500–600 ms sigue siendo
   instantáneo al ojo y recorta escrituras y borrados de compactación ~35–40 %.
   Cambia una constante (`provider.ts:25`) y los tests de collab miden la latencia.
2. **Rate limit por minuto en CLI/MCP**: hoy no existe. Un agente en bucle haciendo
   `find`/`patch` puede quemar el saldo en minutos. Default 60 req/min, configurable.
3. **Cuota cacheada en el cliente/reglas**: no hacer una lectura extra por tecla. El
   estado de cuota/tier va en `profiles/{uid}` o en Custom Claims (viajan en el JWT y
   se leen en reglas sin lectura extra).
4. **Tope duro de gasto**: un presupuesto de Firebase avisa pero no corta. Para el free
   tier hace falta un tope real (contador del servidor o límite por reglas).

---

## 6. Qué está implementado y qué falta

### Implementado (con evidencia)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Contadores de uso | `src/lib/usage.ts:67-129` | Bucket mensual `usage/{uid}/months/{YYYY-MM}` con `writes`, `reads`, `deletes`, `bytesWritten`, `bytesRead`, `storageBytes`; incrementos con `setDoc(..., {merge:true})`. El bucket se renueva solo al cambiar de mes. |
| Alimentación desde el sync | `src/AppTree.tsx:452-475` | Deltas de `SyncStats` (bloques/bytes escritos y aplicados, borrados de compactación, manifiestos y presencia) cada 30 s (`CollaborativeEditor.tsx:80-92`). |
| Borrados y manifiestos | `src/lib/collab/provider.ts:38-40,429,440` | La compactación cuenta sus manifiestos y cada documento borrado. |
| Presencia contada | `src/lib/collab/awareness.ts:43` | El canal de presencia expone sus propias escrituras y borrados; `NoteSession` los fusiona con las del provider. |
| Storage recalculado | `src/AppTree.tsx:478-486` | Suma de `markdownBytes` de las notas, debounce 5 s. |
| Costo completo | `src/lib/usage.ts:228-243` | `costBreakdown()`: escrituras, lecturas, borrados, storage, PITR, backup y egress. `estimateCost()` sigue devolviendo el total. |
| Diálogo de uso | `src/components/UsageDialog.tsx` | Desglose del cargo del día, operaciones (incluye borrados), storage, créditos y diagnóstico de memoria. |
| Rate limit y presupuesto del agente | `agent/rate-limit.mjs` + `agent/firestore-rest.mjs` + `agent/mcp.mjs` | Ventana fija por minuto (`FIREMD_AGENT_RATE_LIMIT`, default 60) y techo de requests por corrida (`FIREMD_REQUEST_BUDGET`, default 2000); el MCP resetea el presupuesto por tool call. |
| Metering de agentes | `agent/firestore-rest.mjs` + `agent/cli.mjs` + `agent/mcp.mjs` | El store REST cuenta reads/writes/deletes por request; `flushUsage()` los vuelca con incrementos al bucket `usage/{uid}/days/{YYYY-MM-DD}`. La CLI vuelca al terminar cada comando y el MCP cada 30 s y al recibir SIGINT/SIGTERM. Best-effort: si el volcado falla, se descarta (subcontar antes que duplicar). |
| Cuota gratuita | `src/lib/quota.ts` + `src/components/UsageDialog.tsx` | `FREE_TIER` con 100 MB y 700 operaciones/día; `quotaLine()` calcula uso, tope y aviso (80% suave, 100% duro); `dailyCharge()` cobra solo lo que pasa la cuota; el diálogo muestra barras de storage y operaciones. Las cuentas admin no tienen tope. |
| Saldo prepago | `src/lib/credits.ts` + `src/components/UsageDialog.tsx` | Packs de $5/$15/$50 con vencimiento a 24 meses; `updateCreditSettings()` guarda umbral/monto/auto top-up; `requestTopUp()` crea una solicitud pendiente en `credits/{uid}/topups`. El saldo sigue siendo del servidor. |
| Créditos (modelo) | `src/lib/usage.ts:182-208` + `firestore.rules:570-631` | `credits/{uid}` con `balanceUsd`, `thresholdUsd`, `topUpUsd` (≥ $5), `autoTopUp`; el dueño edita solo la configuración (el saldo no cambia); ledger inmutable; solicitudes de recarga en `topups`. |
| Admin | `src/lib/admin.ts` + `firestore.rules:83-95` | `admins/{uid}` marca la cuenta; el bootstrap por email es `iuvalgoldansky@gmail.com`; los admins no pagan ni tienen tope. |
| Gating flat | retirado | `sharingUnlocked` y `UpgradeDialog` se eliminaron: compartir y agentes son parte del free tier. El cobro es por uso (cuota + créditos). |
| Reglas de uso y créditos | `firestore.rules:531-631` | Solo el dueño escribe el bucket diario (id `YYYY-MM-DD`, enteros ≥ 0, campos con lista blanca, `agentOps` incluido); el documento único `usage/{uid}` quedó retirado; en `credits`, el dueño edita configuración sin tocar el saldo y pide recargas; saldo y ledger, solo admin. |
| Tests | `tests/usage.test.ts`; `tests/quota.test.ts`; `tests/credits.test.ts`; `tests/agent-rate-limit.test.ts`; `tests/agent.test.ts`; `tests/firestore.rules.test.ts:1089+` | Tarifas, desglose, rollover de día, cuota, cargo diario, créditos, rate limiter y presupuesto; metering del agente contra el emulador; reglas del bucket, `credits` y `topups`. |
| Backups / PITR | README §Operación | Activos en producción. |

### Falta (por prioridad)

Los ítems 2, 3, 4, 6 y 11 del listado original ya están hechos (borrados contados, costo
completo, bucket mensual, rate limit y PITR/backup en el costo), el metering de agentes
se agregó después y el gating flat se retiró. Queda:

| # | Falta | Evidencia del hueco | Tamaño |
|---|---|---|---|
| 1 | **Medición confiable server-side** | El bucket lo escribe el cliente (y ahora también la CLI/MCP) y las reglas lo permiten (`firestore.rules:531-631`): sirve para mostrar, no para cobrar. El propio código lo dice (`usage.ts:15-18`). | L — Cloud Function + contadores. |
| 2 | **Tope duro de storage** | La cuota de 100 MB se muestra y se avisa, pero no se bloquea: el storage lo calcula el cliente y las reglas no lo verifican. | M — reglas + contador server-side. |
| 3 | **Consumo de créditos** | `credits` y `topups` existen, pero nada debita el saldo ni acredita una recarga; el ledger es inmutable desde el cliente. | M — backend. |
| 4 | **Checkout / proveedor** | La solicitud de recarga queda pendiente; no hay pasarela. Stripe no opera en UY. | L — MoR o MercadoPago/dLocal. |
| 5 | **Throttle 500–600 ms** | Sigue en 350 ms (`provider.ts:25`). Es una decisión de UX, no un bug: medir la latencia antes de cambiarlo. | S — una constante + medir. |

### Deriva de documentación (corregida)

- `docs/roadmap.md` decía que el proyecto estaba en **Spark**; el README §Operación dice
  **Blaze**. Corregido: el roadmap ahora dice Blaze sin Cloud Functions.
- `docs/comercial-review.md` decía "no hay backups ni PITR habilitados"; el README los
  lista como activos. Corregido: el review ahora los da por activos.
- `docs/comercial-review.md` estimaba storage a $0,006/GiB-mes; la tarifa Standard es
  **$0,15/GiB-mes**. Corregido, con puntero a este documento.

---

## 7. Plan sugerido (orden)

> **Superado** por [`prepaid-usage-model.md`](prepaid-usage-model.md) §7: el orden cambia —
> la medición server-side (el proxy) va **antes** que la cuota, y el corte en reglas se
> retira hasta que exista degradación a borrador local durable.

1. ~~**Completar el medidor**~~ (hecho): borrados, bucket mensual, costo con deletes +
   storage + PITR/backup + egress, y desglose en el diálogo.
2. ~~**Rate limit del agente**~~ (hecho): ventana por minuto y presupuesto por corrida.
3. ~~**Metering de agentes**~~ (hecho): el store REST cuenta operaciones y la CLI/MCP
   vuelcan al bucket mensual.
4. ~~**Decidir el modelo comercial**~~ (hecho): free tier + créditos prepagos.
5. ~~**Cuota free tier**~~ (hecho): 100 MB y 700 operaciones diarias, con aviso en el
   diálogo y corte en la CLI/MCP. Las cuentas admin no tienen tope.
6. ~~**Saldo prepago**~~ (hecho): packs, configuración de auto top-up y solicitudes.
7. **Medición server-side** (L): Cloud Function que agregue eventos y escriba el bucket;
   el cliente pasa a solo lectura. Recién ahí el cobro es posible.
8. **Checkout** (L): MoR o MercadoPago/dLocal, webhook idempotente, ledger, factura.
9. ~~**Retirar el gating flat**~~ (hecho): compartir y agentes ya no piden plan pago.

Los pasos 1–6 y 9 ya están hechos y no dependen de Blaze ni del proveedor de pagos. El paso 7
depende de Cloud Run (decisión D12); el 8, de elegir pasarela.
