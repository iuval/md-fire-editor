# FireMD Sync (app de escritorio)

Sincronización de dos vías entre tu cuenta de FireMD y una carpeta local, para editar con
Obsidian (o cualquier editor) y seguir viendo los cambios en la web.

Rust + [Tauri 2](https://tauri.app): la app pesa ~7 MB y usa el WebView del sistema. El motor
de sync es el mismo que el del CLI (`agent/`): mismos permisos de Firestore, mismo
`.mdfire/manifest.json` y mismos archivos de conflicto, así que se puede usar la misma carpeta
con los dos.

## Qué hace

- **Carpeta base** elegible con el selector nativo. Ahí se escriben las notas como
  `carpeta/nota.md` y los tableros como `carpeta/tablero.canvas`.
- **Ciclo automático** cada 15 s (configurable 15 s / 1 min / 5 min): primero baja, después
  sube. También hay un botón "Sincronizar ahora".
- **Nunca pisa trabajo**: si el remoto cambió y el archivo local también, el push no
  sobreescribe; deja `<nota>.conflicto-AAAAMMDD-HHMM.md` con tu versión y sigue.
- **Bandeja del sistema**: cerrar la ventana no corta la sincronización. Para salir de verdad,
  menú del ícono → Salir.
- **Dos formas de identificarse**: con **tu cuenta del sitio** (login con Google) o con un
  **agente anónimo** (una cuenta aparte, para una carpeta puntual).

## Conectar con tu cuenta (recomendado)

1. Abrí la app → **Cuenta** → **Entrar con mi cuenta**.
2. Se abre el navegador en la página del sitio. Si no estás con la sesión de Google, entrá.
3. Tocá **Conectar la app**: la página le pasa la sesión a la app por un puerto local.
4. Volvé a la app: ya aparecen tus carpetas. Elegí la carpeta base y listo.

Google no permite su OAuth dentro de un webview embebido, así que el login se hace en el
navegador del sistema. La app abre un puerto en `127.0.0.1` con un código de un solo uso
(`state`), espera el handshake y lo cierra. Nada de contraseñas: se guarda el *refresh token*
que el sitio le entrega, en `~/.config/mdfire/credentials.json` (mismo archivo que usa
`mdfire login` del CLI, así que también sirve al revés). "Desconectar" lo revoca.

### Conectar como agente (carpeta compartida)

Si en cambio querés una cuenta aparte que sólo vea una carpeta:

1. **Cuenta** → **Conectar como agente (otra cuenta)** → "Generar código de agente". Muestra un
   uid.
2. En la app web: **Agentes de IA** → pegar el uid → asignarle una carpeta (lectura o
   escritura).
3. En la app: **Elegir carpeta…** y listo.

El agente no usa tu sesión: ve sólo la carpeta que le das y se revoca sacándolo de la carpeta
en la app web.

## Correr y compilar

Requiere Rust estable y Node 24 (el CLI de Tauri se usa con `npx`, no hace falta instalarlo).

```bash
cd desktop
npx --yes @tauri-apps/cli@2 dev     # desarrollo, con recarga
npx --yes @tauri-apps/cli@2 build   # instalables
```

Salidas de `build`:

| Sistema | Archivo |
| --- | --- |
| macOS | `target/release/bundle/macos/FireMD Sync.app` y `.../dmg/FireMD Sync_0.1.0_aarch64.dmg` |
| Windows | `target/release/bundle/msi/*.msi` y `.../nsis/*-setup.exe` |

Windows se compila **en Windows** (o con el workflow de CI). El `.dmg`/`.app` no está firmado:
al abrirlo por primera vez Gatekeeper avisa; firmar requiere cuenta Apple Developer (USD 99/año).

## Cómo funciona

Un ciclo = `pull` + `push`:

- **pull** lista las notas visibles para el agente y escribe `carpeta/título.md`. Si un archivo
  local tiene cambios sin subir (mtime o hash distintos a los del manifiesto), **no lo toca**.
- **push** recorre la carpeta: los archivos nuevos dentro de una carpeta se crean en la nube
  (el agente no puede crear notas sueltas en la raíz); los modificados se suben con el etag que
  tenían al bajarse, así una edición remota más nueva nunca se pisa.
- El manifiesto `.mdfire/manifest.json` guarda `{ id, etag, path, mtime, sha }` por archivo.
  El CLI ignora `sha`; la app lo usa para detectar cambios aunque el mtime no cambie.

Límites conocidos:

- Solo `.md` y `.canvas`. **No sincroniza adjuntos** (imágenes, PDFs): el modelo de datos
  todavía no los tiene.
- Borrar en un lado no borra en el otro: el pull no borra archivos locales y el push no borra
  notas remotas. Es a propósito, para no perder nada por accidente.
- Los tags denormalizados se recalculan al subir, igual que en el CLI (en minúsculas).
- El canvas se sube como JSON completo; no hay merge por nodo.

## Estructura

```
desktop/
  src/
    auth.rs        identidad anónima + refresh del ID token (comparte credenciales con el CLI)
    firestore.rs   cliente REST mínimo: codec de valores, queries, commit con precondición
    core del sync  vault.rs (carpeta + manifiesto), sync.rs (pull/push/cycle), backend.rs
    commands.rs    puente con la UI (Tauri commands)
    lib.rs         ventana, bandeja, arranque
  ui/              HTML/CSS/JS sin bundler
  tests            `cargo test` (unidad, sin red: el motor corre contra un backend en memoria)
```

```bash
cd desktop && cargo test
```

## CI (Windows)

`.github/workflows/desktop.yml` compila MSI/NSIS en `windows-latest` y `.app`/`.dmg` en
`macos-latest`, y sube los artefactos. Se dispara a mano (`workflow_dispatch`) o con un tag
`desktop-v*`. No lo corrí en CI todavía: es el camino previsto para tener el instalador de
Windows sin una máquina Windows.
