# FireMD para agentes de IA

Esta página es para vos, agente. Explica cómo instalar la CLI de FireMD, entrar con la
cuenta del usuario y leer o editar sus notas sin quemar contexto.

FireMD es un editor de notas markdown. Las notas viven en Firestore y las reglas de
seguridad se aplican igual que para una persona: **no hay claves de servicio ni bypass**.
La CLI habla con Firestore por REST usando el token del usuario que hizo login.

La salida de todos los comandos es **texto plano, nunca JSON**. Está pensada para leerse
tal cual: listados en TSV, una nota por línea, cuerpos markdown crudos.

---

## 1. Instalar

Requisitos: Node 20 o superior y git.

```bash
git clone https://github.com/iuval/md-fire-editor.git
cd md-fire-editor
npm ci
```

El ejecutable es `agent/cli.mjs`. Para no escribir la ruta completa, dejá un alias:

```bash
alias firemd="node $(pwd)/agent/cli.mjs"
```

Todos los ejemplos de esta página usan `firemd`. Si trabajás dentro del repo, el
equivalente es `npm run firemd -- <comando>`.

Verificá que responde:

```bash
firemd --help
```

---

## 2. Entrar (el primer paso siempre)

```bash
firemd login
```

Abre el navegador del sistema en el sitio del usuario. Ahí se autoriza con su cuenta de
Google y la sesión vuelve a la CLI. Al terminar imprime:

```
ok MacBook de Ana
ana@ejemplo.com
agente 3f9a1c2b
```

Esa sesión queda registrada como un **agente conectado** de la cuenta. El usuario la ve en
la app (menú de cuenta → Agentes conectados) y puede renombrarla ahí o con
`firemd name "otro nombre"`.

Las credenciales se guardan en `~/.config/firemd/credentials.json` con permisos 0600. El
token de acceso se renueva solo; no hace falta volver a entrar salvo que el usuario
desconecte la sesión.

### Si el navegador no está disponible

`firemd login` necesita un navegador. En una máquina sin entorno gráfico, el usuario puede
generar el token desde la app web y pasarlo por variable de entorno:

```bash
export FIREMD_ID_TOKEN="<token>"
```

Un token externo no se renueva: vence en una hora. Es la vía de último recurso, para tests
y CI.

### Modo agente anónimo (opcional)

Si el usuario no quiere dar acceso a su cuenta completa, puede crear una identidad aparte:

```bash
firemd login --agent
```

Imprime un uid y un código de vinculación. El usuario lo pega en la app, en
*Agentes conectados → Vincular agente anónimo*, elige una carpeta y un rol (Lectura o
Escritura). Desde ahí esa identidad sólo ve esa carpeta. Es el modelo anterior y sigue
funcionando, pero el login normal es más simple.

---

## 3. Comprobar quién sos

```bash
firemd whoami
```

```
ana@ejemplo.com
agente MacBook de Ana 3f9a1c2b
```

Si además querés ver todos los agentes conectados a la cuenta:

```bash
firemd agents
```

```
3f9a1c2b *	MacBook de Ana	cli	2026-02-11
9d2e4f01	iPad	desktop	2026-02-09
```

El asterisco marca la sesión actual. Cuatro columnas separadas por tab: id corto, nombre,
tipo y último uso.

`firemd name "Nombre nuevo"` renombra la sesión actual. El cambio se ve en la app.

---

## 4. Comandos

| Comando | Qué hace |
|---|---|
| `firemd login` | Entra con la cuenta del sitio (abre el navegador) |
| `firemd login --agent` | Crea una identidad anónima aparte |
| `firemd whoami` | Email y agente de la sesión actual |
| `firemd agents` | Agentes conectados a la cuenta |
| `firemd name "Nombre"` | Renombra esta sesión |
| `firemd logout` | Revoca el token y borra las credenciales |
| `firemd ls [--folder <f\|root>] [--limit n]` | Lista notas: `id`, título, fecha, carpeta |
| `firemd folders` | Lista carpetas: `id`, nombre |
| `firemd tags` | Etiquetas con su cantidad de notas |
| `firemd cat <id> [--max-bytes n] [--etag]` | Markdown crudo de una nota |
| `firemd find <texto> [--tag t] [--limit n]` | Busca y devuelve `id:línea: texto` |
| `firemd patch <id> [--etag e] [--find a --replace b]... [--all]` | Reemplaza texto |
| `firemd append <id> [--text t]` | Agrega al final (o por stdin) |
| `firemd new --folder f --title t [--body t]` | Crea una nota |
| `firemd rm <id>` | Elimina una nota |
| `firemd vault pull [--dir ruta] [--prune]` | Nube → archivos `.md` |
| `firemd vault push [--dir ruta]` | Archivos `.md` → nube |

Los ids son de 8 caracteres: alcanza con el prefijo único. Si el prefijo es ambiguo, el
comando falla con `E_AMBIGUOUS` y no toca nada.

### Ejemplos

```bash
firemd ls --limit 10
firemd find harina --limit 5
firemd cat 3f9a1c2b
firemd patch 3f9a1c2b --etag 3-a1b2c3d4e5f6 --find '- dos' --replace '- dos
- tres'
firemd append 3f9a1c2b --text '- sal'
firemd new --folder recetas --title "Pan de masa madre" --body "## Ingredientes"
```

---

## 5. Editar sin pisar el trabajo de nadie

`cat` devuelve el markdown y, con `--etag`, también el etag:

```bash
firemd cat 3f9a1c2b --etag
```

Pasalo en el `patch`:

```bash
firemd patch 3f9a1c2b --etag 3-a1b2c3d4e5f6 --find 'viejo' --replace 'nuevo'
```

El parche se rechaza si:

- el etag quedó viejo (`E_ETAG`, código 2) — alguien editó la nota mientras la leías;
- el texto buscado no existe (`E_NOT_FOUND`, código 3);
- el texto aparece más de una vez (`E_AMBIGUOUS`, código 4); usá `--all` si querés
  reemplazar todas las apariciones.

Cuando un `patch` falla por etag, **volvé a leer la nota** y reintentá con el etag nuevo. No
reintentes con el mismo.

---

## 6. Vault: las notas como archivos

```bash
firemd vault pull --dir ~/notas
firemd vault push --dir ~/notas
```

`pull` baja todas las notas visibles como archivos `.md` (respeta subcarpetas). `push` sube
los cambios locales y nunca pisa una nota que cambió en la nube: si hay conflicto, escribe
`<nota>.conflicto-AAAAMMDDhhmm.md` y te avisa. `--prune` borra los archivos locales que ya
no existen en la nube.

Es la vía más barata para trabajar con muchas notas: un `grep` local no cuesta una lectura
por nota.

---

## 7. Permisos

La sesión tiene exactamente los permisos del usuario que hizo login. Con el login normal
ves todas sus carpetas. Con `login --agent`, sólo las carpetas donde el dueño agregó esa
identidad como miembro.

Si un comando falla con `PERMISSION_DENIED`, no es un bug: la cuenta no tiene acceso a esa
nota. Decile al usuario que revise el rol en la app. No intentes sortearlo.

---

## 8. MCP (opcional)

Si el agente habla MCP, el repo trae un servidor con siete tools de texto:
`notes_list`, `notes_read`, `notes_patch`, `notes_append`, `notes_search`, `notes_create`,
`folders_list`.

```jsonc
// .mcp.json
{
  "mcpServers": {
    "firemd": {
      "command": "node",
      "args": ["/ruta/al/repo/agent/mcp.mjs"]
    }
  }
}
```

Comparte las credenciales con la CLI: si `firemd login` ya se corrió, el servidor arranca
autenticado.

---

## 9. Códigos de salida

| Código | Significado |
|---|---|
| 0 | Bien |
| 1 | Error inesperado |
| 2 | `E_ETAG`: el etag quedó viejo |
| 3 | `E_NOT_FOUND` o sin sesión |
| 4 | `E_AMBIGUOUS`: el prefijo o el texto coincide con varios |
| 64 | `E_USAGE`: argumentos mal |

---

## 10. Reglas de oro

1. **Entrá primero.** Sin `firemd login` todo lo demás falla con código 3.
2. **Leé antes de escribir.** `cat --etag` y después `patch --etag`.
3. **No inventes ids.** Salen de `ls`, `find` o `new`.
4. **Un `patch` por cambio semántico.** Varios `--find/--replace` en un comando es más
   barato que varias llamadas.
5. **No reintentes un etag viejo.** Releé.
6. **Si el usuario cambió el nombre del agente en la app, no hace falta nada:** el id no
   cambia y la sesión sigue válida.
