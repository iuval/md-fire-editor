# Revisión del plan comercial — 21-nov-2026

Revisión del documento `comercial-y-marketing.md` contra el estado real del producto y
contra precios verificados. Conclusiones ordenadas por severidad.

## Veredicto

El plan está bien escrito y el posicionamiento es atractivo, pero **no está listo para
ejecutar**: vende tres cosas que el producto no tiene (archivos locales, E2EE, export), el
modelo de precios no tiene nada que lo soporte (ni planes, ni cuotas, ni checkout), y hay dos
bloqueantes materiales: **Stripe no opera en Uruguay** y el **pay-per-session a $0.05–0.10 es
imposible con tarjeta**.

Los costos reales, en cambio, son 2–5× más bajos de lo que estima para notas de texto: el cap
de $4 tiene margen holgado.

## 1. Bloqueantes (P0)

| # | Problema | Evidencia | Acción |
|---|---|---|---|
| 1 | "Markdown local, archivos .md en disco" es falso: la fuente de verdad es Firestore | no hay acceso a filesystem ni export; "abrir la misma carpeta" (§7.3) no existe | (a) construir vault local (File System Access API, solo Chromium; o app de escritorio) o (b) reposicionar a "markdown exportable" + Export .md/ZIP e Import |
| 2 | "E2E encryption" | no existe; incompatible con búsqueda server-side, agentes y ACLs actuales | quitarlo del copy |
| 3 | "Exportable siempre" | no hay export | Export por nota y ZIP de todo (implementado) |
| 4 | Sin monetización completa: cuota y créditos implementados, checkout pendiente | el medidor, la cuota gratuita y el saldo prepago existen; no hay pasarela ni débito automático | cuota gratuita mensual renovable + créditos prepagos; checkout con MoR o MercadoPago/dLocal |
| 5 | Stripe no opera desde Uruguay | stripe.com/global lista Brasil, México, España; no Uruguay | MoR (Paddle/Lemon Squeezy/Polar ~5% + $0.50) o entidad US/EU; MercadoPago/dLocal local |
| 6 | $0.05–0.10 por sesión | fee mínimo $0.30 → 300% del precio | mínimo de cobro $3 prepago, o sesiones dentro del plan team |
| 7 | Sin analítica: los KPIs de §7.4 son inmedibles | no hay eventos | 5–7 eventos (implementado) |

## 2. Correcciones numéricas

Tarifas reales de Firestore (cloud.google.com/firestore/pricing): lecturas $0.03/100k,
escrituras $0.09/100k, borrados $0.01/100k. El modelo reproducible y el desglose completo
están en [`docs/pricing.md`](pricing.md) (`node scripts/pricing-model.mjs`).

| Ítem | Doc | Real |
|---|---|---|
| Escrituras | $0.18/100k | **$0.09/100k** |
| Lecturas | $0.03/100k | ✅ |
| Storage | $0.026/GB-mes | eso es Cloud Storage; Firestore Standard ≈ **$0.15/GiB-mes** (el texto pesa poco, pero la cifra vieja subestimaba 25×) |
| Egress $0.12/GB | ✅ | no aplica: hoy no hay blobs |
| Costo usuario solo | $0.70–1.00/mes | **$0.12** (ocasional) / **$0.51** (heavy) |

Con el perfil medido del sync v2 (2,7 escrituras/s de tipeo, presencia cada 1,2 s):

| Escenario | Escrituras/mes | Costo | Precio | Margen |
|---|---|---|---|---|
| Solo ocasional (10 h) | 129k | $0.12 | créditos | — |
| Solo heavy (44 h) | 568k | $0.51 | $4 | 87% |
| Team 5, 2 activos, 40 h c/u | 2,1M | $2.17 | $12 | 82% |
| Team 5, 5 activos, 20 h c/u | 6,5M | $7.37 | $15 | 51% |

**Exposición principal: el free tier sin medidor.** 1.000 usuarios heavy = **$513/mes** sin
ingresos. Hace falta límite duro de uso o mover el canal caliente a RTDB.

> **Resuelto en el diseño**: [`prepaid-usage-model.md`](prepaid-usage-model.md) reemplaza los
> precios flat de esta tabla por un tarifario único por uso medido, con cuota gratuita
> **diaria** (100 MB + 700 ops) y un proxy como único escritor. El cobro es por día: uso
> sobre la cuota + margen. La columna «Precio» de arriba ($4/$12/$15) queda como registro de
> la propuesta anterior.

Dos errores conceptuales:

- **"Break-even ~500 cuentas ($1.500/mes)"** confunde break-even con objetivo: con ~$150/mes
  de costos fijos el break-even son ~50 cuentas.
- **"Firestore NO sirve de transporte"**: contradice lo medido. Sirve hasta ~5 editores
  activos con 51–82% de margen; el relay WebSocket es optimización, no prerequisito (y saca
  el demo del camino crítico).

## 3. Faltantes

**Financiero:** P&L y caja; costos fijos (dominio, MoR, email, analytics, contador, DGI/CFE,
soporte); CAC, payback, churn y LTV; escenarios. Con 3–5% de conversión y 5%/mes de churn, el
LTV con ARPU $12 es ~$240 → CAC máximo ~$80; el documento no fija techo de CAC.

**Legal/impuestos (UY):** IVA 22% en servicios digitales vs exportación de servicios (0%);
facturación electrónica DGI; ToS, privacidad (GDPR si hay UE, Ley 18.331), borrado de cuenta,
retención.

**Operativo:** backups y PITR están activos en producción (README §Operación), pero no hay
política de reembolsos/chargebacks ni SLA de soporte.

**Marketing:** no se explota el loop viral existente (compartir por link = adquisición
gratis) ni el diferenciador único construido: **CLI/MCP para agentes de IA**.

## 4. Lo que sí está listo

- Collab realtime medida: primer edit visible al otro cliente en 417 ms; cursores y presencia.
- Carpetas + share por carpeta y por nota con roles Lectura/Escritura; corte inmediato al revocar.
- Reglas endurecidas (71 tests), sync por bloques con hash y manifiesto.
- CLI + MCP para agentes con identidad propia y permisos mínimos.
- PWA y pipeline de deploy.

El paso "MVP collab con relay WebSocket para grabar el demo" ya está hecho: el demo se puede
grabar hoy.

## 5. Cambios al documento

1. §1: sacar "archivos en disco" o moverlo a roadmap; decir "markdown exportable".
2. §4: reemplazar créditos GB-mes por planes flat + packs de $3; mantener el cap.
3. §5: reemplazar el párrafo de costos por la tabla medida con tarifas corregidas.
4. §6: agregar costos fijos, CAC, churn, LTV; separar break-even de objetivo.
5. §7.5: reemplazar la fila de Stripe/MercadoPago por el bloqueo real (MoR).
6. §8: export + analítica + planes antes del demo; relay fuera del camino crítico.
7. Agregar: impuestos/legal UY, reembolsos, backups y el embudo del link compartido.

## 6. Decisiones pendientes

1. ¿El vault local es el producto o es roadmap?
2. ¿Mercado inicial UY/LatAm o global? (define MoR vs MercadoPago y precios con IVA)
3. ¿Free tier con límite duro? (si no, el costo sin ingresos es el mayor riesgo)
