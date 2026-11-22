# Staging: la segunda red antes de producción

Los tests de emulador cubren lo que más se rompe (reglas, colaboración, sync) sin tocar un
proyecto real, pero hay una clase de fallo que **solo** aparece en un deploy de verdad:

- **App Check** en modo *enforced* (el emulador no lo aplica).
- El deploy real de reglas e índices, y el orden en que se aplican.
- Headers de hosting (CSP, HSTS, cache immutable), que son parte de `firebase.json`.
- El service worker/PWA, que en el emulador no se genera igual.
- Login con una cuenta Google real y las restricciones de la API key por dominio.
- El flujo de **revocación**: invitar, quitar el acceso y ver cuándo deja de verse.

Eso es lo que se prueba en staging. Los tests de reglas **no** se corren ahí: `@firebase/
rules-unit-testing` se apoya en el bypass `Authorization: Bearer owner` y en contextos con auth
fabricada, que solo existen en el emulador. Contra un proyecto real habría que emitir custom
tokens con el Admin SDK y ensuciar datos y cuotas para poder afirmar una denegación.

## Proyecto

`.firebaserc` tiene dos alias:

| alias | proyecto | para qué |
|---|---|---|
| `default` | `md-sync-app` | producción. `npm run deploy` sigue apuntando acá |
| `staging` | `firemd-staging` | ensayo. `npm run deploy:staging` |

Creación (una sola vez, en la consola de Firebase):

1. Crear el proyecto `firemd-staging` (el alias ya está en `.firebaserc`).
2. Authentication → habilitar **Google** y agregar los dominios de staging a los
   *Authorized domains*.
3. Agregar los dominios de staging a la restricción de la API key (si no, las llamadas fallan
   con `API_KEY_HTTP_REFERRER_BLOCKED`).
4. Si App Check está *enforced*: registrar un **debug token** para el navegador de pruebas
   (`FIREBASE_APPCHECK_DEBUG_TOKEN`) y guardarlo **en el gestor de secretos, nunca en el repo**.
5. Firestore: modo producción, ubicación acorde a producción (no se puede cambiar después).

## Antes de producción

```bash
npm run build                       # el build que se va a publicar
npm run deploy:staging              # reglas + índices + hosting, contra el alias staging
```

Si las reglas se aplican mal, el comando falla **antes** de que producción las vea: eso es todo
el valor del paso.

## Smoke de 5 minutos

1. Abrir la URL de staging e iniciar sesión con una cuenta Google real.
2. Crear una nota, escribir un par de párrafos, recargar: el contenido sobrevive.
3. En otro perfil de navegador (o ventana privada) entrar con una segunda cuenta, invitar como
   editora, y verificar: el cursor de la otra persona se mueve fluido y el texto aparece con
   latencia de red, no al terminar de tipear.
4. Desde el dueño, quitar el acceso y confirmar que la nota desaparece de la otra cuenta en
   segundos (esta es la parte que las reglas del emulador no pueden probar de punta a punta).
5. Revisar la respuesta HTTP: `/`, `/llms.txt` y los headers de `index.html` (`no-cache`) y de
   los assets (`immutable`).

Cuotas a tener en cuenta: en Spark son **20.000 escrituras/día**. Un smoke cuesta unos cientos;
no correr pruebas de carga contra staging.

## Después

```bash
npm run deploy                      # mismo contenido, contra default (producción)
```

Si algo del smoke falló, no se promueve: se corrige en staging y se repite. La regla es aburrida
a propósito — un deploy de Firebase no es atómico entre reglas, índices y hosting, y produccion
es el peor lugar para descubrirlo.

## Nota sobre el default

`npm run deploy` sigue apuntando a producción porque es lo que hace hoy el equipo. Si en algún
momento se quiere la regla inversa (que un comando suelto nunca pueda tocar producción), el
cambio es `"deploy": "... --project default"` y dejar el alias `default` solo como documentación.
