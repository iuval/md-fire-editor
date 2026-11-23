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

## Decision log

| # | Decisión | Estado |
|---|----------|--------|
| D1 | Dirección base: **A** Ink & Paper · **B** Instrument · **D** Ruled Ledger · híbrido | pendiente |
| D2 | Público y estrategia: migrantes de Obsidian, esqueleto familiar + capa de sorpresas | **fijada** |
| D2b | Alcance: solo theme (tokens y presentación), sin cambios estructurales | **fijada** |
| D3 | Cómo se representa la presencia multi-usuario (margen / session log / autor por línea) | fuera de alcance (requiere estructura) |
| D4 | Dónde vive el medidor de uso prepago | pendiente |
| D5 | Tipografía de títulos, cuerpo y chrome | pendiente |
| D6 | Acento de marca definitivo | pendiente |
| D7 | Modo claro vs oscuro como default | pendiente |
| D10 | Lenguaje de íconos (stroke, relleno, o sin íconos) | pendiente |
| D8 | Qué se reescribe del CSS actual (`src/index.css`, 4.012 líneas) y qué se tira | pendiente |
| D9 | Primera sorpresa que se implementa | pendiente |
