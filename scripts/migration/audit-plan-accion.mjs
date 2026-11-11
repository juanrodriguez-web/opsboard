// READ-ONLY audit of `plan_accion` (SELECT only, anon key). Free text is masked in the examples.
//   node scripts/migration/audit-plan-accion.mjs [--json]
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const norm = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const rd = async t => { const { data, error } = await sb.from(t).select('*'); if (error) throw new Error(t + ': ' + error.message); return data }
const [pa, items, proys] = await Promise.all([rd('plan_accion'), rd('items'), rd('proyectos')])

const cols = Object.keys(pa[0] || {})
const R = { rows: pa.length, columns: {} }
for (const c of cols) {
  const vals = pa.map(r => r[c])
  const nn = vals.filter(v => v !== null && v !== undefined && v !== '')
  const types = [...new Set(nn.map(v => typeof v))]
  R.columns[c] = { type: types.join('|') || 'empty', non_empty: nn.length, distinct: new Set(nn.map(String)).size,
    ...(types[0] === 'number' ? { sum: +nn.reduce((a, b) => a + b, 0).toFixed(3), min: Math.min(...nn), max: Math.max(...nn) } : {}),
    ...(nn.length && new Set(nn.map(String)).size <= 12 ? { values: Object.fromEntries([...new Set(nn.map(String))].map(v => [v, nn.filter(x => String(x) === v).length])) } : {}) }
}
R.by_section = Object.fromEntries([...new Set(pa.map(r => r.seccion))].map(s => [s, pa.filter(r => r.seccion === s).length]))
R.fecha_entrega_formats = Object.fromEntries([...new Set(pa.map(r => String(r.fecha_entrega).replace(/[0-9]/g, '9').replace(/[A-Za-z]+/g, 'a')))].map(f => [f, pa.filter(r => String(r.fecha_entrega).replace(/[0-9]/g, '9').replace(/[A-Za-z]+/g, 'a') === f).length]))
R.duplicate_actions = Object.entries(pa.reduce((m, r) => (m[norm(r.accion)] = (m[norm(r.accion)] || 0) + 1, m), {})).filter(([, n]) => n > 1)
R.status_vs_fecha = Object.fromEntries(['inprogress', 'pending'].map(s => [s, pa.filter(r => r.status === s).map(r => String(r.fecha_entrega).toLowerCase().includes('on going')).reduce((a, b) => a + (b ? 1 : 0), 0) + '/' + pa.filter(r => r.status === s).length + ' with "on going"']))

// numeric consistency (importer reads column 10 twice: q2 and julio)
const num = v => (typeof v === 'number' ? v : null)
R.consistency = {
  q2_equals_julio: pa.filter(r => num(r.q2_ingresos) !== null && r.q2_ingresos === r.julio).length,
  q2_null: pa.filter(r => r.q2_ingresos === null).length,
  total_equals_q2q3q4: pa.filter(r => Math.abs((r.total_ingresos ?? 0) - ((r.q2_ingresos ?? 0) + (r.q3_ingresos ?? 0) + (r.q4_ingresos ?? 0))) < 1e-9).length,
  total_equals_ingresos_total_services: pa.filter(r => r.total_ingresos === r.ingresos_total_services).length,
  months_sum_vs_total_diff: pa.filter(r => { const m = ['julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'enero', 'febrero', 'marzo'].reduce((a, k) => a + (r[k] ?? 0), 0); return Math.abs(m - (r.total_ingresos ?? 0)) > 1e-6 }).length,
  marzo_non_null: pa.filter(r => r.marzo !== null).length,
  all_zero_or_null_revenue: pa.filter(r => !['ingresos_gross_adds', 'ingresos_plan_renewal', 'ingresos_oob', 'ingresos_total_services', 'q2_ingresos', 'q3_ingresos', 'q4_ingresos'].some(k => r[k])).length,
}

// relation to items / proyectos
const itemN = items.map(i => norm(i.tema)), proyN = proys.map(p => norm(p.nombre))
const link = (a, list) => list.some(x => x === a) ? 'exact_norm' : list.some(x => x.length > 6 && a.length > 6 && (x.includes(a) || a.includes(x))) ? 'substring' : 'none'
R.relation = { with_items: {}, with_proyectos: {}, owners_in_items: {}, owners_in_pa: {} }
for (const r of pa) { const a = norm(r.accion); const i = link(a, itemN), p = link(a, proyN); R.relation.with_items[i] = (R.relation.with_items[i] || 0) + 1; R.relation.with_proyectos[p] = (R.relation.with_proyectos[p] || 0) + 1 }
R.relation.linked_rows = pa.filter(r => link(norm(r.accion), itemN) !== 'none' || link(norm(r.accion), proyN) !== 'none').map(r => ({ id: r.id, seccion: r.seccion, accion_len: r.accion.length, with_items: link(norm(r.accion), itemN), with_proyectos: link(norm(r.accion), proyN) }))
R.owners = { plan_accion: Object.fromEntries([...new Set(pa.map(r => r.propietario))].map(o => [o || '(blank)', pa.filter(r => r.propietario === o).length])), items: Object.fromEntries([...new Set(items.map(r => r.propietario))].map(o => [o || '(blank)', items.filter(r => r.propietario === o).length])) }
R.seccion_vs_items_category = { secciones: Object.keys(R.by_section), items_categories: [...new Set(items.map(i => i.category))] }

// masked structural examples
const mask = v => typeof v === 'string' ? (v === '' ? '' : `<text len=${v.length}>`) : v
R.examples = pa.slice(0, 3).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ['seccion', 'fecha_entrega', 'status'].includes(k) ? v : k === 'id' ? '<uuid>' : mask(v)])))
R.text_fields_usage = { descripcion_nonempty: pa.filter(r => r.descripcion).length, notas_nonempty: pa.filter(r => r.notas).length, demanda_requestor_nonempty: pa.filter(r => r.demanda_requestor).length }
R.timestamps = { created_at: [...new Set(pa.map(r => String(r.created_at).slice(0, 10)))], updated_eq_created: pa.filter(r => r.updated_at === r.created_at).length }

console.log(JSON.stringify(R, null, 2))
