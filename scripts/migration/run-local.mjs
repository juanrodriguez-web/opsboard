// Runs the whole F1 pipeline in an in-memory Postgres (PGlite). Never touches Supabase.
//   npm i --no-save @electric-sql/pglite
//   node scripts/migration/run-local.mjs                     # synthetic edge-case fixture (+ asserts)
//   node scripts/migration/run-local.mjs --snapshot <f.json> # real read-only snapshot (see export-legacy-snapshot.mjs)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const snapshotPath = arg('--snapshot')
const data = JSON.parse(readFileSync(snapshotPath || 'scripts/migration/fixtures/edge-cases.json', 'utf8'))
const isFixture = !snapshotPath
const read = p => readFileSync(p, 'utf8')

const db = new PGlite()
await db.exec(read('supabase-schema.sql'))                       // legacy schema
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas'])
  if (data[t]?.length) await db.query(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(data[t])])

for (const f of readdirSync('supabase/migrations').sort()) await db.exec(read(join('supabase/migrations', f)))

const state = async () => (await db.query(`select
  (select count(*) from projects)::int p, (select count(*) from work_items)::int w,
  (select count(*) from comments)::int c, (select count(*) from people)::int pe, (select count(*) from statuses)::int s`)).rows[0]

const migrate = read('scripts/migration/sql/f1b_migrate_legacy.sql')
const legacyBefore = JSON.stringify((await db.query(`select (select count(*) from items) i, (select count(*) from proyectos) p, (select count(*) from hitos) h`)).rows[0])
await db.exec(migrate)
const run1 = await state()
await db.exec(migrate)
const run2 = await state()
const legacyAfter = JSON.stringify((await db.query(`select (select count(*) from items) i, (select count(*) from proyectos) p, (select count(*) from hitos) h`)).rows[0])

const results = []
const rec = (name, ok, detail = '') => results.push({ name, ok, detail })
rec('idempotent: 2nd run adds no rows', JSON.stringify(run1) === JSON.stringify(run2), `${JSON.stringify(run1)} vs ${JSON.stringify(run2)}`)
rec('legacy tables unchanged by migration', legacyBefore === legacyAfter, legacyAfter)

const exc = (await db.query(`select severity, code, count(*)::int n from migration_exceptions group by 1,2 order by case severity when 'BLOCKING' then 1 when 'WARN' then 2 else 3 end, 2`)).rows
const val = (await db.query(read('scripts/migration/sql/f1_validate.sql'))).rows

if (isFixture) {
  const codes = Object.fromEntries(exc.map(e => [e.code, e.n]))
  const expect = { ITEM_PROJECT_UNMATCHED: 1, ITEM_OWNER_UNKNOWN: 1, ITEM_STATUS_UNEXPECTED: 1, ITEM_PRIORITY_UNEXPECTED: 1, ITEM_PROJECT_HELD: 2,
    ITEM_PROJECT_AMBIGUOUS: 1, PROJECT_OWNER_UNKNOWN: 1, PROJECT_STATUS_UNEXPECTED: 1, PROJECT_NAME_DUPLICATE: 3, ITEM_DATE_ORDER: 1, ITEM_SUBTAREAS_SHAPE: 1, PROJECT_NAME_WHITESPACE: 1, PROJECT_FASE_UNKNOWN: 1 }
  for (const [c, n] of Object.entries(expect)) rec(`fixture raises ${c} x${n}`, codes[c] === n, `got ${codes[c] ?? 0}`)
  // held rows must not be migrated; blank project/owner must be migrated as NULL
  const q = async s => (await db.query(s)).rows[0].n
  rec('fixture: held items not migrated (i3,i4,i5,i7,i8,i9)', await q(`select count(*)::int n from work_items where legacy_id in ('i3','i4','i5','i7','i8','i9')`) === 0)
  rec('fixture: i2 migrated with NULL project & assignee', await q(`select count(*)::int n from work_items where legacy_id='i2' and project_id is null and assignee_id is null`) === 1)
  rec('fixture: i1 linked to project by normalized name', await q(`select count(*)::int n from work_items w join projects p on p.id=w.project_id where w.legacy_id='i1' and p.legacy_id='p1'`) === 1)
  rec('fixture: no completed_at fabricated', await q(`select count(*)::int n from work_items where completed_at is not null`) === 0)
  rec('fixture: status change to Done sets completed_at, back to Planned clears it', await (async () => {
    await db.exec(`update work_items set status_id=(select id from statuses where key='done') where legacy_id='i1'`)
    const a = await q(`select count(*)::int n from work_items where legacy_id='i1' and completed_at is not null`)
    await db.exec(`update work_items set status_id=(select id from statuses where key='planned') where legacy_id='i1'`)
    const b = await q(`select count(*)::int n from work_items where legacy_id='i1' and completed_at is null`)
    return a === 1 && b === 1 })())
  rec('fixture: relation A blocks B is one row; reverse duplicate allowed only as separate semantic row', await (async () => {
    await db.exec(`insert into work_item_relations(from_id,to_id,kind) select a.id,b.id,'blocks' from work_items a, work_items b where a.legacy_id='i1' and b.legacy_id='i2'`)
    try { await db.exec(`insert into work_item_relations(from_id,to_id,kind) select a.id,b.id,'blocks' from work_items a, work_items b where a.legacy_id='i1' and b.legacy_id='i2'`); return false } catch { return true } })())
}

console.log(`\n== Exceptions (${isFixture ? 'fixture' : snapshotPath}) ==`)
console.table(exc)
console.log('\n== Validation ==')
console.table(val.map(r => ({ '#': r.ord, check: r.check, expected: r.expected, actual: r.actual, result: r.result })))
console.log('\n== Harness assertions ==')
console.table(results.map(r => ({ result: r.ok ? 'PASS' : 'FAIL', check: r.name, detail: r.detail })))

const failed = results.some(r => !r.ok) || val.some(r => r.result === 'FAIL')
if (process.argv.includes('--dump-exceptions')) console.log(JSON.stringify((await db.query(`select severity, code, entity, legacy_id, detail from migration_exceptions order by 1,2,4`)).rows, null, 1))
process.exit(failed ? 1 : 0)

