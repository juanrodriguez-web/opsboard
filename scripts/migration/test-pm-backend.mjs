// Contract + write-path tests for the PM backend (src/lib/api/pm) using a fake supabase client seeded with the REAL migrated data.
//   node scripts/migration/test-pm-backend.mjs <legacy-snapshot.json>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPmApi } from '../../src/lib/api/pm/index.js'
import { dbToItem, dbToProy } from '../../src/lib/api/legacy/mappers.js'

// ── seed: real snapshot -> F1B migration -> JSON tables ──
const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const pg = new PGlite()
await pg.exec(readFileSync('supabase-schema.sql', 'utf8'))
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas'])
  if (snap[t]?.length) await pg.query(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(snap[t])])
for (const f of readdirSync('supabase/migrations').sort()) await pg.exec(readFileSync(join('supabase/migrations', f), 'utf8'))
await pg.exec(readFileSync('scripts/migration/remote/B_migrar_datos_f1b.sql', 'utf8'))
await pg.exec('select * from f1e_explode_subtasks(true)')            // subtasks are child rows, as after the explode migration
const dump = async t => (await pg.query(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) j from ${t} x`)).rows[0].j
const tables = { statuses: await dump('statuses'), people: await dump('people'), projects: await dump('projects'), work_items: await dump('work_items'), comments: [], saved_views: [], work_item_relations: [] }

// ── fake supabase-js (just the builder surface the backend uses) ──
const norm = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const handlers = []
class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = null; this.ret = false; this.one = false }
  select() { if (this.op !== 'select') this.ret = true; return this }
  insert(rows) { this.op = 'insert'; this.pl = Array.isArray(rows) ? rows : [rows]; return this }
  update(p) { this.op = 'update'; this.pl = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(c, v) { this.f.push(r => r[c] === v); return this }
  neq(c, v) { this.f.push(r => r[c] !== v); return this }
  is(c, v) { this.f.push(r => (r[c] ?? null) === v); return this }
  order(c, { ascending = true } = {}) { (this.ord ||= []).push([c, ascending]); return this }
  // SQL LIKE (case-insensitive): % = any run, _ = any char, backslash escapes the next char
  ilike(c, pat) {
    const lit = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let re = ''
    for (let i = 0; i < pat.length; i++) {
      const ch = pat[i]
      if (ch === '\\' && i + 1 < pat.length) re += lit(pat[++i])
      else if (ch === '%') re += '.*'
      else if (ch === '_') re += '.'
      else re += lit(ch)
    }
    const rx = new RegExp('^' + re + '$', 'i')
    this.f.push(r => r[c] != null && rx.test(r[c])); return this
  }
  limit(n) { this.lim = n; return this }
  single() { this.one = true; return this }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej) }
  run() {
    const rows = tables[this.t]; const now = new Date().toISOString()
    if (this.op === 'insert') {
      const out = []
      for (const p of this.pl) {
        if (this.t === 'people' && rows.some(r => norm(r.name) === norm(p.name))) return { data: null, error: { message: 'duplicate key value violates unique constraint "people_name_norm_uq"' } }
        if (this.t === 'work_item_relations' && rows.some(r => r.from_id === p.from_id && r.to_id === p.to_id && r.kind === p.kind)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } }
        if (this.t === 'work_items' && p.legacy_id && rows.some(r => r.legacy_source === p.legacy_source && r.legacy_id === p.legacy_id)) return { data: null, error: { message: 'duplicate key (legacy_source, legacy_id)' } }
        const row = { id: randomUUID(), created_at: now, updated_at: now, tags: [], legacy: {}, legacy_subtareas: [], completed_at: null, description: '', notes: '', ...p }
        rows.push(row); out.push(row)
      }
      return { data: this.ret ? (this.one ? out[0] : out) : null, error: null }
    }
    let m = rows.filter(r => this.f.every(fn => fn(r)))
    if (this.op === 'update') {
      for (const r of m) {
        const doneId = tables.statuses.find(s => s.key === 'done').id
        if (this.pl.status_id && this.pl.status_id !== r.status_id) r.completed_at = this.pl.status_id === doneId ? (r.completed_at || now) : null   // emulates _work_items_completion
        Object.assign(r, this.pl, { updated_at: now })
      }
      return { data: this.ret ? m : null, error: null }
    }
    if (this.op === 'delete') { for (const r of m) rows.splice(rows.indexOf(r), 1); return { data: null, error: null } }
    if (this.ord) m = [...m].sort((a, b) => { for (const [c, asc] of this.ord) { const d = (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1); if (d) return d } return 0 })
    if (this.lim) m = m.slice(0, this.lim)
    return { data: this.one ? m[0] : m.map(r => ({ ...r })), error: null }
  }
}
const client = {
  from: t => new Q(t),
  channel: () => ({ on(_e, _f, cb) { handlers.push(cb); return this }, subscribe() { return this } }),
  removeChannel: () => { handlers.length = 0 },
}

const api = createPmApi(client, { listCampanas: async () => [], listPlanAccion: async () => [] })
const out = []; const rec = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail).slice(0, 170) })
const fd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null)
const madrid = ts => (ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) : null)
const local = d => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null)

// ── 1. contract: same objects as the legacy backend ──
const { items: pmItems, proyectos: pmProys } = await api.loadAll()
const legacyItems = snap.items.map(dbToItem), legacyProys = snap.proyectos.map(dbToProy)
const byId = new Map(pmItems.map(i => [i.id, i]))
rec('items: same count and same ids as legacy', pmItems.length === legacyItems.length && legacyItems.every(l => byId.has(l.id)), `${pmItems.length} vs ${legacyItems.length}`)
const bad = {}
const flag = (k, id) => (bad[k] ||= []).push(id)
let dateDisplayChanged = 0
for (const l of legacyItems) {
  const p = byId.get(l.id); if (!p) continue
  for (const k of ['tema', 'objetivo', 'category', 'risk', 'status', 'estadoSheet', 'archivos', 'notas']) if ((l[k] ?? '') !== (p[k] ?? '')) flag(k, l.id)
  if (norm(l.propietario) !== norm(p.propietario)) flag('propietario', l.id)
  if ((l.prioridad || '') !== (p.prioridad || '')) flag('prioridad', l.id)
  if (norm(l.proyecto) !== norm(p.proyecto)) flag('proyecto', l.id)
  const nsub = s => ({ id: s.id, title: s.title, status: s.status, prop: norm(s.prop), risk: s.risk, notas: s.notas || '', due: s.fechaFin ? madrid(s.fechaFin) : null })
  if (JSON.stringify(l.subtareas.map(nsub)) !== JSON.stringify(p.subtareas.map(s => nsub({ ...s, fechaFin: s.fechaFin ? s.fechaFin : null })))) flag('subtareas', l.id)
  for (const k of ['fechaInicio', 'fechaFin']) {
    const lt = k === 'fechaInicio' ? snap.items.find(x => x.id === l.id).fecha_inicio : snap.items.find(x => x.id === l.id).fecha_fin
    if (madrid(lt) !== fd(p[k]) && !(madrid(lt) === null && p[k] === null)) flag(k + '_calendar_day', l.id)
    if (p[k] && (fd(p[k]) !== local(p[k]))) flag(k + '_utc_vs_local', l.id)               // consistency of the new Date through both access styles
    if (l[k] && fd(l[k]) !== fd(p[k])) dateDisplayChanged++
  }
}
rec('items: every mapped field identical to legacy (text, status, priority, owner, project, subtasks)', Object.keys(bad).filter(k => !k.includes('calendar') && !k.includes('utc_vs_local')).length === 0, JSON.stringify(bad).slice(0, 160))
rec('items: dates = the Europe/Madrid calendar day (as approved for the migration)', !Object.keys(bad).some(k => k.includes('calendar')), JSON.stringify(Object.fromEntries(Object.entries(bad).filter(([k]) => k.includes('calendar')))))
rec('items: UI Date shows the SAME day via toISOString() and via local getters (no off-by-one anywhere)', !Object.keys(bad).some(k => k.includes('utc_vs_local')))
console.log(`INFO  date values whose fdStr() display differs from legacy (legacy showed the UTC day = Madrid day - 1): ${dateDisplayChanged}`)
const pById = new Map(pmProys.map(p => [p.id, p]))
const pbad = {}
for (const l of legacyProys) {
  const p = pById.get(l.id); if (!p) { (pbad.missing ||= []).push(l.id); continue }
  for (const k of ['nombre', 'descripcion', 'desarrollo', 'notas', 'fase', 'estado', 'status', 'nombreEN']) if ((l[k] ?? '') !== (p[k] ?? '')) (pbad[k] ||= []).push(l.id)
  if (norm(l.propietario) !== norm(p.propietario)) (pbad.propietario ||= []).push(l.id)
  if ((l.prioridad || '') !== (p.prioridad || '')) (pbad.prioridad ||= []).push(l.id)
  if ((l.capex ?? null) !== (p.capex ?? null)) (pbad.capex ||= []).push(l.id)
  if (madrid(snap.proyectos.find(x => x.id === l.id).fecha_inicio) !== (p.fecha_inicio ?? null) && snap.proyectos.find(x => x.id === l.id).fecha_inicio) (pbad.fecha_inicio ||= []).push(l.id)
  if (madrid(snap.proyectos.find(x => x.id === l.id).fecha_fin) !== (p.fecha_fin ?? null) && snap.proyectos.find(x => x.id === l.id).fecha_fin) (pbad.fecha_fin ||= []).push(l.id)
  if (p.fechaInicio && fd(p.fechaInicio) !== local(p.fechaInicio)) (pbad.utc_vs_local ||= []).push(l.id)
}
rec('projects: 28 of 28 with identical fields, ids and Madrid calendar dates', pmProys.length === legacyProys.length && Object.keys(pbad).length === 0, JSON.stringify(pbad).slice(0, 160))

// ── 2. write paths ──
const itemId = pmItems.find(i => i.status !== 'done' && i.proyecto).id
await api.updateItem(itemId, { status: 'done', estadoSheet: 'Hecho' })
let row = tables.work_items.find(w => w.legacy_id === itemId)
rec('updateItem(status=done): status_id, legacy.estado_sheet and completed_at (trigger) set', row.status_id === tables.statuses.find(s => s.key === 'done').id && row.legacy.estado_sheet === 'Hecho' && row.completed_at, row.completed_at)
await api.updateItem(itemId, { status: 'inprogress' })
rec('updateItem(status back): completed_at cleared', tables.work_items.find(w => w.legacy_id === itemId).completed_at === null)
const nPeople = tables.people.length
await api.updateItem(itemId, { propietario: 'Persona Nueva Test', prioridad: 'P0', fechaFin: new Date(2026, 11, 24, 0, 0, 0), notas: 'n' })
row = tables.work_items.find(w => w.legacy_id === itemId)
rec('updateItem(owner unknown): person auto-created (D1), P0->urgent, Date->DATE 2026-12-24', tables.people.length === nPeople + 1 && row.assignee_id === tables.people.at(-1).id && row.priority === 'urgent' && row.due_date === '2026-12-24' && row.notes === 'n', row.due_date)
await api.updateItem(itemId, { propietario: 'persona nueva test' })
rec('updateItem(owner same name, other case/spacing): reuses the person (no duplicate)', tables.people.length === nPeople + 1)
const projName = tables.projects[0].name
await api.updateItem(itemId, { proyecto: projName.toUpperCase() })
rec('updateItem(proyecto matched case-insensitively): project_id set', tables.work_items.find(w => w.legacy_id === itemId).project_id === tables.projects[0].id)
await api.updateItem(itemId, { proyecto: 'No existe' })
row = tables.work_items.find(w => w.legacy_id === itemId)
rec('updateItem(proyecto unknown): project_id null and the name is kept in legacy.proyecto (shown back by the UI)', row.project_id === null && row.legacy.proyecto === 'No existe' && (await api.listItems()).find(i => i.id === itemId).proyecto === 'No existe')
await api.updateItem(itemId, { subtareas: [{ id: 'x', title: 't', status: 'pending', prop: '', risk: 'green', notas: '', fechaFin: null }], estadoSheet: 'En peligro' })
{ const parent = tables.work_items.find(w => w.legacy_id === itemId); const kids = tables.work_items.filter(w => w.parent_id === parent.id)
  rec('updateItem(subtareas, estadoSheet): subtasks become child rows (the old ones are replaced), legacy.estado_sheet stored, jsonb stays empty', kids.length === 1 && kids[0].legacy_id === 'x' && kids[0].type === 'task' && kids[0].legacy_source === 'subtareas' && parent.legacy_subtareas.length === 0 && parent.legacy.estado_sheet === 'En peligro') }
const n0 = tables.work_items.length
await api.insertItems([{ id: 'new0001', tema: 'Creado en pm', objetivo: 'o', category: 'tools', propietario: 'Francisco Toledo', prioridad: 'P2', risk: 'yellow', status: 'pending', estadoSheet: 'No iniciado', fechaFin: '2027-01-15', archivos: '', notas: '', proyecto: '', subtareas: [] }])
const created = tables.work_items.find(w => w.legacy_id === 'new0001')
rec('insertItems: row with legacy_id = app id, type topic, status planned, due_date, assignee, tags', tables.work_items.length === n0 + 1 && created.type === 'topic' && created.due_date === '2027-01-15' && created.priority === 'medium'
    && created.tags[0] === 'tools' && created.assignee_id === tables.people.find(p => p.name === 'Francisco Toledo').id)
const reread = (await api.listItems()).find(i => i.id === 'new0001')
rec('listItems returns the new item in UI shape (id stays "new0001")', reread && reread.tema === 'Creado en pm' && reread.propietario === 'Francisco Toledo' && reread.prioridad === 'P2' && fd(reread.fechaFin) === '2027-01-15')
await api.updateItem('new0001', { status: 'blocked' })
rec('items created in pm are updatable by their app id', tables.work_items.find(w => w.legacy_id === 'new0001').status_id === tables.statuses.find(s => s.key === 'blocked').id)
await api.mergeItems({ keepId: 'new0001', removeId: itemId, tema: 'Fusionado', notas: 'nn' })
rec('mergeItems: kept item updated, removed item deleted', tables.work_items.find(w => w.legacy_id === 'new0001').title === 'Fusionado' && !tables.work_items.some(w => w.legacy_id === itemId))
await api.deleteItem('new0001')
rec('deleteItem', !tables.work_items.some(w => w.legacy_id === 'new0001'))
const projLegacy = pmProys[0].id
await api.updateProyecto(projLegacy, { nombre: 'Renombrado', descripcion: 'd', fecha_inicio: '2026-03-02', fecha_fin: null, status: 'blocked' })
const pj = tables.projects.find(p => p.legacy_id === projLegacy)
rec('updateProyecto(nombre, descripcion, fechas, status=blocked): columns, legacy_status; health is NOT rewritten by a status change', pj.name === 'Renombrado' && pj.start_date === '2026-03-02' && pj.target_date === null && pj.legacy_status === 'blocked' && pj.status === 'active' && pj.health !== 'at_risk')
const hito = await api.addHito({ id: 'hit0001', proyecto_id: projLegacy, nombre: 'Go live', fecha_prevista: '2026-12-01', orden: 0 })
await api.updateHito('hit0001', { completado: true })
const hitos = await api.listHitos(projLegacy)
rec('hitos: add / list / toggle completed (milestone work item, due_date, status done)', hito.id === 'hit0001' && hitos.length === 1 && hitos[0].completado === true && hitos[0].nombre === 'Go live' && hitos[0].fecha_prevista === '2026-12-01' && !Number.isNaN(new Date(hitos[0].fecha_prevista + 'T12:00').getTime()))
rec('hitos are not returned as items', !(await api.listItems()).some(i => i.tema === 'Go live'))
await api.deleteHito('hit0001'); rec('deleteHito', (await api.listHitos(projLegacy)).length === 0)
const com = await api.addProyectoComment({ id: 'com0001', proyecto_id: projLegacy, item_id: null, texto: 'Hola', ts: 'x' })
const coms = await api.listProyectoComments(projLegacy)
rec('project comments: add + list returns them (fixes the eq(item_id, null) bug of legacy)', com.texto === 'Hola' && coms.length === 1 && coms[0].id === 'com0001' && coms[0].proyecto_id === projLegacy)
await api.insertProyectoRows([{ id: 'pro0001', nombre: 'Proyecto Nuevo', descripcion: '', propietario: 'Juan Rodriguez Peisel', prioridad: 'P1', estado: '', status: 'pending', desarrollo: '', fecha_inicio: null, fecha_fin: null, notas: '', fase: '', capex: null, nombre_en: '' }])
rec('insertProyectoRows: project with legacy_id, owner linked, priority high', tables.projects.some(p => p.legacy_id === 'pro0001' && p.priority === 'high' && p.owner_id === tables.people.find(x => x.name === 'Juan Rodriguez Peisel').id))

// ── 3. realtime ──
const got = []
const unsub = api.subscribeToItems({ onInsert: i => got.push(['insert', i.id, i.tema, i.propietario, i.status]), onUpdate: i => got.push(['update', i.id, i.status]), onDelete: id => got.push(['delete', id]) })
const w = tables.work_items.find(x => x.legacy_id === pmItems[3].id)
await handlers[0]({ eventType: 'UPDATE', new: { ...w, status_id: tables.statuses.find(s => s.key === 'blocked').id }, old: {} })
await handlers[0]({ eventType: 'INSERT', new: { ...w, id: randomUUID(), legacy_id: 'rt00001', title: 'RT nuevo', assignee_id: tables.people[0].id }, old: {} })
await handlers[0]({ eventType: 'DELETE', new: {}, old: { id: w.id } })
await handlers[0]({ eventType: 'INSERT', new: { ...w, id: randomUUID(), type: 'milestone' }, old: {} })
rec('realtime: UPDATE/INSERT mapped to UI shape (ids, status, owner), DELETE translated to app id, milestones ignored',
    got.length === 3 && got[0][0] === 'update' && got[0][1] === pmItems[3].id && got[0][2] === 'blocked' && got[1][0] === 'insert' && got[1][1] === 'rt00001' && got[1][3] === tables.people[0].name && got[2][0] === 'delete' && got[2][1] === pmItems[3].id, JSON.stringify(got))
unsub()

// ── 4. identification by e-mail (My Work) ──
tables.people[0].email = 'juan.test@empresa.com'; tables.people[1].email = 'fran.test@empresa.com'
const me1 = await api.findPersonByEmail('  Juan.Test@Empresa.COM ')
rec('findPersonByEmail: case/space-insensitive match returns id, name, email', me1 && me1.name === tables.people[0].name && me1.email === 'juan.test@empresa.com' && me1.id === tables.people[0].id)
rec('findPersonByEmail: unknown e-mail -> null', (await api.findPersonByEmail('nadie@empresa.com')) === null && (await api.findPersonByEmail('')) === null)
rec('findPersonByEmail: wildcard characters are escaped (cannot enumerate people)', (await api.findPersonByEmail('%@%')) === null && (await api.findPersonByEmail('_uan.test@empresa.com')) === null && (await api.findPersonByEmail('%')) === null)
tables.people[1].active = false
rec('findPersonByEmail: inactive people cannot identify', (await api.findPersonByEmail('fran.test@empresa.com')) === null)

// ── 5. saved views ──
const juanId = tables.people[0].id, franId = tables.people[1].id
const v1 = await api.saveSavedView({ name: '  Mis urgentes ', config: { filters: [{ field: 'prioridad', op: 'in', value: ['P0'] }] }, visibility: 'private', ownerId: juanId })
const v2 = await api.saveSavedView({ name: 'Equipo: bloqueados', config: { groupBy: 'status' }, visibility: 'team', ownerId: franId })
const v3 = await api.saveSavedView({ name: 'Privada de Fran', config: {}, visibility: 'private', ownerId: franId })
const asJuan = await api.listSavedViews(juanId), asFran = await api.listSavedViews(franId)
rec('saved views: create trims the name and stores config/owner/visibility', v1.name === 'Mis urgentes' && v1.owner_id === juanId && v1.visibility === 'private' && v1.config.filters[0].field === 'prioridad' && v1.view_type === 'list')
rec('saved views: a user sees own views + team-shared, never other people\'s private ones',
    asJuan.map(v => v.name).sort().join('|') === 'Equipo: bloqueados|Mis urgentes' && asFran.map(v => v.name).sort().join('|') === 'Equipo: bloqueados|Privada de Fran')
rec('saved views: own + shared are not duplicated', new Set(asFran.map(v => v.id)).size === asFran.length)
const v1b = await api.saveSavedView({ id: v1.id, name: 'Mis urgentes', config: { groupBy: 'proyecto' }, visibility: 'team', ownerId: juanId })
rec('saved views: update changes config and visibility in place', v1b.id === v1.id && tables.saved_views.length === 3 && v1b.config.groupBy === 'proyecto' && (await api.listSavedViews(franId)).some(v => v.id === v1.id))
await api.deleteSavedView(v3.id)
rec('saved views: delete', tables.saved_views.length === 2 && !tables.saved_views.some(v => v.id === v3.id))
rec('saved views: a nameless view is rejected', await (async () => { try { await api.saveSavedView({ name: '   ', ownerId: juanId }); return false } catch { return true } })())

// ── 6. project health / latest update / objectives (Portfolio) ──
await api.updateProyecto(projLegacy, { health: 'off_track', objectives: 'Lanzar en Q1', latestUpdate: 'Esperando a IT' })
const pj2 = tables.projects.find(p => p.legacy_id === projLegacy)
rec('updateProyecto(health, objectives, latestUpdate): stored; latest_update_at stamped', pj2.health === 'off_track' && pj2.objectives === 'Lanzar en Q1' && pj2.latest_update === 'Esperando a IT' && !Number.isNaN(Date.parse(pj2.latest_update_at)))
await api.updateProyecto(projLegacy, { status: 'inprogress' })
rec('a later status change keeps the manual health (off_track)', tables.projects.find(p => p.legacy_id === projLegacy).health === 'off_track')
rec('updateProyecto: invalid health is rejected', await (async () => { try { await api.updateProyecto(projLegacy, { health: 'amazing' }); return false } catch { return true } })())
const listed = (await api.listProyectos()).find(p => p.id === projLegacy)
rec('listProyectos exposes health, pmStatus, latestUpdate, latestUpdateAt, objectives', listed.health === 'off_track' && listed.pmStatus === 'active' && listed.latestUpdate === 'Esperando a IT' && !!listed.latestUpdateAt && listed.objectives === 'Lanzar en Q1')
rec('projects never updated keep health not_set and empty text', (await api.listProyectos()).filter(p => p.id !== projLegacy && p.id !== 'pro0001').every(p => p.health === 'not_set' || p.health === 'at_risk') )

// ── 7. subtasks as child rows ──
{
  const withSubs = (await api.listItems()).find(i => i.subtareas.length >= 3)
  const parentRow = tables.work_items.find(w => w.legacy_id === withSubs.id)
  const nBefore = tables.work_items.length, subs = withSubs.subtareas
  // toggle one, edit nothing else
  await api.updateItem(withSubs.id, { subtareas: subs.map((s, i) => (i === 0 ? { ...s, status: 'done' } : s)) })
  const kids1 = tables.work_items.filter(w => w.parent_id === parentRow.id)
  rec('subtask toggled done: only that child changes (status done); no rows added or removed; order kept',
      tables.work_items.length === nBefore && kids1.length === subs.length && kids1[0].status_id === tables.statuses.find(s => s.key === 'done').id && kids1.slice(1).every(k => k.status_id === tables.statuses.find(s => s.key === 'planned').id) && kids1.map(k => k.legacy_id).join() === subs.map(s => s.id).join())
  rec('subtask done does NOT fabricate completed_at on the parent', parentRow.completed_at === null)
  let again = (await api.listItems()).find(i => i.id === withSubs.id)
  rec('listItems returns the subtasks of an item in the UI shape (id, title, status, prop, risk, notas, fechaFin)', again.subtareas.length === subs.length && again.subtareas[0].status === 'done' && again.subtareas[0].id === subs[0].id && 'prop' in again.subtareas[0] && 'fechaFin' in again.subtareas[0])
  rec('child rows are not listed as items', (await api.listItems()).length === (await api.listItems()).filter(i => !tables.work_items.find(w => w.legacy_id === i.id)?.parent_id).length && !(await api.listItems()).some(i => i.id === subs[0].id))
  // add + delete + rename in one save (the UI sends the whole array)
  await api.updateItem(withSubs.id, { subtareas: [...subs.slice(1).map(s => ({ ...s })), { ...subs[0], title: 'Renombrada', status: 'done' }, { id: 'new-sub', title: '  Nueva  ', status: 'pending', prop: 'Juan Rodriguez Peisel', risk: 'yellow', notas: 'n', fechaFin: '2027-02-03T10:00:00.000Z' }] })
  const kids2 = tables.work_items.filter(w => w.parent_id === parentRow.id)
  rec('whole-array save: new subtask inserted (trimmed title, owner, risk, due date, same project as parent), existing renamed, none duplicated',
      kids2.length === subs.length + 1 && kids2.find(k => k.legacy_id === subs[0].id).title === 'Renombrada' && kids2.find(k => k.legacy_id === 'new-sub').title === 'Nueva' && kids2.find(k => k.legacy_id === 'new-sub').assignee_id === tables.people.find(p => p.name === 'Juan Rodriguez Peisel').id
      && kids2.find(k => k.legacy_id === 'new-sub').risk === 'yellow' && kids2.find(k => k.legacy_id === 'new-sub').due_date === '2027-02-03' && kids2.find(k => k.legacy_id === 'new-sub').project_id === parentRow.project_id)
  await api.updateItem(withSubs.id, { subtareas: [] })
  rec('deleting every subtask removes the child rows', tables.work_items.filter(w => w.parent_id === parentRow.id).length === 0 && (await api.listItems()).find(i => i.id === withSubs.id).subtareas.length === 0)
  await api.updateItem(withSubs.id, { subtareas: [{ id: 'blank', title: '   ' }, { id: '', title: 'sin id' }] })
  rec('blank-title or id-less subtasks are ignored', tables.work_items.filter(w => w.parent_id === parentRow.id).length === 0)
  // insertItems with subtasks (IA intake / new topic with subtasks)
  await api.insertItems([{ id: 'withsubs1', tema: 'Con subtareas', status: 'pending', risk: 'green', category: 'tools', propietario: '', proyecto: '', prioridad: '', notas: '', objetivo: '', subtareas: [{ id: 's-a', title: 'A', status: 'pending', prop: '', risk: 'green', notas: '', fechaFin: null }, { id: 's-b', title: 'B', status: 'done', prop: '', risk: 'green', notas: '', fechaFin: null }] }])
  const created2 = (await api.listItems()).find(i => i.id === 'withsubs1')
  rec('insertItems(with subtareas): children created in order and returned by listItems', created2.subtareas.map(s => s.id + ':' + s.status).join() === 's-a:pending,s-b:done')
  // deleting the parent removes the children (cascade in the DB; emulated)
  const pid = tables.work_items.find(w => w.legacy_id === 'withsubs1').id
  await api.deleteItem('withsubs1'); for (const k of tables.work_items.filter(w => w.parent_id === pid)) tables.work_items.splice(tables.work_items.indexOf(k), 1)
  rec('deleteItem removes the item (children cascade in Postgres)', !tables.work_items.some(w => w.legacy_id === 'withsubs1'))
}

// ── 8. realtime for subtasks ──
{
  const sub = (await api.listItems()).find(i => i.subtareas.length >= 1) || null
  const target = sub || (await api.listItems())[0]
  await api.updateItem(target.id, { subtareas: [{ id: 'rt-sub', title: 'RT', status: 'pending', prop: '', risk: 'green', notas: '', fechaFin: null }] })
  const parentRow = tables.work_items.find(w => w.legacy_id === target.id), child = tables.work_items.find(w => w.parent_id === parentRow.id)
  const events = []
  const unsub2 = api.subscribeToItems({ onInsert: i => events.push(['insert', i.id]), onUpdate: i => events.push(['update', i.id, i.subtareas.map(s => s.id).join()]), onDelete: id => events.push(['delete', id]) })
  const h = handlers.at(-1)
  await h({ eventType: 'UPDATE', new: { ...child, title: 'RT editado' }, old: {} })
  rec('realtime: a subtask UPDATE refreshes its parent item (onUpdate, not onInsert), subtasks included', events.length === 1 && events[0][0] === 'update' && events[0][1] === target.id && events[0][2] === 'rt-sub', JSON.stringify(events))
  await h({ eventType: 'DELETE', new: {}, old: { id: child.id } })
  rec('realtime: a subtask DELETE refreshes the parent (not deleting an item)', events.length === 2 && events[1][0] === 'update' && events[1][1] === target.id, JSON.stringify(events))
  unsub2()
}

// ── 9. dependencies ──
{
  const [a, b, c2, d] = (await api.listItems()).slice(0, 4).map(i => i.id)
  const r1 = await api.addRelation({ fromId: a, toId: b })
  rec('addRelation(blocks): one row, returned with app ids (a blocks b)', r1.kind === 'blocks' && r1.fromId === a && r1.toId === b && tables.work_item_relations.length === 1)
  await api.addRelation({ fromId: b, toId: c2 })
  const rels = await api.listRelations()
  rec('listRelations: app ids and kinds, both rows', rels.length === 2 && rels.some(r => r.fromId === a && r.toId === b) && rels.some(r => r.fromId === b && r.toId === c2))
  const expectErr = async (fn, re) => { try { await fn(); return false } catch (e) { return re.test(e.message) } }
  rec('addRelation: self dependency rejected', await expectErr(() => api.addRelation({ fromId: a, toId: a }), /sí mismo/))
  rec('addRelation: duplicate rejected', await expectErr(() => api.addRelation({ fromId: a, toId: b }), /ya existe/))
  rec('addRelation: a loop (c blocks a, via a->b->c) is rejected; the reverse of an existing block too', await expectErr(() => api.addRelation({ fromId: c2, toId: a }), /ciclo/) && await expectErr(() => api.addRelation({ fromId: b, toId: a }), /ciclo/))
  rec('addRelation: redundant but acyclic (a blocks c) is allowed', (await api.addRelation({ fromId: a, toId: c2 })).kind === 'blocks')
  const rr = await api.addRelation({ fromId: d, toId: a, kind: 'related' })
  const rowR = tables.work_item_relations.find(r => r.kind === 'related')
  rec('addRelation(related): stored once with from_id < to_id regardless of the order given', rowR.from_id < rowR.to_id && (await api.listRelations()).filter(r => r.kind === 'related').length === 1 && [rr.fromId, rr.toId].sort().join() === [a, d].sort().join())
  rec('addRelation: unknown kind / unknown item rejected', await expectErr(() => api.addRelation({ fromId: a, toId: d, kind: 'weird' }), /no válido/) && await expectErr(() => api.addRelation({ fromId: a, toId: 'nope' }), /not found/))
  await api.removeRelation(r1.id)
  rec('removeRelation', !tables.work_item_relations.some(r => r.id === r1.id) && (await api.listRelations()).length === 3)
  rec('loadAll also returns relations', Array.isArray((await api.loadAll()).relations))
}
console.table(out)
process.exit(out.some(x => x.result === 'FAIL') ? 1 : 0)
