// Portfolio / Project Overview calculations. Pure functions (no React, no network), tested in plain Node.
// Items belong to a project through the project NAME (item.proyecto), as everywhere else in the app.
import { dayKey, daysBetween } from './mywork.js'

export const HEALTH = ['on_track', 'at_risk', 'off_track', 'not_set']
export const HEALTH_LABEL = { on_track: 'En plazo', at_risk: 'En riesgo', off_track: 'Fuera de plan', not_set: 'Sin definir' }
export const HEALTH_COLOR = { on_track: '#10b981', at_risk: '#d97706', off_track: '#e11d48', not_set: '#94a3b8' }
// Project states, as the existing Proyectos view uses them (legacy keys).
export const STATE = ['pending', 'inprogress', 'blocked', 'done', 'backlog']
export const STATE_LABEL = { pending: 'Pendiente', inprogress: 'En curso', blocked: 'Bloqueado', done: 'Completado', backlog: 'Backlog' }

const norm = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const ACTIVE_ITEM = ['pending', 'inprogress', 'blocked']
const dueKey = i => (i.fechaFin instanceof Date ? dayKey(i.fechaFin) : null)

export const itemsOfProject = (project, items) => {
  const n = norm(project.nombre)
  return n ? (items || []).filter(i => norm(i.proyecto) === n) : []
}

// Progress = done / total linked items (spec: completed tasks / total, cancelled excluded; there is no "cancelled" item state here).
export function projectStats(project, items, today = dayKey(new Date())) {
  const linked = itemsOfProject(project, items)
  const done = linked.filter(i => i.status === 'done').length
  const active = linked.filter(i => ACTIVE_ITEM.includes(i.status))
  const backlog = linked.filter(i => i.status === 'backlog').length
  const dues = active.map(dueKey).filter(Boolean).sort()
  return {
    total: linked.length, done, active: active.length, backlog,
    blockers: active.filter(i => i.status === 'blocked').length,
    overdue: active.filter(i => dueKey(i) && dueKey(i) < today).length,
    progress: linked.length ? Math.round((done / linked.length) * 100) : null,
    nextDue: dues.find(d => d >= today) || null,
  }
}

export const targetKey = p => (p.fechaFin instanceof Date ? dayKey(p.fechaFin) : null)
export const daysLeft = (p, today = dayKey(new Date())) => { const k = targetKey(p); return k ? daysBetween(today, k) : null }

export function portfolioRows(projects, items, today = dayKey(new Date())) {
  return (projects || []).map(p => ({ project: p, stats: projectStats(p, items, today), target: targetKey(p), daysLeft: daysLeft(p, today) }))
}

export function portfolioSummary(rows) {
  const open = rows.filter(r => r.project.status !== 'done' && r.project.status !== 'backlog')
  return {
    projects: rows.length, open: open.length,
    atRisk: open.filter(r => r.project.health === 'at_risk').length,
    offTrack: open.filter(r => r.project.health === 'off_track').length,
    notSet: open.filter(r => (r.project.health || 'not_set') === 'not_set').length,
    blockers: rows.reduce((s, r) => s + r.stats.blockers, 0),
    overdue: rows.reduce((s, r) => s + r.stats.overdue, 0),
  }
}

// state: 'open' (not completed/backlog) | 'all' | 'done' | 'backlog'
export function filterRows(rows, { state = 'open', owner = '', health = '' } = {}) {
  return rows.filter(r => {
    const s = r.project.status
    if (state === 'open' && (s === 'done' || s === 'backlog')) return false
    if (state === 'done' && s !== 'done') return false
    if (state === 'backlog' && s !== 'backlog') return false
    if (owner && norm(r.project.propietario) !== norm(owner)) return false
    if (health && (r.project.health || 'not_set') !== health) return false
    return true
  })
}

const KEYS = {
  nombre:   r => norm(r.project.nombre),
  owner:    r => norm(r.project.propietario),
  state:    r => STATE.indexOf(r.project.status),
  health:   r => { const h = r.project.health || 'not_set'; return h === 'not_set' ? -1 : ['off_track', 'at_risk', 'on_track'].indexOf(h) },   // asc = worst first; undefined health sorts last
  progress: r => r.stats.progress,
  target:   r => r.target,
  open:     r => r.stats.active,
  blockers: r => r.stats.blockers,
  overdue:  r => r.stats.overdue,
}
// Empty values (no owner, no date, no linked items) always sort last.
export function sortRows(rows, key = 'health', dir = 'asc') {
  const get = KEYS[key] || KEYS.nombre, sign = dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const va = get(a), vb = get(b), ea = va === null || va === '' || va === undefined || va === -1, eb = vb === null || vb === '' || vb === undefined || vb === -1
    if (ea !== eb) return ea ? 1 : -1
    if (ea) return norm(a.project.nombre).localeCompare(norm(b.project.nombre))
    const c = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb
    return c * sign || norm(a.project.nombre).localeCompare(norm(b.project.nombre))
  })
}

// Project Overview sections.
export function overview(project, items, today = dayKey(new Date())) {
  const linked = itemsOfProject(project, items)
  const active = linked.filter(i => ACTIVE_ITEM.includes(i.status))
  const byDue = (a, b) => (dueKey(a) ?? '9999').localeCompare(dueKey(b) ?? '9999')
  const people = [...new Set([project.propietario, ...linked.map(i => i.propietario)].filter(Boolean))]
  return {
    stats: projectStats(project, items, today),
    blockers: active.filter(i => i.status === 'blocked').sort(byDue),
    overdue: active.filter(i => dueKey(i) && dueKey(i) < today).sort(byDue),
    upcoming: active.filter(i => dueKey(i) && dueKey(i) >= today).sort(byDue).slice(0, 5),
    recent: [...linked].filter(i => i.updated_at).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 6),
    team: people,
  }
}
