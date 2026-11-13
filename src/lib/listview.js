// List view engine: filters, sorting, grouping and built-in views. Pure functions (no React, no network), tested in plain Node.
// A "view" is only configuration (filters + sort + grouping + columns) applied to the same items: it never stores work items.
import { dayKey, addDays } from './mywork.js'

export const STATUS_ORDER = ['pending', 'inprogress', 'blocked', 'done', 'backlog']
export const STATUS_LABEL = { pending: 'Pendiente', inprogress: 'En Curso', blocked: 'Bloqueado', done: 'Completado', backlog: 'Backlog' }
export const PRIO_ORDER = ['P0', 'P1', 'P2', 'P3']
export const CATEGORY_LABEL = { projects: 'Iniciativas', product: 'Producto', tools: 'Herramientas', cvm: 'CVM' }
export const RISK_LABEL = { green: 'Normal', yellow: 'Atención', red: 'Riesgo' }

const norm = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const toKey = v => (v instanceof Date ? dayKey(v) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

// type: text | enum | date. `options` are static values for enums; dynamic enums (owner, project) take their options from the data.
export const FIELDS = {
  tema:        { label: 'Tema',         type: 'text', get: i => i.tema ?? '' },
  status:      { label: 'Estado',       type: 'enum', get: i => i.status ?? '', options: STATUS_ORDER, optionLabel: v => STATUS_LABEL[v] || v },
  propietario: { label: 'Responsable',  type: 'enum', get: i => i.propietario ?? '', dynamic: true },
  prioridad:   { label: 'Prioridad',    type: 'enum', get: i => i.prioridad ?? '', options: PRIO_ORDER, optionLabel: v => v },
  proyecto:    { label: 'Proyecto',     type: 'enum', get: i => i.proyecto ?? '', dynamic: true },
  category:    { label: 'Área',         type: 'enum', get: i => i.category ?? '', options: Object.keys(CATEGORY_LABEL), optionLabel: v => CATEGORY_LABEL[v] || v },
  risk:        { label: 'Riesgo',       type: 'enum', get: i => i.risk ?? '', options: Object.keys(RISK_LABEL), optionLabel: v => RISK_LABEL[v] || v },
  fechaFin:    { label: 'Fecha fin',    type: 'date', get: i => toKey(i.fechaFin) ?? '' },
  fechaInicio: { label: 'Fecha inicio', type: 'date', get: i => toKey(i.fechaInicio) ?? '' },
}

export const OPERATORS = {
  text: { contains: 'contiene', not_contains: 'no contiene', eq: '=', neq: '≠', empty: 'está vacío', not_empty: 'no está vacío' },
  enum: { eq: '=', neq: '≠', in: 'es uno de', not_in: 'no es ninguno de', empty: 'está vacío', not_empty: 'no está vacío' },
  date: { eq: '=', neq: '≠', lt: '<', gt: '>', lte: '≤', gte: '≥', empty: 'está vacío', not_empty: 'no está vacío' },
}
export const NO_VALUE_OPS = ['empty', 'not_empty']

// Relative values usable in filters: '@me' (current person), '@today', '@week' (Sunday of the current week), '@week_start' (Monday).
export function resolveValue(v, ctx = {}) {
  if (typeof v !== 'string' || !v.startsWith('@')) return v
  const today = ctx.today || dayKey(new Date())
  if (v === '@me') return ctx.me ?? ''
  if (v === '@today') return today
  const [y, m, d] = today.split('-').map(Number)
  const dow = new Date(y, m - 1, d, 12).getDay()                 // 0 = Sunday
  if (v === '@week') return addDays(today, dow === 0 ? 0 : 7 - dow)
  if (v === '@week_start') return addDays(today, dow === 0 ? -6 : 1 - dow)
  return v
}

export function matches(item, f, ctx = {}) {
  const def = FIELDS[f.field]
  if (!def) return true
  const raw = def.get(item)
  const empty = raw === '' || raw === null || raw === undefined
  if (f.op === 'empty') return empty
  if (f.op === 'not_empty') return !empty
  const val = Array.isArray(f.value) ? f.value.map(v => resolveValue(v, ctx)) : resolveValue(f.value, ctx)
  if (def.type === 'date') {
    if (empty) return f.op === 'neq'                               // an item without date is "not equal" to any date, nothing else matches
    const v = String(val ?? '')
    if (!v) return true                                            // filter without value: ignored while being edited
    return { eq: raw === v, neq: raw !== v, lt: raw < v, gt: raw > v, lte: raw <= v, gte: raw >= v }[f.op] ?? true
  }
  if (def.type === 'text') {
    const a = norm(raw), b = norm(val)
    if (!b) return true
    return { contains: a.includes(b), not_contains: !a.includes(b), eq: a === b, neq: a !== b }[f.op] ?? true
  }
  // enum
  const a = norm(raw)
  if (f.op === 'in' || f.op === 'not_in') {
    const list = (Array.isArray(val) ? val : [val]).filter(x => x !== '' && x != null).map(norm)
    if (!list.length) return true
    return f.op === 'in' ? list.includes(a) : !list.includes(a)
  }
  const b = norm(Array.isArray(val) ? val[0] : val)
  if (!b) return true
  return f.op === 'eq' ? a === b : f.op === 'neq' ? a !== b : true
}

export const applyFilters = (items, filters = [], ctx = {}) => (items || []).filter(i => filters.every(f => matches(i, f, ctx)))

// ── sorting ──
const rank = (field, v) => {
  if (field === 'status') { const i = STATUS_ORDER.indexOf(v); return i < 0 ? 99 : i }
  if (field === 'prioridad') { const i = PRIO_ORDER.indexOf(v); return i < 0 ? 99 : i }
  return null
}
export function compareBy(field, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1
  return (a, b) => {
    const va = FIELDS[field].get(a), vb = FIELDS[field].get(b)
    const ea = va === '' || va == null, eb = vb === '' || vb == null
    if (ea !== eb) return ea ? 1 : -1                              // empty values always last, regardless of direction
    if (ea && eb) return 0
    const ra = rank(field, va), rb = rank(field, vb)
    if (ra !== null) return (ra - rb) * sign
    return String(va).localeCompare(String(vb), 'es', { sensitivity: 'base', numeric: true }) * sign
  }
}
export function sortItems(items, sort = []) {
  const cmps = sort.filter(s => FIELDS[s.field]).map(s => compareBy(s.field, s.dir))
  if (!cmps.length) return [...items]
  return [...items].sort((a, b) => { for (const c of cmps) { const r = c(a, b); if (r) return r } return 0 })
}

// ── grouping ──
export const GROUPABLE = ['status', 'propietario', 'prioridad', 'proyecto', 'category', 'risk', 'due']
export const GROUP_LABEL = { status: 'Estado', propietario: 'Responsable', prioridad: 'Prioridad', proyecto: 'Proyecto', category: 'Área', risk: 'Riesgo', due: 'Vencimiento' }
const DUE_ORDER = ['overdue', 'today', 'week', 'later', 'none']
const DUE_LABEL = { overdue: 'Vencidos', today: 'Hoy', week: 'Esta semana', later: 'Más adelante', none: 'Sin fecha' }

export function groupItems(items, groupBy, ctx = {}) {
  if (!groupBy) return [{ key: '', label: '', items }]
  const today = ctx.today || dayKey(new Date()), weekEnd = resolveValue('@week', { today })
  const keyOf = i => {
    if (groupBy === 'due') {
      const d = toKey(i.fechaFin)
      return !d ? 'none' : d < today ? 'overdue' : d === today ? 'today' : d <= weekEnd ? 'week' : 'later'
    }
    return FIELDS[groupBy].get(i) || ''
  }
  const map = new Map()
  for (const i of items) { const k = keyOf(i); if (!map.has(k)) map.set(k, []); map.get(k).push(i) }
  const labelOf = k => groupBy === 'due' ? DUE_LABEL[k] : k === '' ? 'Sin ' + (GROUP_LABEL[groupBy] || '').toLowerCase() : (FIELDS[groupBy].optionLabel ? FIELDS[groupBy].optionLabel(k) : k)
  const order = groupBy === 'due' ? DUE_ORDER : groupBy === 'status' ? STATUS_ORDER : groupBy === 'prioridad' ? PRIO_ORDER : null
  const keys = [...map.keys()].sort((a, b) => {
    if (a === '' || a === 'none') return b === '' || b === 'none' ? 0 : 1                      // "no value" group last
    if (b === '' || b === 'none') return -1
    if (order) return (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b))
    return String(labelOf(a)).localeCompare(String(labelOf(b)), 'es', { sensitivity: 'base' })
  })
  return keys.map(k => ({ key: k, label: labelOf(k), items: map.get(k) }))
}

// ── built-in views (always available, not stored) ──
const ACTIVE = { field: 'status', op: 'not_in', value: ['done', 'backlog'] }
export const DEFAULT_COLUMNS = ['tema', 'status', 'propietario', 'prioridad', 'proyecto', 'fechaFin']
export const ALL_COLUMNS = ['tema', 'status', 'propietario', 'prioridad', 'proyecto', 'category', 'risk', 'fechaInicio', 'fechaFin']
const cfg = (filters, sort, groupBy = '') => ({ filters, sort, groupBy, columns: DEFAULT_COLUMNS })

export const PRESETS = [
  { id: 'all',       name: 'Todo (activo)',   config: cfg([ACTIVE], [{ field: 'fechaFin', dir: 'asc' }]) },
  { id: 'mine',      name: 'Mis tareas',      config: cfg([{ field: 'propietario', op: 'eq', value: '@me' }, ACTIVE], [{ field: 'fechaFin', dir: 'asc' }, { field: 'prioridad', dir: 'asc' }]) },
  { id: 'urgent',    name: 'Urgentes (P0/P1)', config: cfg([{ field: 'prioridad', op: 'in', value: ['P0', 'P1'] }, ACTIVE], [{ field: 'prioridad', dir: 'asc' }, { field: 'fechaFin', dir: 'asc' }]) },
  { id: 'overdue',   name: 'Vencidos',        config: cfg([{ field: 'fechaFin', op: 'lt', value: '@today' }, ACTIVE], [{ field: 'fechaFin', dir: 'asc' }]) },
  { id: 'blocked',   name: 'Bloqueados',      config: cfg([{ field: 'status', op: 'eq', value: 'blocked' }], [{ field: 'fechaFin', dir: 'asc' }]) },
  { id: 'thisweek',  name: 'Esta semana',     config: cfg([{ field: 'fechaFin', op: 'gte', value: '@today' }, { field: 'fechaFin', op: 'lte', value: '@week' }, ACTIVE], [{ field: 'fechaFin', dir: 'asc' }]) },
  { id: 'byproject', name: 'Por proyecto',    config: cfg([ACTIVE], [{ field: 'fechaFin', dir: 'asc' }], 'proyecto') },
]

// Runs a view config over items. Returns { groups: [{key,label,items}], total }.
export function runView(items, config = {}, ctx = {}) {
  const filtered = applyFilters(items, config.filters || [], ctx)
  const sorted = sortItems(filtered, config.sort || [])
  return { groups: groupItems(sorted, config.groupBy || '', ctx), total: sorted.length }
}

// Sanitises a config coming from storage (unknown fields/operators are dropped so a stale saved view never breaks the screen).
export function normalizeConfig(c) {
  const filters = (Array.isArray(c?.filters) ? c.filters : []).filter(f => FIELDS[f?.field] && OPERATORS[FIELDS[f.field].type][f.op])
  const sort = (Array.isArray(c?.sort) ? c.sort : []).filter(s => FIELDS[s?.field]).map(s => ({ field: s.field, dir: s.dir === 'desc' ? 'desc' : 'asc' }))
  const groupBy = GROUPABLE.includes(c?.groupBy) ? c.groupBy : ''
  const columns = (Array.isArray(c?.columns) ? c.columns : []).filter(k => ALL_COLUMNS.includes(k))
  return { filters, sort, groupBy, columns: columns.length ? columns : DEFAULT_COLUMNS }
}
