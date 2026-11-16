// PM backend: reads and writes work_items / projects / people / statuses / comments, and returns the same object
// shapes the UI uses today. `client` is a supabase-js client (injected so the backend can be tested with a fake).
import { unwrap } from '../util.js'
import {
  normName, isUuid, statusKeyFromLegacy, prioToPm, projectStatusFromLegacy, dateFromUi, dateToUi,
  workToItem, projectToApp, workToHito, commentToApp, itemPatchToWork, estadoSheetFor, statusLegacyFromKey,
} from './mappers.js'
import { wouldCreateCycle } from '../../deps.js'

const ITEM_COLS = '*'

export function createPmApi(client, { listCampanas, listPlanAccion } = {}) {
  let refs = null
  const itemCache = new Map()        // appId -> { pmId, legacy }
  const pmToApp = new Map()          // work_items.id -> appId (needed to translate realtime DELETE events)
  const childParent = new Map()      // subtask work_items.id -> parent work_items.id (realtime DELETE events carry only the id)

  async function loadRefs(force = false) {
    if (refs && !force) return refs
    const [st, pe, pr] = await Promise.all([
      client.from('statuses').select('id, key').is('project_id', null),
      client.from('people').select('id, name'),
      client.from('projects').select('id, legacy_id, name'),
    ])
    const statuses = unwrap(st, 'statuses') || [], people = unwrap(pe, 'people') || [], projects = unwrap(pr, 'projects') || []
    refs = {
      statusKeyById: new Map(statuses.map(s => [s.id, s.key])),
      statusIdByKey: new Map(statuses.map(s => [s.key, s.id])),
      personNameById: new Map(people.map(p => [p.id, p.name])),
      personIdByNorm: new Map(people.map(p => [normName(p.name), p.id])),
      projectById: new Map(projects.map(p => [p.id, p])),
      projectIdByNorm: new Map(projects.map(p => [normName(p.name), p.id])),
      projectIdByLegacy: new Map(projects.filter(p => p.legacy_id).map(p => [p.legacy_id, p.id])),
    }
    return refs
  }

  // Decision D1: a name typed in the UI that is not in `people` creates the person.
  async function ensurePerson(name) {
    const n = normName(name)
    if (!n) return null
    const r = await loadRefs()
    if (r.personIdByNorm.has(n)) return r.personIdByNorm.get(n)
    const { data, error } = await client.from('people').insert({ name: String(name).trim() }).select('id, name').single()
    if (error) {                                  // unique violation from a concurrent insert: reload and use the existing one
      const again = await loadRefs(true)
      if (again.personIdByNorm.has(n)) return again.personIdByNorm.get(n)
      throw new Error('people: ' + error.message)
    }
    r.personIdByNorm.set(n, data.id); r.personNameById.set(data.id, data.name)
    return data.id
  }

  const remember = w => { const appId = w.legacy_id ?? w.id; itemCache.set(appId, { pmId: w.id, legacy: w.legacy || {} }); pmToApp.set(w.id, appId) }

  async function resolveItem(appId) {
    const hit = itemCache.get(appId)
    if (hit) return hit
    let rows = unwrap(await client.from('work_items').select('id, legacy_id, legacy').eq('legacy_source', 'items').eq('legacy_id', appId))
    if (!rows?.length && isUuid(appId)) rows = unwrap(await client.from('work_items').select('id, legacy_id, legacy').eq('id', appId))
    if (!rows?.length) throw new Error('item not found: ' + appId)
    remember(rows[0])
    return itemCache.get(appId) || { pmId: rows[0].id, legacy: rows[0].legacy || {} }
  }

  async function projectUuid(appId) {
    const r = await loadRefs()
    const id = r.projectIdByLegacy.get(appId) ?? (isUuid(appId) ? appId : null)
    if (!id) throw new Error('project not found: ' + appId)
    return id
  }

  // ── items ──────────────────────────────────────────────────────
  async function listItems() {
    const r = await loadRefs(true)
    const all = unwrap(await client.from('work_items').select(ITEM_COLS).neq('type', 'milestone').order('created_at', { ascending: false }).order('number', { ascending: true }), 'items') || []
    const rows = all.filter(w => !w.parent_id)
    const kids = groupChildren(all.filter(w => w.parent_id))
    rows.forEach(remember)
    return rows.map(w => workToItem(w, r, kids.get(w.id) || null))
  }

  // Subtasks are child work_items. Children are grouped by parent in creation order (work_items.number).
  function groupChildren(children) {
    const m = new Map()
    for (const c of [...children].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
      childParent.set(c.id, c.parent_id)
      if (!m.has(c.parent_id)) m.set(c.parent_id, [])
      m.get(c.parent_id).push(c)
    }
    return m
  }

  async function fetchItem(pmId) {
    const r = await loadRefs()
    const rows = unwrap(await client.from('work_items').select(ITEM_COLS).eq('id', pmId)) || []
    if (!rows.length || rows[0].parent_id || rows[0].type === 'milestone') return null
    const kids = unwrap(await client.from('work_items').select(ITEM_COLS).eq('parent_id', pmId).order('number', { ascending: true })) || []
    kids.forEach(c => childParent.set(c.id, c.parent_id))
    remember(rows[0])
    return workToItem(rows[0], r, kids)
  }

  // Makes the children of `parentPmId` equal to `desired` (the UI's full subtasks array): insert new, update changed, delete removed.
  async function syncSubtasks(parentPmId, desired) {
    const r = await loadRefs()
    const parent = (unwrap(await client.from('work_items').select('id, project_id').eq('id', parentPmId)) || [])[0]
    if (!parent) throw new Error('item not found')
    const current = unwrap(await client.from('work_items').select(ITEM_COLS).eq('parent_id', parentPmId).order('number', { ascending: true })) || []
    const cur = new Map(current.map(c => [c.legacy_id ?? c.id, c]))
    const want = (desired || []).filter(s => s && s.id && String(s.title || '').trim())
    const wantIds = new Set(want.map(s => s.id))
    for (const c of current) if (!wantIds.has(c.legacy_id ?? c.id)) { unwrap(await client.from('work_items').delete().eq('id', c.id)); childParent.delete(c.id) }
    const inserts = []
    for (const s of want) {
      const row = {
        title: String(s.title).trim(), notes: s.notas || '', risk: ['green', 'yellow', 'red'].includes(s.risk) ? s.risk : null,
        status_id: r.statusIdByKey.get(statusKeyFromLegacy(s.status || 'pending')) ?? r.statusIdByKey.get('planned'),
        assignee_id: s.prop ? r.personIdByNorm.get(normName(s.prop)) ?? null : null, due_date: dateFromUi(s.fechaFin),
      }
      const c = cur.get(s.id)
      if (!c) { inserts.push({ legacy_source: 'subtareas', legacy_id: s.id, type: 'task', parent_id: parentPmId, project_id: parent.project_id, tags: [], ...row }); continue }
      const changed = c.title !== row.title || (c.notes || '') !== row.notes || (c.risk ?? null) !== row.risk || c.status_id !== row.status_id
        || (c.assignee_id ?? null) !== row.assignee_id || (c.due_date ?? null) !== row.due_date
      if (changed) unwrap(await client.from('work_items').update(row).eq('id', c.id))
    }
    if (inserts.length) { const data = unwrap(await client.from('work_items').insert(inserts).select('id, parent_id')); (data || []).forEach(c => childParent.set(c.id, c.parent_id)) }
  }

  function itemToWorkRow(item, r, assigneeId) {
    const projectId = item.proyecto ? r.projectIdByNorm.get(normName(item.proyecto)) ?? null : null
    return {
      legacy_source: 'items', legacy_id: item.id, type: 'topic', project_id: projectId,
      title: item.tema || '', description: item.objetivo || '', notes: item.notas || '',
      status_id: r.statusIdByKey.get(statusKeyFromLegacy(item.status || 'pending')),
      priority: prioToPm(item.prioridad || ''), assignee_id: assigneeId,
      start_date: dateFromUi(item.fechaInicio), due_date: dateFromUi(item.fechaFin),
      tags: item.category ? [item.category] : [], risk: item.risk || 'green', legacy_subtareas: [],
      estimate_h: item.estimateH === null || item.estimateH === undefined || item.estimateH === '' ? null : Number(item.estimateH),
      legacy: { estado_sheet: item.estadoSheet || estadoSheetFor(item.status || 'pending'), archivos: item.archivos || '', category: item.category || 'projects',
                proyecto: projectId ? '' : (item.proyecto || '') },
    }
  }

  async function insertItems(items) {
    const r = await loadRefs()
    const rows = []
    for (const item of items) rows.push(itemToWorkRow(item, r, await ensurePerson(item.propietario)))
    const data = unwrap(await client.from('work_items').insert(rows).select('id, legacy_id, legacy'))
    ;(data || []).forEach(remember)
    for (const item of items) {                                   // subtasks of the new items become child rows
      if (!Array.isArray(item.subtareas) || !item.subtareas.length) continue
      const parent = (data || []).find(d => d.legacy_id === item.id)
      if (parent) await syncSubtasks(parent.id, item.subtareas)
    }
  }

  async function updateItem(id, fields) {
    const r = await loadRefs()
    const it = await resolveItem(id)
    const ctx = {
      statusIdFor: s => r.statusIdByKey.get(statusKeyFromLegacy(s)),
      assigneeId: fields.propietario !== undefined ? await ensurePerson(fields.propietario) : undefined,
      projectId: fields.proyecto !== undefined ? (fields.proyecto ? r.projectIdByNorm.get(normName(fields.proyecto)) ?? null : null) : undefined,
    }
    const patch = itemPatchToWork(fields, ctx)
    if (fields.estadoSheet !== undefined || fields.archivos !== undefined || fields.proyecto !== undefined) {
      const legacy = { ...it.legacy }
      if (fields.estadoSheet !== undefined) legacy.estado_sheet = fields.estadoSheet
      if (fields.archivos !== undefined) legacy.archivos = fields.archivos
      if (fields.proyecto !== undefined) legacy.proyecto = ctx.projectId ? '' : (fields.proyecto || '')
      patch.legacy = legacy
      it.legacy = legacy
    }
    if (fields.subtareas !== undefined) { await syncSubtasks(it.pmId, fields.subtareas); patch.legacy_subtareas = [] }   // child rows are the source of truth
    if (!Object.keys(patch).length) return
    unwrap(await client.from('work_items').update(patch).eq('id', it.pmId))
  }

  async function deleteItem(id) {
    const it = await resolveItem(id)
    unwrap(await client.from('work_items').delete().eq('id', it.pmId))
    itemCache.delete(id); pmToApp.delete(it.pmId)
  }

  async function mergeItems({ keepId, removeId, tema, notas }) {
    await updateItem(keepId, { tema, notas })
    await deleteItem(removeId)
  }

  function subscribeToItems({ onInsert, onUpdate, onDelete }) {
    const channel = client
      .channel('work-items-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items' }, async payload => {
        if (payload.eventType === 'DELETE') {
          const parent = childParent.get(payload.old.id)               // a subtask was removed: refresh its parent item
          if (parent) { childParent.delete(payload.old.id); const it = await fetchItem(parent); if (it) onUpdate?.(it); return }
          onDelete?.(pmToApp.get(payload.old.id) ?? payload.old.id); return
        }
        const w = payload.new
        if (w.type === 'milestone') return
        if (w.parent_id) { const it = await fetchItem(w.parent_id); if (it) onUpdate?.(it); return }   // subtask insert/update -> parent
        let r = await loadRefs()
        const stale = !r.statusKeyById.has(w.status_id) || (w.assignee_id && !r.personNameById.has(w.assignee_id)) || (w.project_id && !r.projectById.has(w.project_id))
        if (stale) r = await loadRefs(true)
        remember(w)
        const kids = unwrap(await client.from('work_items').select(ITEM_COLS).eq('parent_id', w.id).order('number', { ascending: true })) || []
        const item = workToItem(w, r, kids)
        if (payload.eventType === 'INSERT') onInsert?.(item)
        else if (payload.eventType === 'UPDATE') onUpdate?.(item)
      })
      .subscribe()
    return () => client.removeChannel(channel)
  }

  // ── projects ───────────────────────────────────────────────────
  async function listProyectos() {
    const r = await loadRefs(true)
    const rows = unwrap(await client.from('projects').select('*').order('created_at', { ascending: false }), 'proyectos') || []
    return rows.map(p => projectToApp(p, r))
  }

  const PROJECT_COLS = { nombre: 'name', nombre_en: 'name_en', descripcion: 'description', desarrollo: 'desarrollo', fase: 'fase', capex: 'capex', notas: 'notes', estado: 'legacy_estado' }

  async function projectPatch(fields) {
    const p = {}
    for (const [k, col] of Object.entries(PROJECT_COLS)) if (fields[k] !== undefined) p[col] = fields[k] === '' && k === 'nombre_en' ? null : fields[k]
    if (fields.health !== undefined) {
      if (!['on_track', 'at_risk', 'off_track', 'not_set'].includes(fields.health)) throw new Error('Salud no válida: ' + fields.health)
      p.health = fields.health
    }
    if (fields.objectives !== undefined) p.objectives = fields.objectives
    if (fields.latestUpdate !== undefined) { p.latest_update = fields.latestUpdate; p.latest_update_at = new Date().toISOString() }
    if (fields.fecha_inicio !== undefined) p.start_date = dateFromUi(fields.fecha_inicio)
    if (fields.fecha_fin !== undefined) p.target_date = dateFromUi(fields.fecha_fin)
    if (fields.prioridad !== undefined) p.priority = prioToPm(fields.prioridad)
    if (fields.propietario !== undefined) p.owner_id = await ensurePerson(fields.propietario)
    if (fields.status !== undefined) {
      p.legacy_status = fields.status
      p.status = projectStatusFromLegacy(fields.status)   // health is manual and independent of status
    }
    return p
  }

  async function updateProyecto(id, fields) {
    const pmId = await projectUuid(id)
    const patch = await projectPatch(fields)
    if (!Object.keys(patch).length) return
    unwrap(await client.from('projects').update(patch).eq('id', pmId))
    refs = null
  }

  async function insertProyectoRows(rows) {
    const out = []
    for (const row of rows) {
      const p = await projectPatch(row)
      out.push({ legacy_id: row.id, ...p, name: p.name ?? row.nombre ?? 'Sin nombre' })
    }
    unwrap(await client.from('projects').insert(out), 'proyectos')
    refs = null
  }

  // ── milestones ─────────────────────────────────────────────────
  async function listHitos(proyectoId) {
    const r = await loadRefs()
    const pid = await projectUuid(proyectoId)
    const rows = unwrap(await client.from('work_items').select('*').eq('type', 'milestone').eq('project_id', pid).order('created_at', { ascending: true })) || []
    return rows.map(w => workToHito(w, r)).sort((a, b) => a.orden - b.orden)
  }

  async function addHito(row) {
    const r = await loadRefs()
    const pid = await projectUuid(row.proyecto_id)
    const data = unwrap(await client.from('work_items').insert({
      legacy_source: 'hitos', legacy_id: row.id, type: 'milestone', project_id: pid, title: row.nombre, due_date: dateFromUi(row.fecha_prevista),
      status_id: r.statusIdByKey.get('planned'), tags: [], legacy: { orden: row.orden ?? 0, completado: false },
    }).select('*'))
    return data?.[0] ? workToHito(data[0], r) : undefined
  }

  async function hitoPmId(id) {
    const rows = unwrap(await client.from('work_items').select('id, legacy').eq('legacy_source', 'hitos').eq('legacy_id', id))
    if (rows?.length) return rows[0]
    if (isUuid(id)) { const byId = unwrap(await client.from('work_items').select('id, legacy').eq('id', id)); if (byId?.length) return byId[0] }
    throw new Error('hito not found: ' + id)
  }

  async function updateHito(id, fields) {
    const r = await loadRefs()
    const h = await hitoPmId(id)
    const patch = {}
    if (fields.completado !== undefined) { patch.status_id = r.statusIdByKey.get(fields.completado ? 'done' : 'planned'); patch.legacy = { ...(h.legacy || {}), completado: fields.completado } }
    if (fields.nombre !== undefined) patch.title = fields.nombre
    if (fields.fecha_prevista !== undefined) patch.due_date = dateFromUi(fields.fecha_prevista)
    if (!Object.keys(patch).length) return
    unwrap(await client.from('work_items').update(patch).eq('id', h.id))
  }

  async function deleteHito(id) {
    const h = await hitoPmId(id)
    unwrap(await client.from('work_items').delete().eq('id', h.id))
  }

  // ── project comments ───────────────────────────────────────────
  async function listProyectoComments(proyectoId) {
    const pid = await projectUuid(proyectoId)
    const rows = unwrap(await client.from('comments').select('*').eq('project_id', pid).order('created_at', { ascending: false })) || []
    return rows.map(c => commentToApp(c, proyectoId))
  }

  async function addProyectoComment(row) {
    const pid = await projectUuid(row.proyecto_id)
    const data = unwrap(await client.from('comments').insert({ project_id: pid, body: row.texto, legacy_ref: 'comentarios:' + row.id }).select('*'))
    return data?.[0] ? commentToApp(data[0], row.proyecto_id) : undefined
  }

  // Identifies a person by e-mail (no password: this is identification, not authentication).
  // Only the matching row is requested; wildcard characters typed by the user are escaped.
  async function findPersonByEmail(email) {
    const e = String(email || '').trim().toLowerCase()
    if (!e) return null
    const rows = unwrap(await client.from('people').select('id, name, email').eq('active', true).ilike('email', e.replace(/[\\%_]/g, m => '\\' + m)).limit(1))
    return rows && rows[0] ? { id: rows[0].id, name: rows[0].name, email: rows[0].email } : null
  }
  // ── saved views (table saved_views; see supabase/migrations/20261113120000_saved_views.sql) ──
  // Own views plus the ones shared with the team/workspace.
  async function listSavedViews(ownerId) {
    const mine = ownerId ? unwrap(await client.from('saved_views').select('*').eq('owner_id', ownerId).order('name', { ascending: true }), 'saved_views') || [] : []
    const shared = unwrap(await client.from('saved_views').select('*').neq('visibility', 'private').order('name', { ascending: true }), 'saved_views') || []
    const seen = new Set(mine.map(v => v.id))
    return [...mine, ...shared.filter(v => !seen.has(v.id))]
  }
  async function saveSavedView({ id, name, config, visibility = 'private', ownerId, viewType = 'list' }) {
    if (!String(name || '').trim()) throw new Error('La vista necesita un nombre')
    const row = { name: String(name).trim(), config: config || {}, visibility, owner_id: ownerId, view_type: viewType }
    if (id) {
      const data = unwrap(await client.from('saved_views').update(row).eq('id', id).select('*'))
      return data && data[0]
    }
    const data = unwrap(await client.from('saved_views').insert(row).select('*'))
    return data && data[0]
  }
  async function deleteSavedView(id) { unwrap(await client.from('saved_views').delete().eq('id', id)) }
  // ── dependencies (work_item_relations) ─────────────────────────
  // UI shape: { id, kind: 'blocks' | 'related', fromId, toId } with app item ids. A 'blocks' row means fromId blocks toId.
  async function listRelations() {
    const rows = unwrap(await client.from('work_item_relations').select('*'), 'relations') || []
    return rows.map(r => ({ id: r.id, kind: r.kind, fromId: pmToApp.get(r.from_id), toId: pmToApp.get(r.to_id) })).filter(r => r.fromId && r.toId)
  }

  async function addRelation({ fromId, toId, kind = 'blocks' }) {
    if (!['blocks', 'related'].includes(kind)) throw new Error('Tipo de relación no válido')
    const a = await resolveItem(fromId), b = await resolveItem(toId)
    if (a.pmId === b.pmId) throw new Error('Un tema no puede depender de sí mismo')
    let from = a.pmId, to = b.pmId
    if (kind === 'related' && from > to) [from, to] = [to, from]            // symmetric relations are stored once with from < to
    if (kind === 'blocks') {
      const edges = (unwrap(await client.from('work_item_relations').select('from_id, to_id, kind').eq('kind', 'blocks')) || []).map(r => ({ kind: 'blocks', fromId: r.from_id, toId: r.to_id }))
      if (wouldCreateCycle(edges, from, to)) throw new Error('Esta dependencia crearía un ciclo')
    }
    const { data, error } = await client.from('work_item_relations').insert({ from_id: from, to_id: to, kind }).select('*').single()
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Esa relación ya existe' : 'relations: ' + error.message)
    return { id: data.id, kind: data.kind, fromId: pmToApp.get(data.from_id), toId: pmToApp.get(data.to_id) }
  }

  async function removeRelation(id) { unwrap(await client.from('work_item_relations').delete().eq('id', id)) }

  // ── checklists (work_item_checklists + checklist_items) ────────
  // One checklist per item (created on first use). UI shape: { id, items: [{ id, text, done }] }.
  const toCheckItem = r => ({ id: r.id, text: r.text, done: !!r.done })
  async function ensureChecklist(appId, create) {
    const { pmId } = await resolveItem(appId)
    const lists = unwrap(await client.from('work_item_checklists').select('*').eq('work_item_id', pmId).order('position', { ascending: true })) || []
    if (lists.length) return lists[0]
    if (!create) return null
    const { data, error } = await client.from('work_item_checklists').insert({ work_item_id: pmId, title: 'Checklist', position: 0 }).select('*').single()
    if (error) throw new Error('checklist: ' + error.message)
    return data
  }
  async function getChecklist(appId) {
    const cl = await ensureChecklist(appId, false)
    if (!cl) return { id: null, items: [] }
    const rows = unwrap(await client.from('checklist_items').select('*').eq('checklist_id', cl.id).order('position', { ascending: true })) || []
    return { id: cl.id, items: rows.map(toCheckItem) }
  }
  async function addChecklistItem(appId, text) {
    const clean = String(text || '').trim()
    if (!clean) throw new Error('El elemento necesita un texto')
    const cl = await ensureChecklist(appId, true)
    const last = unwrap(await client.from('checklist_items').select('position').eq('checklist_id', cl.id).order('position', { ascending: false }).limit(1)) || []
    const { data, error } = await client.from('checklist_items').insert({ checklist_id: cl.id, text: clean, position: last.length ? last[0].position + 1 : 0 }).select('*').single()
    if (error) throw new Error('checklist: ' + error.message)
    return toCheckItem(data)
  }
  async function updateChecklistItem(id, fields) {
    const patch = {}
    if (fields.text !== undefined) { const t = String(fields.text).trim(); if (!t) throw new Error('El elemento necesita un texto'); patch.text = t }
    if (fields.done !== undefined) { patch.done = !!fields.done; patch.done_at = fields.done ? new Date().toISOString() : null }
    if (!Object.keys(patch).length) return
    unwrap(await client.from('checklist_items').update(patch).eq('id', id))
  }
  async function deleteChecklistItem(id) { unwrap(await client.from('checklist_items').delete().eq('id', id)) }
  // { [appId]: { done, total } } for items that have a checklist (for the progress badge on cards)
  async function listChecklistProgress() {
    const lists = unwrap(await client.from('work_item_checklists').select('id, work_item_id')) || []
    if (!lists.length) return {}
    const rows = unwrap(await client.from('checklist_items').select('checklist_id, done')) || []
    const itemOf = new Map(lists.map(l => [l.id, pmToApp.get(l.work_item_id)]))
    const out = {}
    for (const r of rows) { const app = itemOf.get(r.checklist_id); if (!app) continue; const p = out[app] || (out[app] = { done: 0, total: 0 }); p.total++; if (r.done) p.done++ }
    return out
  }

  // ── workload (people.capacity_h = weekly hours; work_items.estimate_h = effort) ──
  async function listPeople() {
    const rows = unwrap(await client.from('people').select('id, name, email, capacity_h, active').eq('active', true).order('name', { ascending: true })) || []
    return rows.map(p => ({ id: p.id, name: p.name, email: p.email || '', capacityH: p.capacity_h === null || p.capacity_h === undefined ? null : Number(p.capacity_h) }))
  }
  async function updatePersonCapacity(id, hours) {
    let v = null
    if (hours !== null && hours !== '' && hours !== undefined) { v = Number(hours); if (!Number.isFinite(v) || v < 0 || v > 168) throw new Error('La capacidad semanal debe estar entre 0 y 168 horas') }
    unwrap(await client.from('people').update({ capacity_h: v }).eq('id', id))
    return v
  }

  async function loadAll() {    const [items, proyectos, campanas] = await Promise.all([listItems(), listProyectos(), listCampanas ? listCampanas() : []])
    const relations = await listRelations().catch(() => [])      // after listItems so app ids are known
    return { items, proyectos, campanas, relations }
  }

  return {
    loadAll, listItems, insertItems, updateItem, deleteItem, mergeItems, subscribeToItems,
    listProyectos, updateProyecto, insertProyectoRows,
    listHitos, addHito, updateHito, deleteHito, listProyectoComments, addProyectoComment,
    listCampanas, listPlanAccion, findPersonByEmail,
    listSavedViews, saveSavedView, deleteSavedView, listRelations, addRelation, removeRelation,
    listPeople, updatePersonCapacity,
    getChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem, listChecklistProgress,
    _test: { loadRefs, dateToUi },
  }
}
