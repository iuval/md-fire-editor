// Modelo de costos de Firestore de FireMD. Sin dependencias: `node scripts/pricing-model.mjs`.
//
// Reproduce dos juegos de supuestos para el mismo producto:
//   base  = las premisas del documento original (2 escrituras/s, heartbeat 20 s)
//   code  = las constantes reales del código (throttle 350 ms, heartbeat 10 s)
//
// El documento docs/pricing.md cita la salida de este script. Si cambia una
// constante del sync (provider.ts, awareness.ts, NotePane.tsx), actualizala acá
// y en el documento; el script es la fuente de verdad de los números.

const RATES = {
  reads: 0.03, // USD por 100k
  writes: 0.09, // USD por 100k
  deletes: 0.01, // USD por 100k
  storage: 0.15, // USD por GiB-mes
  egress: 0.12, // USD por GiB
}

// Cuota gratuita del proyecto (por día; storage y egress son por mes).
const FREE = { reads: 50_000, writes: 20_000, deletes: 20_000, storage: 1, egress: 10 }

const DAYS_ACTIVE = 22
const MONTH_DAYS = 30
const DAU = 100
const STORAGE_GIB = 0.02 // 20 MB de notas + historial

/** Costo bruto de un usuario en un mes (sin descontar la cuota del proyecto). */
function perUser({ writesPerDay, readsPerDay, deletesPerDay, storageGiB = STORAGE_GIB }) {
  const writes = writesPerDay * DAYS_ACTIVE
  const reads = readsPerDay * DAYS_ACTIVE
  const deletes = deletesPerDay * DAYS_ACTIVE
  const cost = {
    writes: (writes / 100_000) * RATES.writes,
    reads: (reads / 100_000) * RATES.reads,
    deletes: (deletes / 100_000) * RATES.deletes,
    storage: storageGiB * RATES.storage,
  }
  return { writes, reads, deletes, cost, total: cost.writes + cost.reads + cost.deletes + cost.storage }
}

/** Factura mensual del proyecto con N usuarios activos diarios, neta de la cuota gratis. */
function fleet({ writesPerDay, readsPerDay, deletesPerDay, storageGiB = STORAGE_GIB, dau = DAU }) {
  const billable = {
    writes: Math.max(0, dau * writesPerDay - FREE.writes) * MONTH_DAYS,
    reads: Math.max(0, dau * readsPerDay - FREE.reads) * MONTH_DAYS,
    deletes: Math.max(0, dau * deletesPerDay - FREE.deletes) * MONTH_DAYS,
    storage: Math.max(0, dau * storageGiB - FREE.storage),
  }
  return {
    billable,
    total:
      (billable.writes / 100_000) * RATES.writes +
      (billable.reads / 100_000) * RATES.reads +
      (billable.deletes / 100_000) * RATES.deletes +
      billable.storage * RATES.storage,
  }
}

// --- base: premisas del documento original ---------------------------------
// 30 min de tipeo activo a 2 escrituras/s = 3.600 bloques/día; compactación
// cada 40 bloques (90 manifiestos + 3.600 borrados); heartbeat 20 s durante
// 2 h = 360 escrituras; lecturas de edición + colaboración + agentes.
const base = {
  writesPerDay: 4_100,
  readsPerDay: 5_300,
  deletesPerDay: 3_600,
}

// --- code: constantes reales ----------------------------------------------
// Tipeo 1.800 s / 350 ms de throttle = 5.143 bloques; compactación cada 40
// bloques = 129 manifiestos y 5.143 borrados; heartbeat 10 s durante 2 h = 720
// escrituras; ~40 guardados de markdown (2 documentos cada uno: body + nota);
// ~20 guardados de título; 240 escrituras del propio medidor de uso (1 cada
// 30 s por editor activo). Lecturas: los bloques propios vuelven por el
// listener, la presencia también, más abrir 15 notas (12 lecturas cada una) y
// el listado del sidebar.
const code = {
  writesPerDay: 5_143 + 129 + 720 + 80 + 20 + 240,
  readsPerDay: 5_143 + 720 + 180 + 50,
  deletesPerDay: 5_143 + 1,
}

const users = { base: perUser(base), code: perUser(code) }
const fleets = { base: fleet(base), code: fleet(code) }

const usd = (n, digits = 4) => `$${n.toFixed(digits)}`
const ops = (n) => `${(n / 1_000_000).toFixed(2)}M`

console.log('Tarifas (Standard, US):', RATES)
console.log('')
for (const [name, user] of Object.entries(users)) {
  const f = fleets[name]
  console.log(`[${name}] usuario intensivo/mes: ${usd(user.total)}`)
  console.log(
    `  writes=${usd(user.cost.writes)} reads=${usd(user.cost.reads)} deletes=${usd(user.cost.deletes)} storage=${usd(user.cost.storage)}`
  )
  console.log(
    `  operaciones: ${ops(user.writes)} writes, ${ops(user.reads)} reads, ${ops(user.deletes)} deletes`
  )
  console.log(`  ${DAU} DAU/mes (neto de cuota): ${usd(f.total, 2)}`)
  console.log(
    `  facturable: ${ops(f.billable.writes)} writes, ${ops(f.billable.reads)} reads, ${ops(f.billable.deletes)} deletes, ${f.billable.storage.toFixed(2)} GiB`
  )
  console.log('')
}

// Costo de 1M de operaciones, para fijar el precio de los créditos.
const cost1m = { writes: 10 * RATES.writes, reads: 10 * RATES.reads, deletes: 10 * RATES.deletes }
console.log(`1M writes=${usd(cost1m.writes, 2)} 1M reads=${usd(cost1m.reads, 2)} 1M deletes=${usd(cost1m.deletes, 2)}`)

// Precio propuesto: $0.50 por 100k operaciones de agente = $5 por 1M.
const AGENT_PRICE_PER_1M = 5
const margin = (cost) => `${(((AGENT_PRICE_PER_1M - cost) / AGENT_PRICE_PER_1M) * 100).toFixed(0)}%`
console.log(`Margen con $5/1M operaciones: reads ${margin(cost1m.reads)}, writes ${margin(cost1m.writes)}`)

// Almacenamiento: $0.50/GB-mes contra costo de storage + PITR + backup.
const STORAGE_COST_PER_GIB = RATES.storage + 0.15 + 0.03
console.log(
  `Storage: costo ${usd(STORAGE_COST_PER_GIB, 2)}/GiB-mes, precio $0.50 -> margen ${(((0.5 - STORAGE_COST_PER_GIB) / 0.5) * 100).toFixed(0)}%`
)
