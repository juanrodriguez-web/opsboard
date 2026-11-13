// PM backend: reads and writes work_items / projects / people / statuses / comments, and returns the same object
// shapes the UI uses today. `client` is a supabase-js client (injected so the backend can be tested with a fake).
import { unwrap } from '../util.js'
import {
  normName, isUuid, statusKeyFromLegacy, prioToPm, projectStatusFromLegacy, dateFromUi, dateToUi,
  workToItem, projectToApp, workToHito, commentToApp, itemPatchToWork, estadoSheetFor,
} from './mappers.js'

const ITEM_COLS = '*'

export function createPmApi(client, { listCampanas, listPlanAccion } = {}) {
  let refs = null
  const itemCache = new Map()        // appId -> { pmId, legacy }
  const pmToApp = new Map()          // work_items.id -> appId (needed to translate realtime DELETE events)

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
    const rows = unwrap(await client.from('work_items').select(ITEM_COLS).neq('type', 'milestone').order('created_at', { ascending: false }).order('number', { ascending: true }), 'items') || []
    rows.forEach(remember)
    return rows.map(w => workToItem(w, r))
  }

  function itemToWorkRow(item, r, assigneeId) {
    const projectId = item.proyecto ? r.projectIdByNorm.get(normName(item.proyecto)) ?? null : null
    return {
      legacy_source: 'items', legacy_id: item.id, type: 'topic', project_id: projectId,
      title: item.tema || '', description: item.objetivo || '', notes: item.notas || '',
      status_id: r.statusIdByKey.get(statusKeyFromLegacy(item.status || 'pending')),
      priority: prioToPm(item.prioridad || ''), assignee_id: assigneeId,
      start_date: dateFromUi(item.fechaInicio), due_date: dateFromUi(item.fechaFin),
      tags: item.category ? [item.category] : [], risk: item.risk || 'green', legacy_subtareas: item.subtareas || [],
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
        if (payload.eventType === 'DELETE') { onDelete?.(pmToApp.get(payload.old.id) ?? payload.old.id); return }
        const w = payload.new
        if (w.type === 'milestone') return
        let r = await loadRefs()
        const stale = !r.statusKeyById.has(w.status_id) || (w.assignee_id && !r.personNameById.has(w.assignee_id)) || (w.project_id && !r.projectById.has(w.project_id))
        if (stale) r = await loadRefs(true)
        remember(w)
        const item = workToItem(w, r)
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
    if (fields.fecha_inicio !== undefined) p.start_date = dateFromUi(fields.fecha_inicio)
    if (fields.fecha_fin !== undefined) p.target_date = dateFromUi(fields.fecha_fin)
    if (fields.prioridad !== undefined) p.priority = prioToPm(fields.prioridad)
    if (fields.propietario !== undefined) p.owner_id = await ensurePerson(fields.propietario)
    if (fields.status !== undefined) {
      p.legacy_status = fields.status
      p.status = projectStatusFromLegacy(fields.status)
      p.health = fields.status === 'blocked' ? 'at_risk' : 'not_set'
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
  async function loadAll() {
    const [items, proyectos, campanas] = await Promise.all([listItems(), listProyectos(), listCampanas ? listCampanas() : []])
    return { items, proyectos, campanas }
  }

  return {
    loadAll, listItems, insertItems, updateItem, deleteItem, mergeItems, subscribeToItems,
    listProyectos, updateProyecto, insertProyectoRows,
    listHitos, addHito, updateHito, deleteHito, listProyectoComments, addProyectoComment,
    listCampanas, listPlanAccion, findPersonByEmail,
    _test: { loadRefs, dateToUi },
  }
}
