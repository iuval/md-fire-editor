# Design directions — get out of Obsidian's shadow

Objetivo: que FireMD no se lea como "Obsidian en la nube". El look actual (sidebar oscuro con
etiquetas arriba, árbol de carpetas con chevrons, tarjetas de nota con preview, acento violeta)
es exactamente el default de Obsidian.

## Restricciones de partida (anti-Obsidian)

1. Nada de ribbon lateral de iconos ni barra de iconos verticales.
2. Nada de árbol de archivos con chevrons `›` + carpeta + nota indentada.
3. Nada de "vault" como metáfora visual dominante en el chrome (el vault es un formato de
   import/export, no la identidad del producto).
4. Nada de violeta #6f5ce0 como acento de marca.
5. La diferencia real del producto no es el editor: es **colaboración en vivo** y **uso medido
   prepago**. El diseño tiene que hacer visible eso que Obsidian no puede hacer.

## Las cuatro direcciones

| # | Nombre | Tesis | Acento | Riesgo |
|---|--------|-------|--------|--------|
| 01 | **Ink & Paper** | Editorial: papel cálido, títulos serif, hairlines en vez de bordes. La nota es una página, no un panel. | bermellón `#b03a1a` | puede sentirse "blog", poco herramienta |
| 02 | **Instrument** | Consola de grafito: etiquetas mono, grilla hairline, acento verde señal. Presencia y costo son gauges permanentes. | verde señal `#6ee7a0` | densidad alta, menos acogedor para escribir |
| 03 | **Signal** | Todo gira alrededor de quién está. Cada persona tiene un color que aparece en cursores, puntos, bordes y chips. | multi-persona | puede volverse ruidoso con 1 solo usuario |
| 04 | **Ruled Ledger** | Papel de ingeniería: sidebar como índice numerado, gutter reglado con marcas, numerales mono, acento cobalto. | cobalto `#1f4fd8` | más "documento técnico" que "escritura" |

Cada dirección define también: forma del sidebar, tratamiento de etiquetas, barra de presencia,
medidor de uso, y tipografía de títulos.

## Estrategia fijada

**El público son migrantes de Obsidian.** Por lo tanto el esqueleto se queda (árbol de carpetas,
tabs, atajos, markdown puro) y lo que cambia es el **material** y una capa de **pequeñas
sorpresas**: la información que Obsidian no puede mostrar porque es local y de un solo usuario
—presencia, autoría por línea, uso medido, versión del documento—. Las sorpresas no son
decoración: son la diferencia del producto hecha visible en el material elegido.

Corolario: la dirección **Signal** (03) queda descartada como base — rompe la familiaridad al
poner la presencia como navegación principal. Sus ideas sobreviven como capa de sorpresa.

## Alcance acotado: solo theme

**No hay cambios estructurales.** Se toca únicamente lo que ya está en `src/index.css` como
tokens y reglas de presentación: colores, tipografías, bordes, radios, tamaños, márgenes,
icons. El layout (sidebar a la izquierda, tabs arriba, editor a la derecha, árbol de carpetas,
lista de etiquetas) queda exactamente como está.

Consecuencia: las "sorpresas" que dependían de estructura (presencia como nota al margen,
session log, autor por línea en el gutter) quedan **fuera de alcance** en esta fase. Las
sorpresas posibles dentro del alcance son de material: tipografía del documento, tratamiento
de etiquetas, densidad, peso de íconos, forma de las reglas, numerales mono en metadatos.

## El color no es parte del diseño

El color lo controla la persona: `src/lib/theme.ts` deriva los 13 tokens desde dos semillas
(fondo + acento), hay 12 presets y el que se pinta por defecto es **`nordico`**. Por lo tanto
un skin **no puede definirse por su paleta** — tiene que definirse por lo que la paleta no
toca:

- familia y escala tipográfica (documento, chrome, metadatos)
- lenguaje de bordes (hairline / 0 / grueso / sólo reglas laterales) y radio
- densidad (padding de fila, altura de línea, ancho del sidebar)
- **cómo se usa el acento**: regla lateral, relleno tenue, subrayado, o etiqueta de sección
- peso de íconos

Comparación hecha con la paleta real de Nordic (light), extraída de `themeCssVars(presetState('nordico'))`:

`bg #eef1f6 · bg2 #e1e6ee · bg3 #d6dce5 · line #c7d1df · accent #4c6a92 · accent-ink #4a678f · text #111418 · muted #535960`

Hallazgo del ejercicio: con el color fijo, **S1, S3 y S4 convergen**; lo único que las separa
es la tipografía y el radio. S2 (mono + radio 0) es el único que sigue siendo inconfundible.
Eso implica que la decisión real no es "qué skin" sino **qué tipografía y qué geometría**.

## Skins (mismo DOM, solo tokens)

| Skin | bg | línea | acento | radius | tipografía | densidad |
|------|----|-------|--------|--------|------------|----------|
| **S1 Ink & Paper** | serif en el documento, sans en chrome | 2px | regla lateral + lomo en bloques de código | fila 4px |
| **S2 Instrument** | todo mono | 0 | etiquetas de sección en acento | fila 2.5px |
| **S3 Signal** | sans | 7px | relleno tenue (`color-mix` 14%) en links y badges | fila 4px |
| **S4 Ruled Ledger** | sans + numerales mono | 3px | lomo 2px + links subrayados | fila 3.5px |

## Signal: cuatro formas de darle filo

Signal es la más convencional de las cuatro (radio 7px, cards suaves, Inter: la forma de
Notion/Linear). Como el color lo controla la persona, el carácter tiene que venir de otra
parte. Variantes evaluadas, todas sobre la misma paleta Nordic:

| Variante | Cambio | Costo |
|----------|--------|-------|
| **V1** | Ninguno (control) | Ninguno. Es la más segura y la más genérica |
| **V2** | H1/H2 en serif (17px / 12.5px Georgia), cuerpo en Inter | Contraste fuerte entre chrome blando y títulos impresos. Requiere cargar o aceptar una serif del sistema |
| **V3** | Etiquetas, metadatos, breadcrumb y conteos en mono | Barato: es un cambio de `font-family` en ~6 selectores. Hace que los datos se lean como instrumentación |
| **V4** | Chrome sin acento; el acento aparece una sola vez por pantalla | El más silencioso. Riesgo: la app pierde identidad de marca |

## Íconos: lo que se midió

Los cuatro lenguajes se compararon a tamaño real (16px) y a 3×. Hallazgo: **a 16px, 1.5px y
2px de stroke son casi indistinguibles** — la diferencia sólo aparece al ampliar. O sea que la
opción de 2px cuesta un valor de CSS pero no compra diferenciación visible; y la opción
sin íconos (C) sí cambia lo que el sidebar *dice*, no sólo cómo se ve.

Relleno (D) obliga a mantener un segundo juego de ~30 íconos: es la única opción cara de verdad.

## Catálogo de presets: diagnóstico medido

Se midió el canvas de los 12 presets en OKLab L (`themeCssVars(presetState(id))`):

- **Light:** los 12 caen entre **0.953 y 1.000**. Ninguno baja de 0.95, así que todos se leen
  como "blanco con un tinte".
- **Dark:** 11 de los 12 caen entre **0.188 y 0.191** — el mismo casi-negro. El duodécimo
  (`consola`, 0.152) es el único diseño escrito en oscuro.

Son **dos causas independientes**:

1. En claro no hay nada entre 0.19 y 0.95: falta una banda entera de fondos con cuerpo.
2. En oscuro la compresión la produce `mirrorSeeds()`, que fija el canvas espejado en L 0.19
   para todo diseño escrito en claro. **Hacer los presets más claros no mejora el modo oscuro:**
   para variar el oscuro hay que agregar diseños escritos en oscuro.

### Candidatos verificados

Todos calculados con `derivePalette()`, no a ojo. Contraste de texto y muted medido:

| id | canvas | accent | L | texto | muted |
|----|--------|--------|---|-------|-------|
| niebla | `#dde3ec` | `#4f6480` | 0.914 | 14.3:1 | 5.6:1 |
| lino | `#e9e1d2` | `#7d6440` | 0.912 | 14.2:1 | 5.5:1 |
| salvia | `#dde7da` | `#457050` | 0.917 | 14.5:1 | 5.5:1 |
| cielo | `#d3e3f2` | `#2a6699` | 0.908 | 14.1:1 | 5.5:1 |
| malva | `#e5dbe9` | `#704a86` | 0.903 | 13.8:1 | 5.5:1 |
| miel | `#f2e7c9` | `#8c6d24` | 0.929 | 15.0:1 | 5.5:1 |
| pizarra (oscuro) | `#1c2027` | `#7fa0c9` | 0.243 | 13.9:1 | 5.9:1 |
| tinta (oscuro) | `#0f1420` | `#8fb3ff` | 0.192 | 15.4:1 | 7.0:1 |
| musgo (oscuro) | `#141a13` | `#7fc98a` | 0.209 | 14.9:1 | 6.6:1 |

### Lección: "más claro" no es lo mismo que "diseñado en claro"

Los 6 presets claros nuevos **no cambian nada en modo oscuro**: están escritos sobre un canvas
claro, así que en oscuro la app pinta su espejo y `mirrorSeeds()` fija ese espejo en L 0.19.
En un sistema oscuro sólo cambia el acento. Para que el modo oscuro se sienta distinto hay que
agregar diseños **escritos en oscuro** — de ahí los 3 tenues.

**Techo del sistema:** por encima de L ~0.38 la derivación sólo alcanza 10.5:1 devolviendo
texto `#ffffff` puro, y el invariante "nunca colapsar a negro ni a blanco" lo prohíbe. Un tema
oscuro más claro que eso exige relajar ese invariante primero.

### Costo de agregar un preset

Una entrada en `PRESETS` (`src/lib/theme.ts`) + dos claves en `src/i18n/en.ts`
(`theme.<id>.name` y `theme.<id>.hint`). Los tests sólo exigen `PRESETS.length >= 10`, así que
agregar no rompe nada. Aviso: el `ThemeDialog` hoy muestra 12 tarjetas; con 21 hay que revisar
que la grilla siga siendo usable.

## Catálogo final (12)

| columna | diseños |
|---------|---------|
| **Izquierda — escritos en claro** | obsidiana `#ffffff` · nordico `#eef1f6` · niebla `#dde3ec` · lino `#e9e1d2` · salvia `#dde7da` · miel `#f2e7c9` |
| **Derecha — escritos en oscuro** | consola `#080d09` · tinta `#0f1420` · pizarra `#1c2027` · bruma `#2a2f38` · oliva `#2f342c` · tabaco `#423b31` |

Recortados por redundantes: `grafito`, `papel`, `oceano`, `atardecer`, `menta`, `cereza`, `sepia`,
`cielo`, `iris`, `malva`, `bosque`, `musgo`. Criterio: mismo hue y misma claridad que otro preset
que ya quedó (los cuatro casi-negros `consola`/`tinta`/`pizarra`/`musgo` competían entre sí; los
cremas `papel`/`lino`/`miel` también).

## El diálogo de tema, en su forma final

- **Sin "How it looks"**: se va la miniatura del editor (`ThemeThumb`) y la línea de texto que
  describía el tema elegido. Con eso caen también `theme.adjusted`, `themeDialog.preview`, el
  componente `ThemeThumb` (~79 líneas) y 163 líneas de CSS de la miniatura.
- **Tarjetas mínimas**: dos cuadrados + nombre. Se van los 12 `hint` de los presets, la clave
  `hintKey` del tipo `ThemePreset` y la regla `.theme-card-hint`.
- **La tarjeta**: dos cuadrados de 34px superpuestos (el del canvas detrás, el del acento encima,
  desplazado 12px) y el nombre debajo. Un anillo del color del diálogo separa el cuadrado de
  arriba del de abajo donde se pisan.
- **"Your colours" → "Advanced", cerrado por defecto**: `<details>` nativo en vez de un estado
  de React, así que el teclado y el lector de pantalla funcionan sin JS extra.
- **Los hooks de apariencia del sistema quedan muertos** al no existir el preview: se borran
  `useSystemAppearance`, `useAppearance` y la suscripción a `matchMedia`. La apariencia se pinta
  con `color-scheme` desde `state.appearance`, que fija la columna elegida.

## Decision log

| # | Decisión | Estado |
|---|----------|--------|
| D1 | Dirección base: **S3 Signal** (radio 7px, cards rellenas, sans, acento en rellenos tenues) | **fijada** |
| D2 | Público y estrategia: migrantes de Obsidian, esqueleto familiar + capa de sorpresas | **fijada** |
| D2b | Alcance: solo theme (tokens y presentación), sin cambios estructurales | **fijada** |
| D3 | Cómo se representa la presencia multi-usuario (margen / session log / autor por línea) | fuera de alcance (requiere estructura) |
| D4 | Dónde vive el medidor de uso prepago | pendiente |
| D5 | Tipografía: **sans (Inter) en el documento, mono en todos los metadatos** (Signal V3) | **fijada** |
| D6 | Acento: relleno tenue al 14% en links y badges, más color de etiqueta de sección | **fijada** |
| D7 | Apariencia: sigue al sistema (Nordic en ambos lados); el usuario decide, no se fuerza ninguna | **fijada** |
| D10 | Lenguaje de íconos: outline 1.5px, Lucide tal como está | **fijada** |
| D11 | Se agregan los 9 candidatos: 6 claros (niebla, lino, salvia, cielo, malva, miel) + 3 oscuros (pizarra, tinta, musgo). Catálogo: 12 → 21 | **revisada por D13** |
| D12 | Se agregan 3 diseños **tenues** escritos en oscuro (bruma L 0.304, oliva L 0.317, tabaco L 0.356) para llenar la banda 0.25–0.50. Catálogo: 21 → 24 | **revisada por D13** |
| D13 | Catálogo final: **6 + 6**, dos columnas (izquierda diseños escritos en claro, derecha escritos en oscuro), sin tabs ni rótulos. Se recortan los presets redundantes | **fijada e implementada** |
| D14 | **Sin selector de apariencia.** La apariencia sale de las dos columnas: elegir un diseño lo pinta en la claridad en que fue escrito (columna izquierda → claro, derecha → oscuro). `ThemeState.appearance` sigue existiendo y se persiste, pero lo fija la elección del diseño | **fijada e implementada** |
| D8 | Qué se reescribe del CSS actual (`src/index.css`, 4.012 líneas) y qué se tira | pendiente |
| D9 | Primera sorpresa que se implementa | pendiente |
