// "My Work" classification. Pure functions (no React, no network) so they can be tested in plain Node.
// An item is "active" when it is Pendiente / En Curso / Bloqueado (Completado and Backlog are not work to do now).

const ACTIVE = ['pending', 'inprogress', 'blocked']
const PRIO_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 }

const norm = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const pad = n => String(n).padStart(2, '0')

// Calendar day of a Date in LOCAL time ('YYYY-MM-DD'). Works for noon-local dates (PM backend) and local-midnight dates (legacy).
export const dayKey = d => (d instanceof Date && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null)

export const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + n, 12))
}

export const daysBetween = (fromKey, toKey) => {                 // toKey - fromKey, in whole days
  const [y1, m1, d1] = fromKey.split('-').map(Number), [y2, m2, d2] = toKey.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

const byDueThenPriority = (a, b) =>
  (a._due ?? '9999-99-99').localeCompare(b._due ?? '9999-99-99') ||
  (PRIO_ORDER[a.prioridad] ?? 9) - (PRIO_ORDER[b.prioridad] ?? 9) ||
  String(a.tema).localeCompare(String(b.tema))

// items: UI items (propietario, status, fechaFin Date|null, prioridad, tema...). personName: 'Juan Rodriguez Peisel'. now: Date.
export function classifyMyWork(items, personName, now = new Date()) {
  const me = norm(personName)
  const today = dayKey(now)
  const horizon = addDays(today, 7)
  const mine = (items || [])
    .filter(i => me && norm(i.propietario) === me && ACTIVE.includes(i.status))
    .map(i => ({ ...i, _due: dayKey(i.fechaFin) }))
    .sort(byDueThenPriority)
  return {
    today,
    overdue:  mine.filter(i => i._due && i._due < today),
    dueToday: mine.filter(i => i._due === today),
    upcoming: mine.filter(i => i._due && i._due > today && i._due <= horizon),
    blocked:  mine.filter(i => i.status === 'blocked'),
    noDate:   mine.filter(i => !i._due),
    all:      mine,
  }
}

// "juan@x.com " -> 'juan@x.com'; returns null when it is not a plausible e-mail.
export const cleanEmail = s => {
  const e = (s ?? '').toString().trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}
