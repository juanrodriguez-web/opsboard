// Full rehearsal of the C4 runbook (preflight -> freeze -> final sync -> validate -> realtime -> rollback) on an in-memory
// Postgres seeded with a real legacy snapshot. Uses an `anon` role to prove the freeze really blocks writes. Nothing remote.
//   node scripts/migration/test-cutover-rehearsal.mjs <legacy-snapshot.json>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const db = new PGlite(); const q = (s, p) => db.query(s, p); const rows = async (s, p) => (await q(s, p)).rows
const cnt = async s => (await rows(s))[0].n
const sql = f => readFileSync(f, 'utf8')
await db.exec(sql('supabase-schema.sql'))
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas'])
  if (snap[t]?.length) await q(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(snap[t])])
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(sql(join('supabase/migrations', f)))
await db.exec(sql('scripts/migration/remote/B_migrar_datos_f1b.sql'))
// remote-like details: role anon with table grants, hitos policy name, realtime publication
await db.exec(`create role anon nologin; grant usage on schema public to anon; grant all on all tables in schema public to anon; grant execute on all functions in schema public to anon;
  alter policy public_all on hitos rename to hitos_public; create publication supabase_realtime;`)
const asAnon = async fn => { await q('set role anon'); try { return await fn() } finally { await q('reset role') } }
const tryAnon = async s => asAnon(async () => { try { return { ok: true, r: await q(s) } } catch (e) { return { ok: false, msg: e.message } } })

const out = []; const rec = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail).slice(0, 150) })
const legacyHash = async () => (await rows(`select md5((select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from items i)::text || (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from proyectos p)::text) h`))[0].h

// 00 preflight
const pre = await rows(sql('scripts/migration/cutover/00_preflight.sql').split('-- Cambios pendientes')[0].replace(/^--.*$/gm, ''))
rec('00 preflight: functions installed, counts equal, work_items not yet in realtime', pre[0].f1d_functions_installed == 2 && pre[0].items == pre[0].work_items_items && pre[0].realtime_work_items == 0, JSON.stringify(pre[0]).slice(0, 140))
rec('00 preflight: no pending changes right after migration', (await rows(`select * from f1d_sync(false)`)).length === 0)

// team keeps working on legacy until the window
const someId = (await rows(`select id from items order by id limit 1`))[0].id
const a1 = await tryAnon(`insert into items (id, tema, status, risk, propietario) values ('win0001', 'Creado antes de la ventana', 'pending', 'green', 'Francisco Toledo')`)
const a2 = await tryAnon(`update items set status = 'done', estado_sheet = 'Hecho' where id = '${someId}'`)
rec('before freeze: anon can write legacy (the app works as today)', a1.ok && a2.ok)

// 10 freeze
await db.exec(sql('scripts/migration/cutover/10_freeze_legacy.sql'))
const pol = await rows(`select tablename, policyname, cmd from pg_policies where tablename in ('items','proyectos','hitos','comentarios')`)
rec('10 freeze: only a SELECT policy remains on the 4 legacy tables', pol.length === 4 && pol.every(p => p.policyname === 'legacy_read_only' && p.cmd === 'SELECT'), JSON.stringify(pol.map(p => p.tablename + ':' + p.policyname)))
const before = await legacyHash()
const w1 = await tryAnon(`insert into items (id, tema, status, risk) values ('late001', 'Escritura tardía', 'pending', 'green')`)
const w2 = await tryAnon(`update items set tema = 'HACKED' where id = '${someId}'`)
const w3 = await tryAnon(`delete from items where id = '${someId}'`)
const w4 = await tryAnon(`update proyectos set descripcion = 'x'`)
const sel = await tryAnon(`select count(*)::int n from items`)
rec('10 freeze: insert is rejected by RLS; update/delete/other tables affect 0 rows; reads still work', !w1.ok && /row-level security/.test(w1.msg || '') && w2.r.affectedRows === 0 && w3.r.affectedRows === 0 && w4.r.affectedRows === 0 && sel.ok && sel.r.rows[0].n > 0, w1.msg)
rec('10 freeze: legacy data unchanged by the blocked writes', before === await legacyHash())

// 20 final sync
let p = await rows(`select * from f1d_sync(false)`)
rec('20 final sync dry-run lists exactly the pre-window changes (1 insert, 1 update)', p.length === 2 && p.some(r => r.action === 'insert' && r.legacy_id === 'win0001') && p.some(r => r.action === 'update' && r.legacy_id === someId), JSON.stringify(p.map(r => r.action + ':' + r.legacy_id)))
const doneBefore = await cnt(`select count(*)::int n from work_items where completed_at is not null`)
await q(`select * from f1d_sync(true)`)
rec('20 final sync applied: nothing pending afterwards', (await rows(`select * from f1d_sync(false)`)).length === 0)
rec('20 final sync: completed_at not fabricated', await cnt(`select count(*)::int n from work_items where completed_at is not null`) === doneBefore)
const val = await rows(sql('scripts/migration/remote/C_validar.sql'))
rec('20 validation C: 0 FAIL, counts equal legacy', !val.some(r => r.result === 'FAIL') && val.find(r => r.ord === 1).actual === val.find(r => r.ord === 1).expected, val.find(r => r.ord === 99).result)

// 30 realtime
await db.exec(sql('scripts/migration/cutover/30_realtime.sql')); await db.exec(sql('scripts/migration/cutover/30_realtime.sql'))   // idempotent
rec('30 realtime: work_items in the publication (idempotent)', await cnt(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'work_items'`) === 1)

// after cutover: users edit in pm (the PM backend talks to work_items as anon)
const wi = (await rows(`select id from work_items where legacy_id = '${someId}'`))[0].id
const pm1 = await tryAnon(`update work_items set title = 'Editado en pm tras el cutover' where id = '${wi}'`)
const pm2 = await tryAnon(`insert into work_items (legacy_source, legacy_id, type, title, status_id) values ('items', 'pm000001', 'topic', 'Creado en pm', (select id from statuses where key = 'blocked' and project_id is null))`)
rec('after cutover: anon writes work_items fine while legacy stays read-only', pm1.ok && pm2.ok && pm1.r.affectedRows === 1)

// 90 rollback
const legacyBeforeRb = await legacyHash()
const r = await rows(`select * from f1d_reverse(false)`)
rec('90 rollback dry-run lists the edits made since the cutover (update + insert)', r.some(x => x.entity === 'items' && x.action === 'update' && x.legacy_id === someId) && r.some(x => x.entity === 'items' && x.action === 'insert' && x.legacy_id === 'pm000001'), JSON.stringify(r.map(x => x.entity + '.' + x.action + ':' + x.legacy_id)))
rec('90 rollback dry-run changed nothing', legacyBeforeRb === await legacyHash())
await q(`select * from f1d_reverse(true)`)
rec('90 rollback applied: legacy has the pm edits', await cnt(`select count(*)::int n from items where id = '${someId}' and tema = 'Editado en pm tras el cutover'`) === 1 && await cnt(`select count(*)::int n from items where id = 'pm000001' and tema = 'Creado en pm' and status = 'blocked'`) === 1)
rec('90 rollback: reverse is idempotent (nothing left to carry over)', (await rows(`select * from f1d_reverse(false)`)).length === 0)
await db.exec(`do $$ declare t text; begin foreach t in array array['items','proyectos','hitos','comentarios'] loop execute format('drop policy if exists legacy_read_only on %I', t); execute format('create policy public_all on %I for all using (true) with check (true)', t); end loop; end $$;`)
const back = await tryAnon(`insert into items (id, tema, status, risk) values ('post-rb', 'Escritura tras rollback', 'pending', 'green')`)
rec('90 rollback: legacy writable again for anon', back.ok)

console.table(out)
process.exit(out.some(x => x.result === 'FAIL') ? 1 : 0)
