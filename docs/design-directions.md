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

## Decision log

| # | Decisión | Estado |
|---|----------|--------|
| D1 | Dirección base: **A** Ink & Paper · **B** Instrument · **D** Ruled Ledger · híbrido | pendiente |
| D2 | Público y estrategia: migrantes de Obsidian, esqueleto familiar + capa de sorpresas | **fijada** |
| D3 | Cómo se representa la presencia multi-usuario (margen / session log / autor por línea) | pendiente |
| D4 | Dónde vive el medidor de uso prepago | pendiente |
| D5 | Tipografía de títulos y de chrome | pendiente |
| D6 | Acento de marca definitivo | pendiente |
| D7 | Modo claro vs oscuro como default | pendiente |
| D8 | Qué se reescribe del CSS actual (`src/index.css`, 4.012 líneas) y qué se tira | pendiente |
| D9 | Primera sorpresa que se implementa | pendiente |
