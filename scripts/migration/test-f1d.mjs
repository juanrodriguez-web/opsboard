// F1D sync tests on an in-memory Postgres seeded with a legacy snapshot. Nothing remote is touched.
//   node scripts/migration/test-f1d.mjs <legacy-snapshot.json>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const db = new PGlite(); const q = (s, p) => db.query(s, p); const rows = async (s, p) => (await q(s, p)).rows
await db.exec(readFileSync('supabase-schema.sql', 'utf8'))
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas'])
  if (snap[t]?.length) await q(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(snap[t])])
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(join('supabase/migrations', f), 'utf8'))
await db.exec(readFileSync('scripts/migration/remote/B_migrar_datos_f1b.sql', 'utf8'))

const out = []; const rec = (name, ok, detail = '') => { out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail).slice(0, 160) }) }
const plan = async fn => (await rows(`select * from ${fn}(false)`))
const summary = p => Object.entries(p.reduce((m, r) => (m[r.entity + '.' + r.action] = (m[r.entity + '.' + r.action] || 0) + 1, m), {})).map(([k, v]) => `${k}:${v}`).join(' ')
const cnt = async sql => (await rows(sql))[0].n

// 1. fixed points on real data
let p = await plan('f1d_sync'); rec('forward dry-run right after F1B is empty (fixed point, real data)', p.length === 0, summary(p) + JSON.stringify(p.slice(0, 2)))
let r = await plan('f1d_reverse'); rec('reverse dry-run right after F1B is empty (mapping is symmetric: dates, priority, status, owner)', r.length === 0, summary(r) + JSON.stringify(r.slice(0, 3)))

// 2. legacy changes -> forward
const someItem = (await rows(`select id from items where status <> 'done' and proyecto <> '' order by id limit 1`))[0].id
const doneBefore = await cnt(`select count(*)::int n from work_items where completed_at is not null`)
await q(`insert into items (id, tema, status, risk, prioridad, propietario, category, proyecto, fecha_fin) values ('zz1', 'Nuevo desde legacy', 'inprogress', 'yellow', 'P1', 'Nacho Cruz', 'tools', '', '2026-12-31T23:00:00Z')`)
await q(`insert into items (id, tema, status, risk, propietario) values ('zz2', 'Con owner nuevo', 'pending', 'green', 'Persona Nueva')`)
await q(`insert into items (id, tema, status, risk) values ('zz3', 'Status raro', 'weird', 'green')`)
await q(`update items set status = 'done', tema = tema || ' (editado)' where id = $1`, [someItem])
const delItem = (await rows(`select id from items where id not like 'zz%' and id <> $1 order by id desc limit 1`, [someItem]))[0].id
await q(`delete from items where id = $1`, [delItem])
const proj = (await rows(`select id from proyectos order by id limit 1`))[0].id
await q(`update proyectos set descripcion = 'Descripción nueva', prioridad = 'P1' where id = $1`, [proj])
await q(`insert into hitos (id, proyecto_id, nombre, fecha_prevista, completado) values ('h1', $1, 'Hito nuevo', '2026-06-30T22:00:00Z', false)`, [proj])
await q(`insert into comentarios (id, proyecto_id, item_id, texto) values ('c1', $1, null, 'Comentario de proyecto')`, [proj])
p = await plan('f1d_sync')
const has = (e, a, id) => p.some(x => x.entity === e && x.action === a && (id == null || x.legacy_id === id))
rec('dry-run lists: insert zz1, insert zz2, skip zz3, update edited item, delete removed item', has('items', 'insert', 'zz1') && has('items', 'insert', 'zz2') && has('items', 'skip_invalid', 'zz3') && has('items', 'update', someItem) && has('items', 'delete', delItem), summary(p))
rec('dry-run lists: people create, project update, hito insert, comment insert', has('people', 'create') && has('projects', 'update', proj) && has('hitos', 'insert', 'h1') && has('comentarios', 'insert', 'c1'), summary(p))
rec('dry-run changed nothing', await cnt(`select count(*)::int n from work_items where legacy_id in ('zz1','zz2')`) === 0 && await cnt(`select count(*)::int n from people`) === 4)
await q(`select * from f1d_sync(true)`)
rec('apply: new items present, invalid skipped, deleted gone',
    await cnt(`select count(*)::int n from work_items where legacy_id in ('zz1','zz2')`) === 2 && await cnt(`select count(*)::int n from work_items where legacy_id = 'zz3'`) === 0
    && await cnt(`select count(*)::int n from work_items where legacy_id = '${delItem}'`) === 0)
rec('apply: unknown owner created as person (D1)', await cnt(`select count(*)::int n from people where name = 'Persona Nueva'`) === 1)
rec('apply: edited item updated (title, status=done)', await cnt(`select count(*)::int n from work_items w join statuses s on s.id = w.status_id where w.legacy_id = '${someItem}' and s.key = 'done' and w.title like '%(editado)'`) === 1)
rec('apply: completed_at NOT fabricated by sync (moved to done)', await cnt(`select count(*)::int n from work_items where completed_at is not null`) === doneBefore)
rec('apply: project/hito/comment synced', await cnt(`select count(*)::int n from projects where legacy_id = '${proj}' and description = 'Descripción nueva' and priority = 'high'`) === 1
    && await cnt(`select count(*)::int n from work_items where legacy_source = 'hitos' and legacy_id = 'h1' and type = 'milestone' and due_date = '2026-07-01'`) === 1
    && await cnt(`select count(*)::int n from comments where legacy_ref = 'comentarios:c1'`) === 1)
p = await plan('f1d_sync'); rec('after apply, forward dry-run only reports the still-invalid row (idempotent)', p.length === 1 && p[0].action === 'skip_invalid', summary(p))
await q(`delete from items where id = 'zz3'`); await q(`select * from f1d_sync(true)`)
rec('removing the invalid row leaves a clean fixed point', (await plan('f1d_sync')).length === 0)
rec('legacy tables untouched by forward sync', await cnt(`select count(*)::int n from items`) === snap.items.length + 2 - 1 /* +zz1 +zz2 -deleted (zz3 removed) */)
rec('sync is audited in activity_events', await cnt(`select count(*)::int n from activity_events where action like 'f1d_sync:%'`) >= 2)

// 3. reverse (rollback)
const nativeStatus = (await rows(`select id from statuses where key = 'blocked' and project_id is null`))[0].id
await q(`update work_items set status_id = (select id from statuses where key = 'done' and project_id is null), title = 'Editado en pm', assignee_id = (select id from people where name = 'Maria Garcia') where legacy_id = $1`, [someItem])
await q(`insert into work_items (type, title, status_id, priority, project_id, tags) values ('task', 'Tarea nativa pm', $1, 'urgent', (select id from projects where legacy_id = $2), '{}')`, [nativeStatus, proj])
const delPm = (await rows(`select legacy_id from work_items where legacy_source = 'items' and legacy_id not in ('zz1','zz2', $1) order by legacy_id limit 1`, [someItem]))[0].legacy_id
await q(`delete from work_items where legacy_source = 'items' and legacy_id = $1`, [delPm])
await q(`update projects set fase = 'RTM', priority = 'low' where legacy_id = $1`, [proj])
r = await plan('f1d_reverse'); const hasR = (e, a, id) => r.some(x => x.entity === e && x.action === a && (id == null || x.legacy_id === id))
rec('reverse dry-run lists: item update, native insert, item delete, project update', hasR('items', 'update', someItem) && hasR('items', 'insert') && hasR('items', 'delete', delPm) && hasR('proyectos', 'update', proj), summary(r))
const itemsBefore = await cnt(`select count(*)::int n from items`)
await q(`select * from f1d_reverse(true)`)
rec('reverse apply: legacy item updated (tema, owner, status)', await cnt(`select count(*)::int n from items where id = '${someItem}' and tema = 'Editado en pm' and propietario = 'Maria Garcia' and status = 'done'`) === 1)
rec('reverse apply: native task created in legacy with a legacy id, blocked/P0', await cnt(`select count(*)::int n from items where tema = 'Tarea nativa pm' and status = 'blocked' and prioridad = 'P0' and estado_sheet = 'En peligro'`) === 1
    && await cnt(`select count(*)::int n from work_items where title = 'Tarea nativa pm' and legacy_id is not null`) === 1)
rec('reverse apply: deleted pm item deleted in legacy', await cnt(`select count(*)::int n from items where id = '${delPm}'`) === 0 && await cnt(`select count(*)::int n from items`) === itemsBefore)
rec('reverse apply: project updated in legacy', await cnt(`select count(*)::int n from proyectos where id = '${proj}' and fase = 'RTM' and prioridad = 'P3'`) === 1)
r = await plan('f1d_reverse'); rec('reverse is idempotent: dry-run empty after apply', r.length === 0, summary(r) + JSON.stringify(r.slice(0, 2)))

console.table(out)
process.exit(out.some(x => x.result === 'FAIL') ? 1 : 0)
