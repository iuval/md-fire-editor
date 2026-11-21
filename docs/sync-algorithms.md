# Cómo sincronizan archivos los sistemas serios (y qué aplica a FireMD)

Investigación de los algoritmos de sincronización por bloques, con las fuentes al final.
El objetivo es decidir qué copiar para FireMD y qué descartar.

## 1. Son dos problemas distintos

| Problema | Pregunta | Algoritmos |
|---|---|---|
| **Replicar un archivo** | ¿cuántos bytes tengo que mover? | rsync, CDC, Dropbox, Git |
| **Editar texto entre varios** | ¿cómo combino cambios concurrentes? | OT, CRDT (Yjs, Automerge) |

Los primeros asumen **un escritor por vez** y optimizan bytes. Los segundos asumen **varios
escritores simultáneos** y optimizan convergencia. FireMD necesita los dos: un CRDT para el
texto y una capa de bloques para moverlo y guardarlo barato.

## 2. rsync (Tridgell & Mackerras, 1996)

El archivo destino se parte en bloques de tamaño fijo `S`. Por cada bloque se calculan dos
checksums: uno **débil** (tipo Adler-32, 32 bits) y uno **fuerte**. El receptor manda su
lista de checksums y el emisor **rueda** el checksum débil byte a byte por el archivo
origen: calcular el checksum de `X[2..n+1]` a partir del de `X[1..n]` es O(1) por
corrimiento, así que sólo cuesta O(bytes) recorrer el archivo. Cuando el débil coincide se
verifica el fuerte. La búsqueda usa una tabla hash de 16 bits sobre el checksum débil y una
lista ordenada para el segundo nivel.

**La lección y el límite:** el delta es baratísimo de calcular, pero **los cortes son
posicionales**. Si insertás un byte al principio, todos los bloques se corren y el rsync
ingenuo transfiere casi todo. Perfecto para sincronizar una vez; malo para contenido que se
edita en el medio.

## 3. Content-Defined Chunking (CDC)

LBFS (Muthitacharoen, Chen & Mazières, SOSP 2001) propone lo contrario: **el corte depende
del contenido**. Se pasa una ventana deslizante y se corta cuando el hash de la ventana
cumple una condición (por ejemplo, los últimos *n* bits en cero). Un `insert` sólo altera
los bloques de su vecindario; el resto se realinea solo. LBFS usaba fingerprint de Rabin con
chunks de ~8 KB y SHA-1 para identificar contenido.

**FastCDC** (Xia et al., USENIX ATC 2016) es la versión rápida: usa *gear hash* en lugar de
Rabin, **salta** los cortes por debajo del mínimo y **normaliza** la distribución de
tamaños. Resultado del paper: ~10× más rápido que la mejor implementación abierta de Rabin y
~3× más rápido que Gear/AE previos, con una tasa de deduplicación casi igual.

Hoy es el estándar de facto en backup y almacenamiento: restic/borg (buzhash), ZFS, Casync,
Backblaze. En borg, además, **el id de cada chunk deriva criptográficamente de su
contenido**, así que deduplicar e integrar son la misma operación.

## 4. Dropbox: bloques de 4 MB + journal + cursor

El diseño clásico (blog de ingeniería, "Streaming File Synchronization", 2013) es el más
citado y el más fácil de copiar:

- Cada archivo se parte en **bloques de 4 MB** (el último puede ser menor), hasheados con
  **SHA-256**.
- El archivo se identifica por su **blocklist**: la lista de hashes (`h1,h2,h3,h4`), no por
  sus bytes.
- Hay dos servidores: uno de **bloques** (key-value `hash → contenido cifrado`, no sabe de
  usuarios ni rutas) y uno de **metadatos** con el *Server File Journal* (SFJ): registro
  **append-only** de versiones, con `NamespaceId`, ruta, blocklist y un **Journal ID
  monotónicamente creciente**.
- Cada cliente guarda un **cursor (JID)** por namespace: eso es "qué tan al día estoy".
- El commit es un **handshake de necesidad**: el cliente manda la blocklist, el servidor
  responde *"need blocks"* con los hashes faltantes (si el contenido ya existe en el
  servicio, no se transfiere nada), el cliente sube sólo esos bloques y reintenta el commit.
- **Streaming sync**: los bloques se van transfiriendo a los demás clientes **antes** de que
  el commit se confirme; el post documenta hasta **2× menos latencia**.

Cuatro ideas que valen para cualquier sistema:

1. **Content addressing**: el hash es el nombre. Dedupe, verificación e idempotencia gratis.
2. **Manifest** separado del contenido (blocklist / árbol / snapshot).
3. **Cursor monotónico** para que "ponerse al día" sea un rango, no una comparación de todo.
4. **Handshake de faltantes** antes de transferir.

## 5. Git: objetos direccionados por contenido + deltas en packfiles

Git guarda cada objeto con el hash de su contenido (SHA-1/SHA-256) y lo referencia desde
árboles, que a su vez se referencian desde commits. Para no pagar un objeto por byte, los
`git gc` empaquetan en **packfiles** aplicando **delta compression** contra objetos
similares. Ventaja sobre Dropbox: la indirección por árbol permite compartir subárboles
enteros; el costo es que necesita compactación y `fsck`.

## 6. Texto concurrente: OT y CRDT

Nada de lo anterior resuelve dos personas tipeando en el mismo párrafo. Para eso:

- **OT** (operational transform): cada edición es una operación posicional que se
  transforma contra las concurrentes. Requiere servidor central que ordene (Google Docs).
- **CRDT**: los cambios son datos conmutativos. **Yjs** usa YATA; **Automerge** un formato
  de columnas. No necesitan árbitro: aplicás el update que llegue y el documento converge.
- **Editores por bloques**: BlockSuite/AFFiNE modelan el documento como árbol de bloques y
  pueden usar un subdocumento Yjs por bloque (carga perezosa de documentos enormes). El
  costo: mover/borrar bloques entre subdocumentos rompe la atomicidad de la transacción.
- **Figma** (para comparar): mapa de propiedades con last-write-wins por campo y orden del
  servidor; simple y rápido, pero no preserva ediciones concurrentes dentro de un mismo
  campo.

**Por qué rsync no sirve para el texto:** un delta posicional no dice *cuándo* se hizo ni
contra qué versión; con dos escritores el resultado depende del orden de llegada. Un update
de Yjs, en cambio, lleva su reloj lógico (state vector) y es idempotente y conmutativo.

## 6bis. Cómo lo hace Google Docs

Docs **no usa un CRDT**: usa **operational transformation con un servidor central**, y su
linaje está documentado por Google.

**El protocolo base es Jupiter** (Nichols et al., 1995) y Google lo dice explícitamente:
*"Like the Jupiter system described by the paper, Google Wave also implements a client and
server based OT system"* (whitepaper de OT de Google Wave, hoy en Apache). Docs y Wave
comparten ese mismo enfoque cliente/servidor.

**Los roles** (whitepaper de Wave):

- El cliente aplica la edición **localmente al instante** (*"Optimistic UI means user actions
  are executed and displayed locally to the user immediately without waiting for the server
  to respond"*).
- El servidor guarda **una sola historia** de operaciones. Cuando llega una operación de un
  cliente, la **transforma contra esa historia**, la aplica y la difunde al resto.
- Wave modificó el OT clásico para que el cliente **espere el ack** antes de mandar más
  operaciones; mientras espera, las **acumula y las manda en bloque**. Con eso el servidor
  necesita **un único state space** en lugar de uno por cliente (el OT clásico obliga al
  servidor a convertir operaciones entre estados, con costo de memoria y complejidad).
- El costo de esa simplificación está asumido en el paper: *"a client will see chunks of
  operations from another client in intervals of approximately one round trip time"*.

**Operaciones compuestas.** La infraestructura de colaboración de Google (la Realtime API,
retirada en 2019, que se presentaba como *"Google Docs–style collaboration"*) documenta:

- *"conflicts and changes from different collaborators are automatically resolved using a
  process called operational transformation"*;
- una **compound operation** agrupa ediciones para que se entreguen juntas, *"with no other
  users' changes in between"*;
- aclaración importante: **no son atómicas** y, por la resolución de conflictos, *"it is
  possible that some edits in a compound operation are never delivered"*.

**Posiciones.** El modelo de Docs es un texto con atributos por rango y las posiciones son
índices: si otro usuario inserta antes, tu índice deja de apuntar a lo mismo. Docs resuelve
eso con **index references** (referencias que el motor ajusta cuando el texto cambia). Yjs
resuelve el mismo problema con **relative positions** — es exactamente lo que ya usamos para
los cursores remotos.

**Offline.** Con OT hace falta un árbitro: al reconectar hay que **rebasar** la cola local
contra la historia del servidor. Por eso el offline de Docs es más limitado que el de un
CRDT, que converge sin orden.

### Google Docs vs. nuestro enfoque

| | Google Docs (OT) | FireMD (CRDT) |
|---|---|---|
| Quién ordena | servidor central (secuenciador) | nadie: conmutativo |
| Latencia percibida | local instantáneo + difusión ~1 RTT | local instantáneo + listener de Firestore |
| Offline | cola local + rebase (limitado) | converge sin servidor |
| Metadatos | historia de operaciones en el servidor | updates + tombstones en el cliente (necesita compactación) |
| Costo servidor | estado e historia centralizados | ninguno; Firestore sólo guarda bloques |
| Conflictos raros | requiere la función `transform` correcta | resueltos por diseño |

### Qué copiar de Docs y qué no

**Copiar:**

1. **Operaciones compuestas** → un bloque debe representar una *intención* (por ejemplo,
   título + contenido en el mismo flush), no una tecla.
2. **Backpressure con acks** → límite de bloques en vuelo por cliente (2–3); si no hay ack,
   se acumula localmente en vez de inundar la bitácora. Es el equivalente a
   "esperar el ack antes de mandar más".
3. **Una sola historia con cursor** → la bitácora de `updates` con un `jid` monotónico, que es
   lo que le permite a Docs saber "qué le falta" a cada cliente.
4. **Index references** → ya tenemos el equivalente (relative positions de Yjs).

**No copiar:**

- **El secuenciador central.** Firestore no puede ordenar operaciones de clientes con
  latencia baja, y montar ese rol implica un servidor (Cloud Functions/Run, plan Blaze). El
  motivo por el que elegimos CRDT es precisamente no tener árbitro y soportar offline real.
- **El "chunking" por RTT.** Nuestro problema medido no es el orden sino el **debounce**:
  emitir por throttle (200–300 ms) da latencia acotada sin necesitar acks.

## 7. Tabla comparativa

| | granularidad | ¿sufre corrimientos? | dedupe | concurrencia | latencia |
|---|---|---|---|---|---|
| rsync | bloque fijo `S` | **sí** | por hash de bloque | no | una pasada |
| CDC (Rabin/FastCDC) | bloque según contenido | no | por hash de chunk | no | una pasada |
| Dropbox | 4 MB + blocklist + JID | no (bloques propios) | **sí, global** | última versión gana | streaming, ~2× mejor |
| Git | objeto + packfile delta | no | **sí** (objetos) | merge de 3 vías | batch (gc) |
| Yjs | update binario (CRDT) | no aplica | sí (idempotente) | **sí** | ~RTT |
| OT | operación | no aplica | no | sí (servidor) | ~RTT |

## 8. Qué hace FireMD hoy

`notes/{id}/updates` guarda **un documento por flush** con un update binario de Yjs en
base64; `collab/state` guarda un snapshot cuando la bitácora pasa de 120 docs. La identidad
la dan las reglas (ACL de nota/carpeta), no el contenido.

**Medición real** (`npm run bench:sync`, dos clientes contra el emulador, 200 ediciones en
8,4 s de tipeo continuo):

```
blocksWritten: 1        ← todo el tipeo se fusionó en un solo bloque
converged: true         ← converge… recién al pausar
coldJoinReads: 1 + n    ← un join lee el snapshot + toda la bitácora restante
```

Dos conclusiones:

1. El **debounce puro es eficiente en escrituras pero malo en latencia**: el otro cliente no
   ve nada hasta que el primero deja de tipear. Para colaboración hay que ir a
   **throttle con trailing** (emitir cada ~200–300 ms aunque no haya pausa).
2. El **costo de entrar** crece con la bitácora: sin cursor ni manifiesto, un cliente nuevo
   lee todo lo que quedó sin compactar.

## 9. Propuesta para FireMD (sin infraestructura nueva)

| Idea de la investigación | Cómo se aplica acá |
|---|---|
| **Manifest + cursor monotónico** (Dropbox) | `collab/manifest` con `{ snapshot, stateVector, jid, bytes }`; cada bloque lleva un `jid` creciente (por cliente + `max+1`). Al abrir: 1 lectura del manifest + sólo los bloques con `jid > manifest.jid`. |
| **Content addressing** (Dropbox/Git/borg) | El `id` del bloque incluye un hash truncado del payload; el cliente verifica al aplicar y descarta lo corrupto. Dedupe natural de reenvíos. |
| **Handshake de faltantes** (Dropbox) | El manifest publica el `stateVector` del snapshot; un cliente que ya tiene ese estado se ahorra el snapshot y pide sólo la cola. |
| **Tamaño de bloque acotado** | Cada bloque se corta en ≤ 64 KiB de base64 (muy por debajo del 1 MiB del documento de Firestore), así un pegado enorme no crea documentos gigantes ni bloquea el commit. |
| **Snapshots con CDC para adjuntos** | El texto Yjs **no** se puede re-chunkear por contenido (no es un stream posicional). CDC sí aplica si algún día se guardan imágenes/adjuntos o exports grandes: dedupe global por hash de chunk. |
| **Streaming** (Dropbox) | Nuestro equivalente es emitir el bloque **antes** de escribir el markdown/`updatedAt` en la nota, y no esperar el ack para seguir tipeando. |
| **Presencia barata** | El awareness hoy escribe cada 200 ms por cursor. Throttle a 1,5 s + dedupe por hash + pausa con la pestaña oculta baja el orden de magnitud de las escrituras. |

### Por qué no CDC literal para el documento

Los updates de Yjs son **causales**: un bloque sólo tiene sentido aplicado sobre su
prefijo. Re-chunkear por contenido un update ya codificado no ahorra nada (Yjs ya lo
comprime) y rompería la causalidad. CDC se reserva para *snapshots binarios* completos y
adjuntos, donde el corte es posicional sobre bytes y el dedupe entre versiones sí rinde.

## 10. Implementación y resultados medidos

Se implementó el v2 con las piezas de la §9: bloques con envoltorio verificado, manifiesto con
snapshot y `jid`, throttle con trailing, backpressure y presence barata. Medición con
`npm run bench:sync` (dos clientes reales contra el emulador, 200 ediciones en 8,4 s de tipeo
continuo):

| | v1 (debounce + snapshot suelto) | v2 (bloques + manifiesto) |
|---|---|---|
| primer edit visible en el otro cliente | **nunca hasta la pausa** | **417 ms** |
| bloques escritos por 8,4 s de tipeo | 1 (todo fusionado) | 23 (~112 B c/u, 2,5 KB total) |
| costo de entrar (lecturas) | 1 + toda la bitácora (hasta ~121 en el peor caso del umbral de 120) | **5** (manifiesto + snapshot + 3 bloques) |
| tiempo de entrar | — | **52 ms** |
| integridad | sin verificación | hash SHA-256 por bloque, verificado antes de aplicar |
| compactación | por cantidad de updates | por bloques **o** bytes **o** inactividad |

El costo de tipeo subió de ~0 a ~2,7 escrituras/s (throttle 350 ms) a cambio de que la
colaboración **exista**; el costo de entrar bajó de proporcional-a-la-bitácora a constante.
Presence pasó de escribir cada 200 ms por cursor a 1,2 s con dedupe y pausa con la pestaña
oculta.

## 11. Límites que condicionan el diseño

- **Firestore**: documento ≤ 1 MiB (campo ≤ 1.048.487 bytes); colección con claves
  secuenciales ≤ **500 escrituras/s**; plan gratuito **20.000 escrituras/día** y
  **50.000 lecturas/día**.
- **Realtime Database**: plan gratuito **100 conexiones simultáneas**; el límite blando es
  ~**1.000 escrituras/s**; escritura por operación ≤ 16 MB desde SDK.
- Para un editor de notas, RTDB es la capa natural para el canal caliente (bloques chicos,
  alta frecuencia, sin costo por escritura) y Firestore para el documento durable (ACL,
  manifiesto, snapshots). Migrar la bitácora a RTDB es el próximo salto si el volumen crece:
  con Firestore, tipear 30 min seguidos son ~7.000 escrituras, la mitad del plan diario.

## Referencias

- A. Tridgell, P. Mackerras. *The rsync algorithm*, 1996 — checksum rodante:
  <https://rsync.samba.org/tech_report/node3.html> · búsqueda por checksums:
  <https://rsync.samba.org/tech_report/node4.html>
- A. Muthitacharoen, B. Chen, D. Mazières. *A Low-bandwidth Network File System* (LBFS),
  SOSP 2001 — origen del content-defined chunking.
- W. Xia et al. *FastCDC: a Fast and Efficient Content-Defined Chunking Approach for Data
  Deduplication*, USENIX ATC 2016 —
  <https://www.usenix.org/conference/atc16/technical-sessions/presentation/xia>
- Dropbox Engineering. *Streaming File Synchronization*, 2013 — bloques de 4 MB, blocklist,
  journal, cursor JID, handshake "need blocks", streaming ~2×:
  <https://dropbox.tech/infrastructure/streaming-file-synchronization>
- Dropbox Engineering. *Rewriting the heart of our sync engine*, 2016.
- Git. *Git Internals — Packfiles*: <https://git-scm.com/book/en/v2/Git-Internals-Packfiles>
- BorgBackup. *Internals — data structures* (chunks direccionados por contenido):
  <https://borgbackup.readthedocs.io/en/stable/internals/data-structures.html>
- Google Wave / Apache Wave. *Operational Transformation* (whitepaper) — OT cliente/servidor,
  Jupiter, optimistic UI, acks, trade-off de ~1 RTT:
  <https://svn.apache.org/repos/asf/incubator/wave/whitepapers/operational-transform/operational-transform.html>
- Google Drive Realtime API. *Conflict resolution* (documentación retirada, archivada) — OT,
  compound operations, no atomicidad y ediciones que pueden no entregarse:
  <https://web.archive.org/web/20150908214349/https://developers.google.com/google-apps/realtime/conflict-resolution>
- D. Nichols, P. Curtis, M. Dixon, J. Lamping. *High-Latency, Low-Bandwidth Windowing in the
  Jupiter Collaboration System*, UIST 1995 (citado por el whitepaper de Wave).
- Yjs. *Document Updates* — state vector y `encodeStateAsUpdate(doc, vector)`:
  <https://docs.yjs.dev/api/document-updates>
- Firebase. *Cloud Firestore quotas* y *Realtime Database limits*.
