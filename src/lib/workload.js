// Workload: planned effort per person and week against weekly capacity. Pure functions (no React, no network).
//   - Effort comes from item.estimateH (hours). Only ACTIVE items (pending / in progress / blocked) count.
//   - An item lands in the week of its due date (fechaFin). Overdue items land in the CURRENT week (that work still has to be done).
//   - Items without a due date go to a separate "sin fecha" bucket; items without an estimate are counted apart (no hours invented).
//   - Capacity is hours per week (people.capacity_h); null = not defined (hours are shown, no percentage).
import { dayKey, addDays, daysBetween } from './mywork.js'

const ACTIVE = ['pending', 'inprogress', 'blocked']
const normName = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

// Monday of the week that contains `key` ('YYYY-MM-DD').
export function weekStart(key) {
  const [y, m, d] = key.split('-').map(Number)
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7        // Mon=0 .. Sun=6
  return addDays(key, -dow)
}

export function weekList(today, n = 8) {
  const first = weekStart(today)
  return Array.from({ length: n }, (_, i) => addDays(first, i * 7))
}

export const utilization = (hours, capacity) => (capacity > 0 ? hours / capacity : null)
export function loadLevel(hours, capacity) {                      // 'none' | 'ok' | 'high' | 'over'
  const u = utilization(hours, capacity)
  if (u === null) return 'none'
  return u > 1 ? 'over' : u >= 0.85 ? 'high' : 'ok'
}

/**
 * people: [{ id, name, capacityH }]   items: app items   -> one row per person:
 *   { person, capacityH, weeks: [{ start, hours, level, items: [...] }], noDate: { hours, items }, unestimated: [...] , overdue: n }
 * Items whose owner is not in `people` are ignored here (the view lists them as "sin persona" separately via `unassigned`).
 */
export function workloadRows(people, items, today, nWeeks = 8) {
  const weeks = weekList(today, nWeeks)
  const byName = new Map(people.map(p => [normName(p.name), p]))
  const rows = new Map(people.map(p => [p.id, {
    person: p, capacityH: p.capacityH ?? null,
    weeks: weeks.map(start => ({ start, hours: 0, level: 'none', items: [] })),
    noDate: { hours: 0, items: [] }, unestimated: [], overdue: 0, later: { hours: 0, items: [] },
  }]))
  const unassigned = []
  for (const it of items || []) {
    if (!ACTIVE.includes(it.status)) continue
    const p = byName.get(normName(it.propietario))
    if (!p) { unassigned.push(it); continue }
    const row = rows.get(p.id)
    const h = typeof it.estimateH === 'number' && it.estimateH > 0 ? it.estimateH : 0
    if (!h) row.unestimated.push(it)
    const due = it.fechaFin instanceof Date ? dayKey(it.fechaFin) : null
    if (!due) { row.noDate.items.push(it); row.noDate.hours += h; continue }
    const overdue = daysBetween(today, due) < 0
    if (overdue) row.overdue++
    const idx = overdue ? 0 : Math.floor(daysBetween(weeks[0], due) / 7)
    if (idx >= weeks.length) { row.later.items.push(it); row.later.hours += h; continue }
    const w = row.weeks[idx]; w.items.push(it); w.hours += h
  }
  for (const row of rows.values()) for (const w of row.weeks) w.level = loadLevel(w.hours, row.capacityH)
  return { weeks, rows: people.map(p => rows.get(p.id)), unassigned }
}

// Totals for the header tiles.
export function workloadSummary(rows, currentWeekIdx = 0) {
  const cw = rows.map(r => ({ r, w: r.weeks[currentWeekIdx] }))
  return {
    overloaded: cw.filter(x => x.w && x.w.level === 'over').length,
    hoursThisWeek: cw.reduce((s, x) => s + (x.w ? x.w.hours : 0), 0),
    capacityThisWeek: rows.reduce((s, r) => s + (r.capacityH || 0), 0),
    unestimated: rows.reduce((s, r) => s + r.unestimated.length, 0),
    overdue: rows.reduce((s, r) => s + r.overdue, 0),
  }
}
