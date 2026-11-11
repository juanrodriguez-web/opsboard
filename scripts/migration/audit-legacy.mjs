// READ-ONLY audit of the legacy OpsBoard model (items / proyectos / hitos / plan_accion / campanas).
// Uses only SELECT with the public anon key from .env.local. Never writes.
//   node scripts/migration/audit-legacy.mjs [--json]
import 'dotenv/config'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) { console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local'); process.exit(1) }
const sb = createClient(url, key, { auth: { persistSession: false } })

export const norm = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const count = (rows, f) => { const m = {}; for (const r of rows) { const k = JSON.stringify(f(r) ?? null); m[k] = (m[k] || 0) + 1 } return m }

async function all(table) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999)
    if (error) return { error: error.message, rows: [] }
    out.push(...data)
    if (data.length < 1000) break
  }
  return { rows: out }
}

const [I, P, H, PA, CA, CO] = await Promise.all(['items', 'proyectos', 'hitos', 'plan_accion', 'campanas', 'comentarios'].map(all))
const items = I.rows, proys = P.rows
const R = { generated_at: new Date().toISOString(), tables: {}, findings: {} }
for (const [n, t] of [['items', I], ['proyectos', P], ['hitos', H], ['plan_accion', PA], ['campanas', CA], ['comentarios', CO]])
  R.tables[n] = t.error ? { error: t.error } : { rows: t.rows.length, columns: Object.keys(t.rows[0] || {}) }

R.findings.items_status = count(items, r => r.status)
R.findings.items_estado_sheet = count(items, r => r.estado_sheet)
R.findings.items_prioridad = count(items, r => r.prioridad)
R.findings.items_risk = count(items, r => r.risk)
R.findings.items_category = count(items, r => r.category)
R.findings.items_owner = count(items, r => r.propietario)
R.findings.proyectos_status = count(proys, r => r.status)
R.findings.proyectos_estado = count(proys, r => r.estado)
R.findings.proyectos_prioridad = count(proys, r => r.prioridad)
R.findings.proyectos_owner = count(proys, r => r.propietario)
R.findings.proyectos_fase = count(proys, r => r.fase)

// project linkage
const pByNorm = {}
for (const p of proys) (pByNorm[norm(p.nombre)] ||= []).push(p)
R.findings.proyectos_duplicados_normalizados = Object.entries(pByNorm).filter(([, v]) => v.length > 1).map(([k, v]) => ({ norm: k, ids: v.map(x => x.id), nombres: v.map(x => x.nombre) }))
const itemsNoProject = items.filter(i => !norm(i.proyecto))
const unmatched = {}, exactMismatch = {}
for (const i of items) {
  const n = norm(i.proyecto); if (!n) continue
  if (!pByNorm[n]) (unmatched[i.proyecto] ||= []).push(i.id)
  else if (!proys.some(p => p.nombre === i.proyecto)) (exactMismatch[i.proyecto] ||= []).push(i.id)
}
R.findings.items_sin_proyecto = { count: itemsNoProject.length, ids: itemsNoProject.map(i => i.id) }
R.findings.items_proyecto_sin_match = Object.entries(unmatched).map(([p, ids]) => ({ proyecto: p, items: ids.length, ids }))
R.findings.items_proyecto_match_solo_tras_normalizar = Object.entries(exactMismatch).map(([p, ids]) => ({ proyecto: p, items: ids.length }))
R.findings.items_proyecto_ambiguo = items.filter(i => (pByNorm[norm(i.proyecto)] || []).length > 1).map(i => i.id)
R.findings.proyectos_sin_items = proys.filter(p => !items.some(i => norm(i.proyecto) === norm(p.nombre))).map(p => ({ id: p.id, nombre: p.nombre }))

// ids
R.findings.items_ids_duplicados = Object.entries(count(items, r => r.id)).filter(([, n]) => n > 1)
R.findings.items_sin_titulo = items.filter(i => !norm(i.tema)).map(i => i.id)
R.findings.items_fecha_fin_antes_inicio = items.filter(i => i.fecha_inicio && i.fecha_fin && new Date(i.fecha_fin) < new Date(i.fecha_inicio)).map(i => i.id)
R.findings.items_done_sin_fecha_fin = items.filter(i => i.status === 'done' && !i.fecha_fin).length
R.findings.items_con_fecha_fin = items.filter(i => i.fecha_fin).length

// subtareas structure
const shape = {}
let subtotal = 0
for (const i of items) {
  if (i.subtareas != null && !Array.isArray(i.subtareas)) { shape['NOT_ARRAY:' + typeof i.subtareas] = (shape['NOT_ARRAY:' + typeof i.subtareas] || 0) + 1; continue }
  for (const s of i.subtareas || []) { subtotal++; const k = typeof s === 'object' && s ? Object.keys(s).sort().join(',') : typeof s; shape[k] = (shape[k] || 0) + 1 }
}
R.findings.subtareas = { items_con_subtareas: items.filter(i => Array.isArray(i.subtareas) && i.subtareas.length).length, total: subtotal, shapes: shape,
  sample: (items.find(i => Array.isArray(i.subtareas) && i.subtareas.length) || {}).subtareas?.slice(0, 2) }

// hitos / comentarios / plan_accion / campanas
const hitos = H.rows
R.findings.hitos = { rows: hitos.length, huerfanos: hitos.filter(h => !proys.some(p => p.id === h.proyecto_id)).map(h => h.id), completados: hitos.filter(h => h.completado).length, sin_fecha: hitos.filter(h => !h.fecha_prevista).length, proyectos_con_hitos: new Set(hitos.map(h => h.proyecto_id)).size }
const com = CO.rows
R.findings.comentarios = { rows: com.length, de_item: com.filter(c => c.item_id).length, de_proyecto: com.filter(c => c.proyecto_id).length, huerfanos: com.filter(c => !c.item_id && !c.proyecto_id).length, ts_sample: com.slice(0, 3).map(c => c.ts) }
R.findings.plan_accion = { rows: PA.rows.length, columns: Object.keys(PA.rows[0] || {}), error: PA.error }
R.findings.campanas = { rows: CA.rows.length, error: CA.error }

if (process.argv.includes('--json')) console.log(JSON.stringify(R, null, 2))
else console.dir(R, { depth: 6, maxArrayLength: 40 })
