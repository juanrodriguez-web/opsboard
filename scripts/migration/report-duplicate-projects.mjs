// Reconciliation report for potentially duplicated projects. READ-ONLY; merges nothing.
//   node scripts/migration/report-duplicate-projects.mjs [--snapshot f.json]
// Pairs are declared explicitly (decided by a human); they stay independent projects until reviewed.
import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
const snapArg = process.argv.indexOf('--snapshot')
let proyectos, items
if (snapArg > -1) ({ proyectos, items } = JSON.parse(readFileSync(process.argv[snapArg + 1], 'utf8')))
else {
  const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const rd = async t => (await sb.from(t).select('*')).data
  ;[proyectos, items] = await Promise.all([rd('proyectos'), rd('items')])
}

const PAIRS = [
  ['GAMIFICACIÓN', 'Gamificación y comunidad'],
  ['Mejora comunicación CDV', 'BPMOC217 - Mejora comunicación CDV Prepago'],
  ['Evolución/Mejoras e-SIM Prepago', 'MEJORA WEB ESIM PREPAGO'],
]
const norm = s => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const tokens = s => new Set(norm(s).split(' ').filter(t => t.length > 2))
const jaccard = (a, b) => { const A = tokens(a), B = tokens(b); const i = [...A].filter(x => B.has(x)).length; return +(i / (A.size + B.size - i || 1)).toFixed(2) }
const FIELDS = ['id', 'nombre', 'nombre_en', 'status', 'estado', 'fase', 'propietario', 'prioridad', 'fecha_inicio', 'fecha_fin', 'capex', 'desarrollo', 'descripcion', 'notas', 'created_at', 'updated_at']
const show = v => v === null || v === undefined || v === '' ? '(empty)' : String(v).replace(/\s+/g, ' ').slice(0, 70)

const out = []
for (const [na, nb] of PAIRS) {
  const a = proyectos.find(p => p.nombre === na), b = proyectos.find(p => p.nombre === nb)
  out.push(`\n### ${na}  <->  ${nb}`)
  if (!a || !b) { out.push(`  NOT FOUND: ${!a ? na : ''} ${!b ? nb : ''}`); continue }
  const linked = p => items.filter(i => norm(i.proyecto) === norm(p.nombre)).map(i => `${i.id} "${(i.tema || '').slice(0, 40)}" [${i.status}]`)
  out.push(`name token similarity (Jaccard): ${jaccard(a.nombre, b.nombre)}   |   normalized-equal: ${norm(a.nombre) === norm(b.nombre)}`)
  out.push('| field | A | B | same |', '|---|---|---|---|')
  for (const f of FIELDS) out.push(`| ${f} | ${show(a[f])} | ${show(b[f])} | ${show(a[f]) === show(b[f]) ? 'yes' : 'no'} |`)
  out.push(`linked items A: ${linked(a).length ? linked(a).join('; ') : 'none'}`, `linked items B: ${linked(b).length ? linked(b).join('; ') : 'none'}`)
}
console.log(out.join('\n'))
