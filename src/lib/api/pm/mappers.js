// Pure mapping functions: PM model (work_items / projects / people / statuses) <-> the object shapes the UI already uses.
// Values mirror the SQL mappings in supabase/migrations/20261111120000_f1d_sync.sql (f1d_* functions).

export const normName = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
export const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s))

// ── status / priority ────────────────────────────────────────────
const STATUS_KEY = { pending: 'planned', inprogress: 'in_progress', blocked: 'blocked', done: 'done', backlog: 'backlog' }
const STATUS_LEGACY = { planned: 'pending', in_progress: 'inprogress', review: 'inprogress', blocked: 'blocked', done: 'done', cancelled: 'done', backlog: 'backlog' }
const ESTADO_SHEET = { pending: 'No iniciado', inprogress: 'Según lo planificado', blocked: 'En peligro', done: 'Hecho', backlog: 'No iniciado' }
export const statusKeyFromLegacy = s => STATUS_KEY[s]
export const statusLegacyFromKey = k => STATUS_LEGACY[k] || 'pending'
export const estadoSheetFor = legacyStatus => ESTADO_SHEET[legacyStatus] || 'No iniciado'

const PRIO_PM = { P0: 'urgent', P1: 'high', P2: 'medium', P3: 'low' }
const PRIO_LEGACY = { urgent: 'P0', high: 'P1', medium: 'P2', low: 'P3' }
export const prioToPm = p => PRIO_PM[p] ?? null
export const prioToLegacy = p => PRIO_LEGACY[p] ?? ''

const PSTATUS = { pending: 'planning', backlog: 'planning', inprogress: 'active', blocked: 'active', done: 'completed' }
const PSTATUS_LEGACY = { planning: 'pending', active: 'inprogress', on_hold: 'blocked', completed: 'done', cancelled: 'done' }
export const projectStatusFromLegacy = s => PSTATUS[s] ?? 'planning'
export const projectStatusToLegacy = s => PSTATUS_LEGACY[s] ?? 'pending'

// ── dates ────────────────────────────────────────────────────────
// DB: DATE ('YYYY-MM-DD'). UI: a Date. A Date at LOCAL NOON shows the same calendar day through both access styles the UI
// uses (toISOString().slice(0,10) and local getters), unlike midnight instants which show the previous day in UTC.
export const dateToUi = d => (d ? new Date(`${d}T12:00:00`) : null)
const madridParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
export function dateFromUi(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return madridParts.format(d)                      // calendar day in Europe/Madrid
}

// ── rows -> UI shapes ────────────────────────────────────────────
export function workToItem(w, refs) {
  const status = statusLegacyFromKey(refs.statusKeyById.get(w.status_id))
  const legacy = w.legacy || {}
  return {
    id: w.legacy_id ?? w.id,
    _pmId: w.id,
    tema: w.title,
    objetivo: w.description || '',
    category: (w.tags && w.tags[0]) || legacy.category || 'projects',
    propietario: refs.personNameById.get(w.assignee_id) || '',
    prioridad: prioToLegacy(w.priority),
    risk: w.risk || 'green',
    status,
    estadoSheet: legacy.estado_sheet || estadoSheetFor(status),
    fechaInicio: dateToUi(w.start_date),
    fechaFin: dateToUi(w.due_date),
    archivos: legacy.archivos || '',
    notas: w.notes || '',
    proyecto: refs.projectById.get(w.project_id)?.name || legacy.proyecto || '',
    subtareas: Array.isArray(w.legacy_subtareas) ? w.legacy_subtareas : [],
    created_at: w.created_at,
    updated_at: w.updated_at,
  }
}

export function projectToApp(p, refs) {
  const legacyStatus = p.legacy_status || projectStatusToLegacy(p.status)
  const row = {
    id: p.legacy_id ?? p.id,
    _pmId: p.id,
    nombre: p.name,
    nombre_en: p.name_en || '',
    descripcion: p.description || '',
    propietario: refs.personNameById.get(p.owner_id) || '',
    prioridad: prioToLegacy(p.priority),
    estado: p.legacy_estado || '',
    status: legacyStatus,
    desarrollo: p.desarrollo || '',
    fecha_inicio: p.start_date || null,           // 'YYYY-MM-DD': usable directly by <input type="date">
    fecha_fin: p.target_date || null,
    notas: p.notes || '',
    fase: p.fase || '',
    capex: p.capex === null || p.capex === undefined ? null : Number(p.capex),
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
  return { ...row, fechaInicio: dateToUi(p.start_date), fechaFin: dateToUi(p.target_date), nombreEN: row.nombre_en }
}

export function workToHito(w, refs) {
  const legacy = w.legacy || {}
  const done = refs.statusKeyById.get(w.status_id) === 'done'
  return { id: w.legacy_id ?? w.id, proyecto_id: refs.projectById.get(w.project_id)?.legacy_id ?? w.project_id, nombre: w.title,
           descripcion: w.description || '', fecha_prevista: w.due_date ? dateToUi(w.due_date).toISOString() : null,
           completado: done, orden: Number(legacy.orden ?? 0), created_at: w.created_at }
}

export function commentToApp(c, projectLegacyId) {
  return { id: c.legacy_ref ? c.legacy_ref.replace(/^comentarios:/, '') : c.id, proyecto_id: projectLegacyId, item_id: null, texto: c.body,
           ts: new Date(c.created_at).toLocaleString('es-ES'), created_at: c.created_at }
}

// ── UI patches -> columns ────────────────────────────────────────
// `fields` is the camelCase patch the UI sends to onItemChange. `ctx` supplies lookups (async-resolved by the caller).
export function itemPatchToWork(fields, ctx) {
  const p = {}
  if (fields.tema !== undefined) p.title = fields.tema
  if (fields.objetivo !== undefined) p.description = fields.objetivo
  if (fields.notas !== undefined) p.notes = fields.notas
  if (fields.risk !== undefined) p.risk = fields.risk
  if (fields.prioridad !== undefined) p.priority = prioToPm(fields.prioridad)
  if (fields.fechaInicio !== undefined) p.start_date = dateFromUi(fields.fechaInicio)
  if (fields.fechaFin !== undefined) p.due_date = dateFromUi(fields.fechaFin)
  if (fields.category !== undefined) p.tags = fields.category ? [fields.category] : []
  if (fields.subtareas !== undefined) p.legacy_subtareas = fields.subtareas
  if (fields.status !== undefined) p.status_id = ctx.statusIdFor(fields.status)
  if (fields.propietario !== undefined) p.assignee_id = ctx.assigneeId
  if (fields.proyecto !== undefined) p.project_id = ctx.projectId
  return p
}
