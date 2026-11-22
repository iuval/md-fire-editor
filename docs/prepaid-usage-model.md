# Uso prepago + cuota gratuita — diseño y plan

**Estado**: decisiones confirmadas; implementación en curso. D1, D6, D8 y D12 están
confirmadas; E7 y el bootstrap admin están hechos; E0 está parcial. Reemplaza el modelo
comercial de [`pricing.md`](pricing.md) §4 y el orden de [`pricing.md`](pricing.md) §7.
**Fecha**: 22-nov-2026. **Actualizado**: 22-nov-2026 (decisiones de producto y arranque de
implementación).
**Fuente de los números de costo**: [`pricing.md`](pricing.md) §1-§2 y
`node scripts/pricing-model.mjs`. Los números de este documento son derivados de esos.

Este documento fija: qué se cobra, cómo se cobra, cómo se mide sin que el cliente pueda
mentir, qué pasa cuando se termina la cuota gratuita, y en qué orden se construye.

---

## 0. Decisiones tomadas (log)

Numeradas para poder citarlas en el código y en los issues. Las seis primeras son del
producto; las demás son consecuencias que se derivan de ellas y que el diseño obliga.

| # | Decisión | Consecuencia |
|---|---|---|
| **D1** | El tiempo real es **pago**. | El modo gratuito no tiene presencia ni bloques a 350 ms. |
| **D2** | Se construye **lo que sea necesario** para que el prepago sea real (proxy propio). | El cliente deja de escribir datos de usuario directo en Firestore. |
| **D3** | Cada cuenta paga **su uso real** (storage + acciones) **más un fee**. | El storage deja de ser un regalo sin techo y pasa a ser exacto y atribuible. |
| **D4** | El **sync de escritorio es realtime, bidireccional y prepago**. | El motor de escritorio pasa de poll cada 15 s a suscriptor metered del mismo canal. |
| **D5** | **No hay planes fijos**: un tarifario único por uso + fee. Nada de tiers ni de "incluye X". | Se retira `entitlements.plan` como eje de gating. |
| **D6** | La gratuidad es una **cuota mensual renovable** (`free quota`), no un "free tier permanente" ni un crédito de bienvenida. Dos muros: **espacio** y **operaciones**. | El corte es **temporal** (se renueva el 1°) o se resuelve cargando saldo. |
| **D7** | Un **invitado** que escribe en un documento compartido consume la cuota/saldo del **dueño**; leer un link compartido es gratis. | Se preserva el loop viral (canal de adquisición #1) y el costo queda atribuido. |
| **D8** | Se retira `entitlements` / `hasPaidPlan()` / `UpgradeDialog`. **Compartir vuelve a ser gratis.** | Menos estados, menos UI, menos soporte. |
| **D9** | **Nunca** se cortan las lecturas de los datos propios, ni se borra nada por falta de pago. | El export y la lectura sobreviven a cualquier corte. Requisito legal y de confianza. |
| **D10** | El corte es **degradación a local durable**, nunca negación seca. | Escribir cuesta lo mismo que hoy hasta que el proxy dice "no"; ahí se escribe local y se avisa. |
| **D11** | Las **cuentas admin no pagan** ni tienen tope. El bootstrap es `iuvalgoldansky@gmail.com`; el admin se marca en `admins/{uid}`. | `freeTierStatus()` y `agentOpsAllowed()` reciben `admin`; el proxy no debita. |
| **D12** | El proxy corre en **Cloud Run**. | Se reusa el stack actual (Node/TypeScript), y la decisión es reversible. |
| **D13** | **No hay cuentas legacy**: la app no está en producción. Se migra todo al modelo nuevo. | `entitlements` se elimina; no hay datos que preservar. |

---

## 1. Por qué: el estado actual, con evidencia

Ninguna de estas es una opinión; están verificadas en el árbol.

| Pieza | Dónde | Qué hace hoy | Problema |
|---|---|---|---|
| Cuota gratuita declarada | `src/lib/quota.ts:16-22` | `100 MB` + `20.000` ops/mes | Solo dibuja barras (`UsageDialog.tsx:139-152`). No frena nada. |
| Predicado de cuota | `src/lib/quota.ts:69` | `agentOpsAllowed()` | Exportado y **sin un solo uso** en `src/`. |
| Freno de agentes | `agent/cli.mjs:122`, `agent/mcp.mjs:206` | Corta a 10k ops leyendo el bucket | El bucket lo escribe el cliente (`firestore.rules:531-560`), y `agentOps` está en la whitelist → `PATCH {agentOps: 0}` resetea la cuota. |
| Créditos | `src/lib/credits.ts` + `firestore.rules:587` | `balanceUsd`, ledger inmutable, `requestTopUp` | **Nada debita.** Las recargas quedan `pending` para siempre. |
| Gating por plan | retirado | Compartir y agentes ya no exigen plan | D8 hecho; `entitlements` se elimina con D13. |
| Caché local | `src/firebase.ts:36` | `persistentLocalCache` 20 MB | Es caché LRU del SDK, no un archivo del usuario. Sin `navigator.storage.persist()` en todo `src/` → evictable. |
| Cola CRDT | `src/lib/collab/provider.ts:343` | `this.queued` en memoria | Reload = se pierde lo no enviado. La única durabilidad es el body con debounce 1,2 s (`NotePane.tsx:147`). |
| Metring del escritorio | `desktop/src` | Cero referencias a usage | El sync de escritorio es uso ilimitado y gratis de Firestore. |
| Export → Import | `AppTree.tsx:780-805` | `pushNote` crea notas nuevas | No es round trip: duplicados, links muertos, ACLs perdidas. |

### 1.1 Los números que obligan a decidir

- La cuota gratuita de Firestore es **del proyecto, por día**: 20.000 escrituras. Con
  2,86 escrituras/s (`provider.ts:25`) y ~7.000 escrituras por media hora de tipeo
  intenso, son **~2,8 medias horas de tipeo por día para todos los usuarios juntos**.
- En colaboración las **lecturas** se agotan antes: cada bloque escrito es 1 lectura por
  listener.
- Costo medido: **100 DAU ≈ $23,22/mes**; **1.000 usuarios intensos ≈ $513/mes**
  (`comercial-review.md`).
- Storage es un **stock que no decae**: 250 MB con PITR+backup son ~$0,081/mes por cuenta,
  para siempre, y a ~2 KB por nota son ~125.000 notas → **ese muro no se toca nunca**. No
  sirve como disparador de conversión; sirve como válvula antabuso.

De ahí las dos conclusiones que estructuran todo lo demás: (a) cobrar exige un punto único
de control, (b) el disparador de conversión honesto es el **tipeo** (operaciones), no los MB.

---

## 2. Modelo comercial

### 2.1 Tarifario único (D5)

Cost-plus, publicado, sobre unidades que el proxy conoce con exactitud. Sin tiers, sin
"Incluye X".

| Unidad | Costo real | Precio | Margen |
|---|---|---|---|
| Escritura (bloque, guardado de body) | $0,09 / 100k | **$0,50 / 100k** | 82 % |
| Lectura entregada (update, apertura de nota) | $0,03 / 100k | **$0,30 / 100k** | 90 % |
| Borrado / compactación | $0,01 / 100k | **$0,10 / 100k** | 90 % |
| Storage (con PITR + backup) | $0,33 / GiB-mes | **$0,60 / GiB-mes** | 45 % |
| Egreso | $0,12 / GiB | **$0,20 / GiB** | 40 % |
| Operación de agente | sus operaciones reales (mín. 1 escritura) | **se cobra por operación producida**, no por tool call | real |

El último renglón es la corrección de unidad: un `find` sobre 500 notas cuesta lo que cuesta;
un `cat` cuesta 1. Cobrar por "tool call" subvaluaba `find`/`vault pull` en dos órdenes de
magnitud y hacía falso el margen de 82-94 %.

### 2.2 El fee

Un solo cargo fijo, descontado del saldo: **$0,50/mes por cuenta con actividad**. Sin
suscripción, sin tiers, sin "incluye". Cuenta sin actividad en el mes → no se cobra.

- **Mínimo de recarga: $5** (no $2: con un MoR al ~5 % + $0,50, $2 deja $1,40, un 30 % de
  fee). Packs $5 / $15 / $50.
- **El saldo vence a los 24 meses.** "No vence" es un pasivo contable infinito y una promesa
  que no conviene hacer.
- El procesamiento del MoR queda cubierto por el margen unitario con packs de $5.

### 2.3 La cuota gratuita (D6)

**100 MB de storage + 20.000 operaciones por mes calendario UTC.** Se renueva sola el 1°.

| Concepto | Al tope | Costo tuyo/mes |
|---|---|---|
| 20.000 ops (todas escrituras) | $0,09/100k | **$0,018** |
| Storage 100 MB con PITR + backup | $0,33/GiB-mes | **$0,032** |
| **Total por cuenta gratis al tope** | | **≈ $0,05** |

- 1.000 cuentas gratis al tope ≈ **$50/mes**; 10.000 ≈ **$500/mes**.
- De eso, **$0,032/cuenta es storage que persiste para siempre** aunque la cuenta no vuelva
  → hace falta política de dormancia (§6.4).
- Comparación con el statu quo: 1.000 DAU sin medidor ≈ **$513/mes** y sin techo.

**Por qué 20.000 y no 2.000.** El usuario de notas chicas hace sesiones de ~5 min
(~860 escrituras): 20.000 son ~20-25 sesiones cortas al mes, holgado para probar y para
vivir. El que escribe 30 min/día lo toca al tercer día. Ese es el disparador.

**Por qué el muro de storage está en 100 MB y no antes.** Con texto no se llega nunca
(~50.000 notas); su función es cortar el abuso (un vault de adjuntos, un script), no
convertir. Y cuando se cruza, se rechaza **la escritura que cruza**, se nombra la nota más
pesada y se ofrece export. **Nunca se borra.**

### 2.4 Quién paga qué

| Situación | Paga |
|---|---|
| Edición propia dentro de la cuota | nadie (tu costo: ≤ $0,05/mes) |
| Edición propia pasada la cuota | el saldo del usuario |
| Lectura de un documento propio | nunca se cobra (D9) |
| Lectura de un link compartido | gratis (es barata y es el canal de adquisición) |
| Escritura de un invitado en un doc ajeno | **la cuota/saldo del dueño** (D7) |
| Agentes CLI/MCP | el saldo del que corre el agente (su uid), por operación real |
| Sync de escritorio en modo pull/push | cuota/saldo del dueño, batcheado |
| Sync de escritorio realtime | saldo (D1 + D4) |

Tope de invitados por documento: **5** (coincide con el `$12 hasta 5` que ya se había
pensado), para que un dueño no hospede 50 personas gratis.

### 2.5 Conversión esperada (para no engañarse)

De 10.000 cuentas gratis al tope ($500/mes de costo) hacen falta ~**350 cuentas pagas**
(fee $0,50 + ~$1 de uso) para cubrirlo. El negocio depende de que la cuota gratuita sea
barata y de que el uso pago sea fácil de activar, no de que "el free tier se sostenga solo".

---

## 3. Arquitectura: el punto único de control

### 3.1 Por qué Firestore no puede cobrar

1. **No hay evento por lectura.** No existe trigger, log ni export por lectura atribuible a
   un usuario. Las lecturas son el 30-40 % del costo y son inmedibles server-side.
2. **Las reglas no debitan.** No pueden leer un saldo mutable y descontarlo atómicamente por
   operación sin una lectura extra por request y sin carrera.
3. **Una Cloud Function por escritura cuesta más que la escritura.** A $0,40/1M invocaciones
   contra $0,09/1M escrituras, medir cuesta **4×** lo medido. Inservible en el hot path.
4. **El contador del cliente no sirve**: hoy el propio limitado escribe su contador
   (`firestore.rules:531-560`).

### 3.2 El choke point (D2)

> **Cerrar la escritura directa del cliente a datos de usuario** — `notes`, `body`,
> `updates`, `usage`, `credits` con `allow write: if false` — y mover esas escrituras a un
> **proxy propio** con service account.

Consecuencias, todas necesarias para D3:

- El metering deja de ser honor-system: **no hay camino alternativo**.
- Las **lecturas pasan a ser medibles**: el cliente no usa `onSnapshot` para bloques; el
  proxy le empuja updates y cuenta un read-equivalente por update entregado.
- El **storage pasa a ser exacto y atribuible**: el proxy escribe la nota y sabe los bytes
  por usuario; mantiene el agregado server-side (incrementa al escribir, decrementa al
  borrar).
- La **compactación se hace server-side** por inactividad, en vez de que cada cliente pague
  sus propios borrados (`provider.ts:406-445`).
- Las **rules quedan como defensa en profundidad** para caminos fríos (auth, listados,
  agentes REST); el proxy es la autoridad para datos de usuario.

### 3.3 Sustrato

| | Cloudflare Workers + Durable Objects + D1 | Cloud Run + y-websocket + Admin SDK |
|---|---|---|
| Costo por mensaje | $0,15/1M requests (+ duration) | ~$0,90/1M si escribe 1 doc por mensaje, o batch |
| Tipeo de 1.000 usuarios intensos (44 h/mes c/u ≈ 453M mensajes) | ≈ **$68/mes** + duration | ≈ **$408/mes** en escrituras |
| Reuso | reescribir ACL contra REST + JWT de servicio | reusa Node, Admin SDK y casi toda la lógica actual |
| Tiempo real | nativo (un objeto por documento) | WS propio, viable |

**Recomendación: Cloud Run primero.** Se reusa el código, escala a 0 y el contrato con el
cliente es el mismo que con Workers → la decisión es reversible. Workers/DO solo si el
costo por mensaje duele.

### 3.4 Contrato del canal (mínimo)

Un WebSocket por cliente, mensajes con `opId` (idempotencia), `kind` y `bytes`:

| `kind` | Qué hace el proxy | Qué cobra |
|---|---|---|
| `block` | Aplica el update Yjs al doc, lo persiste, lo difunde a los suscriptores | 1 escritura + N lecturas entregadas |
| `body` | Guarda markdown + metadatos de la nota (el batch que hoy hace `notes.ts:516`) | 2 escrituras |
| `presence` | Difunde sin persistir | 1 mensaje (lectura entregada por suscriptor) |
| `agent` | Ejecuta en nombre del uid del agente | operaciones reales |
| `sync-pull` / `sync-push` | Diff batcheado para el escritorio | 1 evento + ops del lote |

Cada mensaje lleva `uid` del pagador resuelto por el ACL del documento (D7), no por el
remitente.

### 3.5 Datos y quién escribe cada cosa

| Documento | Escribe | Contenido |
|---|---|---|
| `allowance/{uid}/months/{YYYY-MM}` | solo proxy | `opsUsed`, `storageBytes`, `renewedAt` |
| `credits/{uid}` | solo servidor | `balanceUsd`, `thresholdUsd`, `topUpUsd`, `autoTopUp` |
| `credits/{uid}/ledger/{id}` | solo servidor | entrada inmutable: cargo/recarga, motivo, `opId` |
| `credits/{uid}/topups/{id}` | el usuario (solicitud) | `amountUsd`, `status: pending` |
| `usage/{uid}/months/{YYYY-MM}` | **nadie** (se retira) | absorbido por `allowance` |

`credits` ya cumple la mitad (`firestore.rules:587-608`: el dueño edita la config, no el
saldo). Lo que falta es el débito.

### 3.6 Orden de decisión de una operación

```text
1. ACL: ¿puede este uid escribir este documento? (proxy, cacheado por doc)
2. Pagador: dueño del documento o remitente, según D7
3. Idempotencia: ¿opId ya aplicado? → responder ok sin cobrar
4. Cuota: ¿opsUsed + costo ≤ cuota gratuita? → aplicar, sumar, NO debitar
5. Saldo: ¿balanceUsd ≥ costo? → aplicar, debitar, escribir ledger
6. Pago: ¿autoTopUp y saldo < umbral? → disparar recarga off-session
7. Ninguno: rechazar con estado explícito (free-exhausted | pay-exhausted)
            + reservar el cobro de la última operación en vuelo (nunca negativo)
```

La reserva por mensaje (paso 7) evita saldos negativos: se permite terminar la operación en
vuelo y se corta en la siguiente.

---

## 4. Estados de la app

| Estado | Disparador | Qué puede hacer el usuario | UI |
|---|---|---|---|
| `free` | dentro de la cuota | todo, en modo liviano | barra discreta en el diálogo de uso |
| `free-exhausted` | ops al tope, mes en curso | lectura cloud + escritura local | «Llegaste al tope del mes. Se renueva el 1/12 **o** cargá $5.» |
| `low` | saldo < forecast diario | todo | aviso + auto top-up |
| `pay-exhausted` | saldo 0 | lectura cloud + escritura local | «Sin saldo» + export + cargar |
| `storage-over` | storage > 100 MB | lectura + export; se rechaza la escritura que cruza | nombra la nota más pesada, no borra |

**Invariantes, sin excepciones:**

1. Leer los datos propios siempre se permite (D9).
2. Nunca se borra nada por falta de pago (D9).
3. El corte siempre nombra **la fecha de renovación o el monto exacto** (D10).
4. El texto en vuelo nunca se pierde: va a un borrador local durable.
5. El corte se anuncia antes: al 80 % de la cuota.

### 4.1 El borrador local es prerequisito, no un extra

Para que D10 sea cierto hay que arreglar dos cosas que hoy no existen:

- **Cola CRDT persistida.** `provider.ts:343` guarda en memoria; `destroy()` la tira. Hay que
  escribir `Y.encodeStateAsUpdate` de la cola a IndexedDB en `pagehide`/`visibilitychange` y
  reproducirla al abrir.
- **`navigator.storage.persist()`** al primer guardado. Hoy `diagnostics.ts:40` solo llama
  `estimate()`: sin `persist()`, el navegador puede borrar la caché y la UI sigue diciendo
  «tus cambios se guardan acá» (`syncStatus.ts:41`).

Y el mensaje: `transportError.ts` manda cualquier negación al texto «No tenés permiso para
editar esta nota». Cuando la negación venga por cuota o saldo, tiene que decir eso y ofrecer
la salida.

**Lo que ya existe y no alcanza.** El borrador de invitado (`src/lib/guestDraft.ts`:
título + cuerpo en `localStorage`, migración de una vía al entrar, `GuestDraftDialog`) es el
patrón correcto pero cubre otro caso: el visitante **sin sesión** que todavía no decidió
entrar. No cubre al usuario logueado que se queda sin cuota (que necesita el texto de *su*
nota, con su `id` y su `etag`, no un borrador suelto) ni la cola CRDT.

---

## 5. Clientes

### 5.1 Web

- Modo liviano (gratis): sin presencia, debounce de bloque 1.200-2.000 ms, sin compactación
  del cliente.
- Modo live (saldo): presencia, 350 ms, cursores, compactación server-side.

### 5.2 Sync de escritorio (D4)

- Deja de hacer `pull` + `push` cada 15 s contra Firestore: se suscribe al mismo canal.
- Cada mensaje lo debita el proxy → se termina el uso ilimitado y gratis.
- Con saldo 0: **sigue escribiendo archivos**, deja de subir, el ícono de bandeja dice «sin
  saldo» y los pendientes quedan en `.firemd/manifest.json`. Los conflictos
  (`.conflicto-AAAA…`) ya funcionan y se reusan tal cual.
- Efecto bueno: un pull pasa de N lecturas de Firestore a 1 evento del proxy → el realtime se
  vuelve **más barato** que el polling actual.

### 5.3 CLI / MCP

- Token propio de agente, todas las operaciones por el proxy → el número de ops deja de ser
  falsificable y el rate limit pasa a ser server-side (`agent/rate-limit.mjs` queda como
  segunda línea).

---

## 6. Antabuso y fraude

1. **Cuenta de Google gratis → cuentas múltiples.** Mitigación: la cuota gratuita exige
   `emailVerified` en el token; el proxy recibe la señal de device/IP (bloqueo manual, no
   automático).
2. **Farming de invitados**: no rinde, porque el invitado paga con el saldo del dueño (D7).
3. **App Check aplicado** (`firebase.ts:29` hoy solo lo inicializa si hay site key): sin esto,
   un script con el API key público quema la cuota del proyecto.
4. **Dormancia**: 12 meses sin actividad y sin saldo → mail con export → borrado. Sin esto,
   el stock de 100 MB × N crece para siempre.
5. **Reserva por mensaje**: nunca quedan saldos negativos.
6. **Tope de invitados por documento** (5) y de recargas por día.

---

## 7. Migración por etapas

| Etapa | Qué | Depende de | Tamaño |
|---|---|---|---|
| **E0** | P0 de datos: cola CRDT persistida, `persist()`, estados `free-exhausted`/`storage-over`, mensajes correctos, import idempotente por `id` del manifest | nada (valor por sí solo) | M |
| **E1** | Proxy para el canal caliente de **una nota**: bloques + body + presencia, con `opId` e idempotencia | D2 | L |
| **E2** | Cerrar escrituras directas (`allow write: if false`) → el proxy es el único escritor | E1 | M |
| **E3** | `allowance` + débito + ledger + reserva por mensaje + auto top-up | E2 | M |
| **E4** | Agentes CLI/MCP por el proxy; rate limit server-side | E3 | S/M |
| **E5** | Storage exacto y compactación server-side | E2 | M |
| **E6** | Checkout MoR (packs $5/$15/$50, fee $0,50, vigencia 24 meses, factura) | E3 | L |
| **E7** | Retirar `entitlements`/`hasPaidPlan`/`UpgradeDialog`; reescribir el copy de "gratis para siempre" | E3, E6 | S |

**Estado observado en el árbol de trabajo (22-nov-2026).** E7 está hecha: `entitlements` y
`UpgradeDialog` se eliminaron y compartir ya no pide plan. También está el modo invitado
(`src/lib/guestMode.ts`, `GuestWorkspace`, `guestDraft.ts` con borrador en `localStorage` y
migración al entrar). Queda de E0: no hay cola CRDT persistida, no hay `storage.persist()`.
E1-E6 no empezaron: no hay proxy, no hay `allowance`, no hay débito de créditos.

E0 se puede hacer **hoy** y no depende de ninguna decisión pendiente: arregla pérdida de
datos real (la cola en memoria) y es la base de D10. E1 arranca con el proxy en Cloud Run
(D12).

---

## 8. Slice mínimo verificable

Un solo escenario end-to-end, en este orden. Es el criterio de aceptación de E1-E3.

| # | Escenario | Se verifica |
|---|---|---|
| 1 | Usuario nuevo escribe 30 mensajes | `allowance.opsUsed` sube por el proxy; `credits` no se toca |
| 2 | Llega al tope a mitad de tipeo | la nota pasa a «borrador local», **el texto sigue visible**, y tras reload sigue ahí |
| 3 | Cambia el mes | el borrador se sincroniza sin duplicar; `opsUsed` arranca en 0 |
| 4 | Carga $5 a mitad de mes | el texto se sube; el conflicto se resuelve por el `etag` del manifest, no por «el último gana» |
| 5 | Segundo usuario abre el link y escribe | se debita la cuota/saldo **del dueño**; el invitado no ve muro |
| 6 | Cliente directo intenta escribir una nota | falla: `allow write: if false`. Solo el proxy escribe |

Sin el 6, la cuota es una sugerencia. Sin el 2 y el 3, se pierden datos.

---

## 9. Riesgos aceptados

- **Un servicio propio que mantener**: deploy, uptime, logs. Es el precio de facturar de verdad.
- **La ACL se implementa una vez en el proxy** (reusando `acl.ts`) y las rules pasan a ser
  defensa en profundidad: dos lugares que mantener coherentes.
- **Latencia extra** en el hot path: un WS al proxy en vez de directo a Firestore. Probablemente
  *menor* que los 417 ms medidos hoy, porque desaparece el round trip del listener.
- **El copy cambia de promesa**: «gratis para siempre» → «cuota gratuita + local para
  siempre». Mejor producto, peor marketing: hay que reescribir `UpgradeDialog.tsx` y el README.
- **El fee de $0,50 es un piso** para quien usa poco: hay que decidir si aplica a cuentas con
  actividad o a todas las que tengan saldo.
- **Dependencia del MoR** para el auto top-up (mandato de tarjeta): un MoR no siempre ofrece
  saldos arbitrarios; puede forzar packs o suscripción.

---

## 10. Lo que NO se hace

- **No** se implementa el corte en `firestore.rules` como primer paso (el orden que proponía
  `pricing.md` §7.5). El primer corte de esta app sería el primer servidor que dice «no»; sin
  borrador local es una feature de pérdida de datos.
- **No** se mide con una Cloud Function por escritura: cuesta 4× lo medido.
- **No** se migra el canal caliente a RTDB ahora: el bloqueo son las reglas, no el precio
  (`sync-algorithms.md` §11), y el proxy ya resuelve el costo.
- **No** se agrega metering al escritorio en modo local: ese es el modo `local-only`, y es
  gratis a propósito.
- **No** se vende storage como gancho: el muro no se toca con texto.

---

## 11. Decisiones abiertas

| # | Pregunta | Dueño | Estado |
|---|---|---|---|
| 1 | ¿Cloud Run (rápido) o Workers/DO (más barato por mensaje)? | técnico, reversible | **Cloud Run** (D12). |
| 2 | ¿100 MB o menos para el muro de storage? | producto | Adoptado 100 MB (D6). |
| 3 | ¿El fee de $0,50 aplica a toda cuenta con saldo o solo a la que tuvo actividad? | producto/financiero | Propuesto: **solo con actividad**; pendiente de confirmar. |
| 4 | ¿12 meses de dormancia es razonable antes de borrar? | legal/producto | Pendiente. |
| 5 | ¿Qué pasa con las cuentas que hoy tienen `entitlements.plan = 'paid'`? | producto | **No hay**: la app no está en producción (D13). |
| 6 | ¿El invitado de un link de **escritura** cuenta para el tope de 5 aunque no tenga cuenta? | producto | Pendiente. |
| 7 | ¿Se publica el tarifario por operación o se traduce a "horas de edición" para el usuario? | marketing | Pendiente. |

---

## 12. Deriva de documentación

Este documento **reemplaza**:

- `pricing.md` §4 (modelo comercial: flat $4/$12 + créditos) → tarifario único + fee + cuota.
- `pricing.md` §7 pasos 4-6 (orden: cuota antes que medición server-side) → el proxy es la
  medición, y va antes de cualquier cobro.
- `roadmap.md` §4 «Cuota y créditos» (free tier permanente 250 MB / 10k agentes) → cuota
  mensual 100 MB / 20k ops, unificada.
- `comercial-review.md` §2 tabla de márgenes con precio flat $4/$12 → tarifario por uso.

Lo que **sigue vigente** de `pricing.md`: §1 tarifas, §2 medición del costo por usuario, §3
discrepancias, §5.1 throttle, §5.2 rate limit. Y de `comercial-review.md`: §1 bloqueantes
(Stripe no opera en UY), §3 legal/impuestos.
