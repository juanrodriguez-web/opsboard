// Runs the exact three files meant for the Supabase SQL Editor (remote/A, B, C) on a fresh in-memory Postgres
// seeded with a legacy snapshot. Nothing remote is touched.
//   node scripts/migration/test-remote-sql.mjs <legacy-snapshot.json>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const db = new PGlite()
await db.exec(readFileSync('supabase-schema.sql', 'utf8'))
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas'])
  if (snap[t]?.length) await db.query(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(snap[t])])
for (const f of ['A_schema_y_staging', 'B_migrar_datos_f1b']) await db.exec(readFileSync(`scripts/migration/remote/${f}.sql`, 'utf8'))
await db.exec(readFileSync('scripts/migration/remote/B_migrar_datos_f1b.sql', 'utf8'))   // 2nd run: must be idempotent
const v = (await db.query(readFileSync('scripts/migration/remote/C_validar.sql', 'utf8'))).rows
console.log(v.map(r => `${String(r.ord).padStart(2)} ${r.result.padEnd(16)} ${r.check}  [${r.expected} -> ${r.actual}]`).join('\n'))
console.log('work_items:', (await db.query('select count(*)::int n from work_items')).rows[0].n, '| projects:', (await db.query('select count(*)::int n from projects')).rows[0].n)
process.exit(v.some(r => r.result === 'FAIL') ? 1 : 0)
