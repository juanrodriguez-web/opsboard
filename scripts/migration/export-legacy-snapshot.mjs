// READ-ONLY: dumps legacy tables to a local JSON file (SELECT with the public anon key).
// The snapshot contains business data: write it OUTSIDE the repo.
//   node scripts/migration/export-legacy-snapshot.mjs <out.json>
import dotenv from 'dotenv'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
const out = process.argv[2]
if (!out) { console.error('usage: export-legacy-snapshot.mjs <out.json>'); process.exit(1) }
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

const snap = {}
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas']) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(t).select('*').range(from, from + 999)
    if (error) { console.error(t, error.message); process.exit(1) }
    rows.push(...data)
    if (data.length < 1000) break
  }
  snap[t] = rows
  console.log(t, rows.length)
}
writeFileSync(out, JSON.stringify(snap))
