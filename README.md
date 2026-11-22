# FireMD Editor

Editor de Markdown colaborativo en tiempo real. Notas guardadas en Firestore, edición
simultánea con CRDT (Yjs), login con Google, PWA instalable y fallback offline.

- **Live:** https://firemd.app (heredado: https://md-sync-app.web.app)
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

## Roadmap

Las features pedidas y todavía no implementadas (tags, vault de Obsidian, sync local,
página de uso, auto top-up) están especificadas en [`docs/roadmap.md`](docs/roadmap.md), con
modelo de datos, cambios de reglas, riesgos y orden sugerido. La revisión del plan comercial
está en [`docs/comercial-review.md`](docs/comercial-review.md).

## Cómo funciona la colaboración

El diseño está justificado en [`docs/sync-algorithms.md`](docs/sync-algorithms.md): cómo
sincronizan rsync, CDC/FastCDC, Dropbox (bloques + blocklist + journal + cursor), Git y
Google Docs (OT con servidor central), y qué de todo eso aplica a un editor CRDT.

Firestore no trae un motor de colaboración, así que el documento se modela como un
**CRDT** y Firestore se usa solo como bitácora de updates:

```
folders/{folderId}                nombre + ACL de la carpeta
notes/{noteId}                    título, tags, ACL (propia o heredada) y tamaño del cuerpo
notes/{noteId}/body/main          el cuerpo en markdown (1 documento, misma ACL)
notes/{noteId}/updates/{id}       bloque: { v, jid, hash, bytes, data, clientId }
notes/{noteId}/collab/manifest    snapshot + state vector + jid más alto
notes/{noteId}/presence/{uid}     presencia + cursor (heartbeat 20 s, throttle 1,2 s)
userIndex/{sha256(email)}         directorio para agregar colaboradores
profiles/{uid}                    nombre visible de cada persona
```

Cada bloque lleva el **hash SHA-256** de su contenido y se verifica antes de aplicarlo; el
manifiesto separa metadatos de contenido, así que entrar a una nota es **1 lectura del
manifiesto + snapshot + una cola corta**, no replay de toda la bitácora. Los edits se emiten
con **throttle de 350 ms** (no debounce: el otro cliente ve el cambio aunque sigas tipeando) y
con **backpressure** de 2 escrituras en vuelo. La compactación dispara por cantidad de bloques,
por bytes o por inactividad, y poda **exactamente** los ids que entraron en el snapshot.

- Cada cliente tiene un `Y.Doc`. Los edits locales se agrupan (throttle 350 ms) en un
  **bloque** con hash y `jid` monotónico, y se agregan a `updates`.
- `onSnapshot` entrega los updates de los demás y se aplican al mismo `Y.Doc`.
  Yjs es idempotente y conmutativo, así que el orden de llegada no importa y
  re-aplicar no duplica texto.
- Cuando la bitácora pasa de 40 bloques o 160 KB (o queda inactiva 5 min), un cliente
  escribe el estado completo en `collab/manifest` y poda exactamente los ids incluidos.
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
cuerpo ≤ 600 KB en bytes (el cliente corta en 250.000 caracteres), `title` ≤ 300 caracteres,
`access` en enum, `ownerId` y `createdAt` inmutables, el dueño no puede degradarse a sí
mismo, `roles` y `memberIds` deben estar sincronizados, updates ≤ 400 KB, presencia ≤ 4/8 KB.

El cuerpo está separado de la nota a propósito: el listado del panel lateral es **una** query
en vivo sobre `notes` (todos los documentos que el usuario puede ver), así que un cuerpo
inline en esa colección se descargaba y se quedaba en memoria por cada nota del vault. Las
notas anteriores al cambio siguen funcionando (el cuerpo inline se lee como respaldo y se
migra solo la primera vez que la nota aparece).

Un editor nunca puede escalar privilegios: agregar miembros, cambiar el modo de
compartición, cambiar de dueño o reescribir `createdAt` está denegado por reglas
aunque el cliente lo intente a mano.

### Otras capas

- **API key restringida por referrer** a `firemd.app`, `www.firemd.app`,
  `md-sync-app.web.app`, `md-sync-app.firebaseapp.com` y `localhost`
  (5173/4173/5198/5199). Requests desde otro origen reciben 403.
- **Auth**: los dominios del sitio están en *Authentication → Settings → Authorized
  domains*. Un origen que no esté ahí falla con `auth/unauthorized-domain` aunque la API
  key lo permita.
- **Headers de seguridad** en Hosting: CSP (sin `unsafe-inline` en scripts, sin
  `object-src`, `frame-ancestors 'none'`), HSTS (`max-age=31536000; includeSubDomains;
  preload`), `X-Frame-Options: DENY`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` (necesario para el popup de Google).
- **Cache**: assets hasheados inmutables; `index.html`, `sw.js` y el manifest sin cache
  (evita servir bundles viejos).
- **App Check** listo sólo para la web: definí `VITE_APPCHECK_SITE_KEY` (reCAPTCHA v3) y
  después *enforce* en la consola de Firebase. Sin la variable, la app funciona igual. La
  site key de reCAPTCHA tiene que incluir **`firemd.app` y `www.firemd.app`**, si no las
  llamadas fallan en el dominio nuevo.

  **No pasar a *enforced* todavía:** la CLI (`agent/`) y la app de escritorio
  (`desktop/`) hablan con Identity Toolkit y Firestore por REST sin token de App Check
  (`grep -r AppCheck agent desktop` no devuelve nada). Enforcing en Identity Toolkit
  corta `firemd login` y el login del desktop; enforcing en Firestore corta todo
  `mdfire ls/cat/patch`. Para enforcear hay que darle a esos clientes un provider
  propio (token firmado por una Cloud Function) o dejarlos fuera.
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

## Agentes de IA

Hay una CLI y un servidor MCP para que un agente lea y edite gastando lo mínimo. Ambos
devuelven **texto, no JSON**.

La guía completa para agentes está publicada en **`/agent.md`** (con índice en
`/llms.txt`): instalación, login, comandos, permisos y códigos de salida. Es la referencia
que conviene darle a un agente.

```bash
npm run firemd -- login       # entra con tu cuenta (abre el navegador)
npm run firemd -- whoami      # email, agente y uid
npm run firemd -- agents      # sesiones conectadas a la cuenta
npm run firemd -- name "Notebook de Ana"
npm run firemd -- ls          # id	título	fecha	carpeta
npm run firemd -- cat 3f9a1c2b --etag
npm run firemd -- find harina
npm run firemd -- patch 3f9a1c2b --etag 3-a1b2c3d4e5f6 --find '- dos' --replace '- dos
- tres'
npm run firemd -- append 3f9a1c2b --text '- sal'
```

**Cómo entra:**

`firemd login` abre el navegador en el sitio; el usuario autoriza con Google y la sesión
vuelve a la CLI por loopback. La CLI queda actuando **como la persona**, con sus permisos:
no hay nada que pegar ni vincular. El refresh token se guarda en
`~/.config/firemd/credentials.json` (0600) y se renueva solo.

Cada sesión se registra en `agents/{id}` y aparece en la app (menú de cuenta → **Agentes
conectados**), donde se le puede poner nombre — o desde la terminal con `firemd name`.
Ese registro es sólo la lista de "quién está conectado": no concede permisos.

`firemd login --agent` sigue disponible para el modelo anterior: crea una cuenta anónima
aparte que sólo ve la carpeta donde el dueño la agregue como miembro (rol **Lectura** o
**Escritura**). Quitarle el acceso es quitarla de *Compartir*: el corte es inmediato porque
la autoridad es el documento de la carpeta, no la copia en cada nota.

### Por qué es barato

| Operación | Salida | Costo |
|---|---|---|
| `ls` (20 notas) | una línea por nota, 4 campos | ~10 tok/nota |
| `cat` | solo el markdown | = documento |
| `patch` | `ok 1 edits +7 4-9f2c1a` | ~12 tok |
| `find` | `id:línea: texto` | ~15 tok/hit |

Medido con los fixtures de `tests/agent.test.ts`: las mismas dos notas como JSON completo
son ~201 tokens; el listado TSV son ~20. `cat` devuelve un **etag**, así que el agente
edita sin releer: el parche se rechaza si el etag quedó viejo (`E_ETAG`), si el `find` no
existe, o si aparece más de una vez (`E_AMBIGUOUS`). Además del etag, el servidor manda el
`updateTime` leído como precondición del `commit`, así que una carrera falla en Firestore y
no pisa el trabajo de otra persona.

### Conectarlo como MCP

```jsonc
// .mcp.json de tu agente
{
  "mcpServers": {
    "firemd": {
      "command": "node",
      "args": ["/ruta/al/repo/agent/mcp.mjs"]
    }
  }
}
```

Siete tools (`notes_list`, `notes_read`, `notes_patch`, `notes_append`, `notes_search`,
`notes_create`, `folders_list`), esquemas de una línea y resultados de texto.

### Autenticación en detalle

- `firemd login` hace el handshake por loopback (servidor en `127.0.0.1`, nonce de un
  solo uso, plazo de 2 min) y valida el refresh token contra `securetoken.googleapis.com`
  antes de guardarlo. `firemd login --agent` hace en cambio `accounts:signUp` anónimo. Los
  ID tokens se renuevan contra `securetoken.googleapis.com`.
- Como la API key está restringida por referrer, las llamadas mandan
  `Referer: https://md-sync-app.web.app/` (configurable con `FIREMD_REFERER`).
- Firestore se consume por **REST con el ID token de la sesión**, no con Admin SDK: si la
  cuenta no tiene permiso, Firestore devuelve `PERMISSION_DENIED` y la CLI lo explica.
- Para tests: `FIREMD_ID_TOKEN` inyecta un token externo.

### Escrituras concurrentes

El editor sigue siendo la fuente de verdad del CRDT. Cuando el documento cambia por fuera
(agente, otra app), el editor detecta el markdown distinto al que él emitió y lo aplica al
documento Yjs (`tests/editor.test.tsx`). Si alguien está tipeando en ese momento, la
precondición del `commit` hace fallar al agente en vez de pisar el cambio.

## Tests

```bash
npm test             # 19 tests: convergencia CRDT, ACL/carpetas, editor en jsdom
npm run test:rules   # 63 tests de firestore.rules contra el emulador
npm run test:collab  # 7 tests de colaboración real (2 clientes, presencia, viewer)
npm run test:agent   # 17 tests de la CLI/MCP con reglas aplicadas (auth anónima real)
npm run test:all     # todo (requiere Java para el emulador)
```

Los tests de colaboración levantan el emulador de Firestore, conectan dos clientes Yjs
reales y verifican que convergen, que un cliente tardío se hidrata desde la bitácora y
que un extraño no puede leer ni escribir. `tests/editor.test.tsx` monta el editor en
jsdom para detectar roturas de wiring (extensiones, presence, modo solo lectura).

## Operación (producción)

Todo esto vive en el proyecto `md-sync-app` del plan **Blaze**.

| Pieza | Qué hace | Dónde se ve |
|---|---|---|
| Uptime check `firemd.app` | `GET /` cada 5 min desde 4 regiones, SSL validado | *Monitoring → Uptime checks* |
| Alert policy «firemd.app caído» | avisa cuando el check falla 10 min seguidos desde ≥2 regiones; auto-cierra a los 30 min | *Monitoring → Alerting* |
| Canal de email | manda los avisos a la cuenta del dueño | *Monitoring → Notification channels* |
| Presupuesto «guardrail mensual» | USD 50/mes, avisa al 50 %, 90 %, 100 % del gasto real y al 100 % proyectado | *Billing → Budgets & alerts* |
| Firestore PITR | restauración a cualquier minuto de los últimos 7 días | *Firestore → Backups* |
| Backup diario | snapshot automático, retención 7 días | *Firestore → Backups* |
| Delete protection | la base no se puede borrar sin desactivarla antes | *Firestore → Database* |

El presupuesto avisa, no corta el gasto: Blaze no tiene tope. Si querés un tope duro,
hay que apagar el proyecto a mano o pasar a presupuesto con corte por Cloud Billing.

Además, `.github/workflows/uptime.yml` corre `scripts/check-site.mjs` cada hora y falla
si el sitio no responde, si el certificado no cubre el host, si le quedan menos de 21
días o si desaparecen los headers (CSP, HSTS, `X-Frame-Options`) o el canonical. Ese
es el que detecta un renewal fallido; el uptime check de Google sólo ve si responde.

## Dominio

Un solo sitio de Hosting (`md-sync-app`) con dos dominios personalizados: el apex
`firemd.app` y `www.firemd.app`. Los dos sirven la misma app; el **canónico es el apex**
(`https://firemd.app`), declarado en `index.html` con `rel=canonical` y `og:url`. Firebase
Hosting no redirige entre dominios personalizados, así que el canónico se declara en el
HTML y no con un 301.

### DNS en GoDaddy (nameservers `domaincontrol.com`)

| Tipo | Nombre | Valor | Para qué |
|---|---|---|---|
| `A` | `@` | `199.36.158.100` | apex al edge de Hosting |
| `TXT` | `@` | `hosting-site=md-sync-app` | verificación de propiedad del sitio |
| `CNAME` | `www` | `md-sync-app.web.app` | `www` al sitio |
| `TXT` | `_acme-challenge` | token vigente del pedido | emisión del certificado del apex |
| `TXT` | `_acme-challenge.www` | token vigente del pedido | emisión del certificado de `www` |

Los `A` de parking de GoDaddy (`15.197.148.33`, `3.33.130.190`) y el *Domain Forwarding*
tienen que estar borrados: mientras existan, el apex no llega a Hosting.

**Por qué hace falta el `_acme-challenge`:** el certificado del apex se valida por HTTP-01,
pero Hosting responde `301 → https` en `/.well-known/acme-challenge/…` y ese salto todavía
no tiene un certificado válido, así que la validación por HTTP no puede completarse.
Firebase cae a DNS-01 y publica un `TXT` por nombre. Los tokens cambian en cada pedido: si
el dominio queda en `CERT_VALIDATING`, leé los valores vigentes en *Firebase Console →
Hosting → el dominio → Avanzado* y actualizá el `TXT`.

Estado esperado cuando está todo bien: la API de Hosting devuelve `hostState: HOST_ACTIVE`,
`ownershipState: OWNERSHIP_ACTIVE` y `cert.state: CERT_VALID`. El primer certificado es
temporal (`TEMPORARY`); el definitivo (agrupado, vía Google Trust Services) se emite solo.

### Correo

El dominio **no recibe ni manda mail**: no hay registros `MX`. La postura es la del
dominio que no manda correo, y es deliberada:

| Registro | Valor | Efecto |
|---|---|---|
| `TXT @` | `v=spf1 -all` | ningún servidor está autorizado a mandar por el dominio |
| `TXT _dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` | lo que no alinee exacto se rechaza, también en subdominios |
| `MX` | — | no hay buzón al que escribir |

Resultado: un `From: …@firemd.app` falsificado se rechaza en el receptor. Si algún día el
producto manda correo real (soporte, novedades, un proveedor transaccional), hay que
agregar su `SPF`/`DKIM` **antes** del primer envío y aflojar el DMARC a `p=quarantine`
mientras se calienta la reputación, o esos envíos se rechazan.

### Credenciales de DNS

La API de GoDaddy vive en `~/.config/firemd/godaddy.env` (0600: `GODADDY_KEY`,
`GODADDY_SECRET`) y se usa con `lexicon godaddy …` o `curl -H "Authorization: sso-key
$GODADDY_KEY:$GODADDY_SECRET"`. Nada de eso va al repo.

### Al agregar otro dominio

Tres lugares además del DNS, o el login falla en el origen nuevo:

1. *Authentication → Settings → Authorized domains* (`firemd.app`, `www.firemd.app`).
2. Browser API key → *HTTP referrers* (`https://firemd.app/*`, `https://www.firemd.app/*`).
3. Si hay App Check: los dominios de la site key de reCAPTCHA v3.

## Local

```bash
npm install
cp .env.example .env    # completar con la config del proyecto Firebase
npm run dev
```

Dos cosas rompen el login en desarrollo:

- **La API key está restringida por referrer.** Los puertos autorizados son `localhost:5173`,
  `4173`, `5198` y `5199` (con y sin `127.0.0.1`). Si corrés el dev server en otro puerto,
  agregalo en *Google Cloud → APIs & Services → Credentials → Browser key → HTTP referrers*;
  si no, vas a ver `auth/requests-from-referer-http://localhost:PORT/-are-blocked`.
- **Google rechaza el login dentro de navegadores embebidos** (Electron, vistas previas de
  IDE, webviews). El síntoma es *"Ce navigateur ou cette application ne sont peut-être pas
  sécurisés"*. Abrí la app en Chrome o Safari: la pantalla de login lo detecta y lo explica.

```bash
npm run build
firebase deploy --only firestore:rules,firestore:indexes,hosting
```

> La query del sidebar (`memberIds array-contains` + `orderBy updatedAt`) necesita el
> índice compuesto de `firestore.indexes.json`. El emulador no lo exige; producción sí.

`.firebaserc` fija el proyecto (`md-sync-app`), así que el deploy no depende de cuál esté
activo en la CLI.

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
agent/                            CLI + servidor MCP para agentes de IA
tests/                            reglas + colaboración + editor + agente
```

## UI

Estética deliberadamente sobria, al estilo Obsidian: un sidebar de archivos, una franja de
36 px con el título del documento y el estado, y el documento a pantalla completa con
título editable en línea. Sin botones grandes ni tarjetas: el estado de sync es un punto
de color (verde/ámbar/rojo) y el único acento es el violeta de la nota activa. El panel
lateral se colapsa y se recuerda en `localStorage`; en mobile entra como drawer.

## Marca

El ícono es una llama de contorno continuo con una nota encima: un solo trazo para la
llama, el "flick" interior y la tarjeta con las líneas de renglones. Vive en
`scripts/icons/mark.mjs` como geometría (viewBox 512) y de ahí salen todos los assets:

```bash
npm run icons   # regenera public/*.svg, *.png, favicon.ico y og-image.png (macOS)
```

| archivo | para qué |
| --- | --- |
| `public/mark.svg` | la marca sola, sin fondo, para docs y README |
| `public/favicon.svg` | pestaña: cuadrado redondeado oscuro, trazo más grueso y dos renglones para que se lea a 16 px |
| `public/favicon.ico` | 16/32/48, esquinas rectas (sin transparencia) para navegadores viejos |
| `public/icon.svg` · `icon-192.png` · `icon-512.png` | PWA `any`: esquinas transparentes, 3 renglones |
| `public/icon-maskable-512.png` | PWA `maskable`: sangra al borde y la marca entra en el círculo seguro del 80% |
| `public/apple-touch-icon.png` | 180 px opaco; iOS aplica su propia máscara |
| `public/og-image.png` | 1200×630 para `og:image` / `twitter:image` |

Los colores salen de la paleta de `src/index.css`: `#8b7cf8` (`--color-accent-dark`) sobre
`#1e1e1e` (`--color-bg-dark`). El build es de escritorio (usa `qlmanage` y `magick`), por eso
los archivos quedan versionados: ni el build de la app ni los tests lo necesitan.

## Licencia

MIT
