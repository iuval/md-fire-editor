import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { currentDay, nextDayStart } from './usage'

/**
 * Cuota medida por el servidor: `allowance/{uid}/days/{YYYY-MM-DD}` la escribe
 * solo el proxy (las rules prohíben escribirla desde el cliente), así que es el
 * único número que vale para cobrar. El contador de `usage` queda como
 * transparencia del lado del cliente y para dispositivos sin proxy.
 */
export interface ServerAllowance {
  day: string
  opsUsed: number
  /** Escrituras y borrados del día, para valorizar el cargo igual que el proxy. */
  writes: number
  deletes: number
  quota: number
  /** ISO; la cuota se renueva a las 00:00 UTC. */
  renewsAt: string | null
}

function allowanceDoc(uid: string, day: string) {
  return doc(db!, 'allowance', uid, 'days', day)
}

export function subscribeAllowance(
  uid: string,
  onChange: (allowance: ServerAllowance | null) => void
): () => void {
  if (!db) return () => undefined
  let off: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let day = currentDay()

  const schedule = () => {
    const delay = nextDayStart().getTime() - Date.now()
    timer = setTimeout(
      () => {
        if (currentDay() === day) {
          schedule()
          return
        }
        off?.()
        off = null
        open()
      },
      Math.min(Math.max(1000, delay), 24 * 60 * 60 * 1000)
    )
  }

  const open = () => {
    day = currentDay()
    off = onSnapshot(
      allowanceDoc(uid, day),
      (snap) => {
        const data = snap.data()
        if (!data) {
          onChange({ day, opsUsed: 0, writes: 0, deletes: 0, quota: 700, renewsAt: null })
          return
        }
        const opsUsed = Number(data.opsUsed ?? 0)
        onChange({
          day: typeof data.day === 'string' ? data.day : day,
          opsUsed,
          writes: Number(data.writes ?? opsUsed),
          deletes: Number(data.deletes ?? 0),
          quota: Number(data.quota ?? 700),
          renewsAt: typeof data.renewsAt === 'string' ? data.renewsAt : null,
        })
      },
      () => onChange(null)
    )
    schedule()
  }

  open()
  return () => {
    if (timer) clearTimeout(timer)
    off?.()
  }
}
