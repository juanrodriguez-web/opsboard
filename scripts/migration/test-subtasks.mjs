// Subtasks as rows: explode function (jsonb -> child work_items) and the updated f1d_reverse, on the REAL snapshot.
//   node scripts/migration/test-subtasks.mjs <legacy-snapshot.json>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const db = new PGlite(); const q = (s, p) => db.query(s, p); const rows = async (s, p) => (await q(s, p)).rows
const cnt = async s => (await rows(s))[0].n
await db.exec(readFileSync('supabase-schema.sql', 'utf8'))
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas'])
  if (snap[t]?.length) await q(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(snap[t])])
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(join('supabase/migrations', f), 'utf8'))
await db.exec(readFileSync('scripts/migration/remote/B_migrar_datos_f1b.sql', 'utf8'))

const out = []; const rec = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail).slice(0, 150) })
const subs = snap.items.flatMap(i => (i.subtareas || []).map(s => ({ parent: i.id, ...s })))

// the baseline: reverse is a fixed point right after F1B (jsonb still holds the subtasks)
rec('before exploding: reverse dry-run is empty (fixed point)', (await rows(`select * from f1d_reverse(false)`)).length === 0)

// dry-run
const dry = await rows(`select * from f1e_explode_subtasks(false)`)
rec('dry-run lists every legacy subtask as insert and changes nothing', dry.length === subs.length && dry.every(r => r.action === 'insert') && await cnt(`select count(*)::int n from work_items where parent_id is not null`) === 0 && await cnt(`select count(*)::int n from work_items where jsonb_array_length(legacy_subtareas) > 0`) === 17, `${dry.length} rows`)

await q(`select * from f1e_explode_subtasks(true)`)
const kids = await cnt(`select count(*)::int n from work_items where parent_id is not null`)
rec('apply: one child row per subtask (43), none lost or duplicated', kids === subs.length && await cnt(`select count(distinct legacy_id)::int n from work_items where legacy_source = 'subtareas'`) === subs.length, kids)
rec('apply: jsonb moved out of the parents (all empty)', await cnt(`select count(*)::int n from work_items where jsonb_array_length(legacy_subtareas) > 0`) === 0)
rec('apply: children point to the right parent and inherit its project', await cnt(`select count(*)::int n from work_items c join work_items p on p.id = c.parent_id where c.legacy_source = 'subtareas' and p.legacy_source = 'items' and c.project_id is not distinct from p.project_id`) === subs.length)

// field-by-field
const kid = Object.fromEntries((await rows(`select c.legacy_id, c.title, c.notes, c.risk, c.due_date::text due, s.key status, pe.name assignee, p.legacy_id parent, c.type, c.completed_at, c.number from work_items c join statuses s on s.id = c.status_id left join people pe on pe.id = c.assignee_id join work_items p on p.id = c.parent_id where c.legacy_source = 'subtareas'`)).map(r => [r.legacy_id, r]))
const madrid = ts => (ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) : null)
const diffs = subs.filter(s => { const k = kid[s.id]; return !k || k.title !== s.title || (k.notes || '') !== (s.notas || '') || (k.risk ?? null) !== (s.risk ?? null) || (k.due ?? null) !== madrid(s.fechaFin) || (k.assignee ?? '') !== (s.prop || '') || k.parent !== s.parent || k.status !== 'planned' || k.type !== 'task' })
rec('apply: title, notes, risk, owner, due date (Madrid day), parent, status identical to the jsonb', diffs.length === 0, JSON.stringify(diffs.slice(0, 2)))
rec('apply: completed_at not fabricated', await cnt(`select count(*)::int n from work_items where completed_at is not null`) === 0)
// order inside a parent follows the original array order (number is assigned in insertion order)
const orderOk = snap.items.every(i => { const ids = (i.subtareas || []).map(s => s.id); const got = Object.values(kid).filter(k => k.parent === i.id).sort((a, b) => a.number - b.number).map(k => k.legacy_id); return JSON.stringify(ids) === JSON.stringify(got) })
rec('apply: subtask order inside every item is preserved', orderOk)

// idempotent
const again = await rows(`select * from f1e_explode_subtasks(true)`)
rec('second run inserts nothing (idempotent)', again.length === 0 && await cnt(`select count(*)::int n from work_items where parent_id is not null`) === subs.length, `${again.length} rows`)

// items list must not include children: the adapter filters parent_id is null; here we check the rows the app would call "items"
rec('top-level items unchanged: 51 with parent_id null', await cnt(`select count(*)::int n from work_items where parent_id is null and type <> 'milestone'`) === snap.items.length)

// reverse (rollback) rebuilds subtareas from the children and ignores them as items
const rev = await rows(`select * from f1d_reverse(false)`)
rec('reverse dry-run after exploding is still empty (children rebuilt as the original subtareas, not inserted as items)', rev.length === 0, JSON.stringify(rev.slice(0, 3)))
// a subtask edited in pm shows up as an update of its parent in the reverse
const someKid = Object.values(kid)[0]
await q(`update work_items set title = 'Editada en pm', status_id = (select id from statuses where key = 'done' and project_id is null) where legacy_source = 'subtareas' and legacy_id = $1`, [someKid.legacy_id])
await q(`insert into work_items (legacy_source, legacy_id, type, parent_id, title, status_id) select 'subtareas', 'new-sub-1', 'task', p.id, 'Nueva subtarea', (select id from statuses where key = 'planned' and project_id is null) from work_items p where p.legacy_id = $1`, [someKid.parent])
const rev2 = await rows(`select * from f1d_reverse(false)`)
rec('reverse sees a subtask edit/add as ONE update of the parent item (and no item insert)', rev2.length === 1 && rev2[0].action === 'update' && rev2[0].legacy_id === someKid.parent, JSON.stringify(rev2))
await q(`select * from f1d_reverse(true)`)
const back = (await rows(`select subtareas from items where id = $1`, [someKid.parent]))[0].subtareas
rec('reverse apply writes the new subtareas array into the legacy item (title, done, appended one, order kept)', back.find(s => s.id === someKid.legacy_id)?.title === 'Editada en pm' && back.find(s => s.id === someKid.legacy_id)?.status === 'done' && back.at(-1).id === 'new-sub-1' && back.length === snap.items.find(i => i.id === someKid.parent).subtareas.length + 1)
rec('reverse apply did not create legacy items from subtasks', await cnt(`select count(*)::int n from items`) === snap.items.length)

// a parent with a malformed subtask keeps its jsonb (nothing is lost)
await q(`update work_items set legacy_subtareas = '[{"id":"ok-1","title":"Buena","status":"pending"},{"title":"sin id"}]'::jsonb where legacy_source = 'items' and legacy_id = (select id from items order by id limit 1)`)
const bad = await rows(`select * from f1e_explode_subtasks(true)`)
rec('malformed subtask is reported (no_id) and its parent keeps the jsonb; the valid one is inserted', bad.some(r => r.note === 'no_id') && await cnt(`select count(*)::int n from work_items where legacy_id = 'ok-1'`) === 1 && await cnt(`select count(*)::int n from work_items where legacy_source = 'items' and legacy_id = (select id from items order by id limit 1) and jsonb_array_length(legacy_subtareas) = 2`) === 1, JSON.stringify(bad))
// the same subtask id under another parent is not stolen
await q(`update work_items set legacy_subtareas = $1::jsonb where legacy_source = 'items' and legacy_id = (select id from items order by id desc limit 1)`, [JSON.stringify([{ id: someKid.legacy_id, title: 'Duplicado en otro padre', status: 'pending' }])])
const dup = await rows(`select * from f1e_explode_subtasks(false)`)
rec('a subtask id already used under another parent is rejected, not moved', dup.some(r => r.note === 'id_in_other_parent'))

console.table(out)
process.exit(out.some(x => x.result === 'FAIL') ? 1 : 0)
