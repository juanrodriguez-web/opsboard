// Local, read-only analysis of real capture files through the F1C pipeline (in-memory Postgres; nothing is written anywhere else).
//   node scripts/migration/analyze-capture.mjs --snapshot legacy.json --captures <dir>
// It never calls f1c_approve / f1c_approve_clean / f1c_apply_project_overrides.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { ingestCapture } from './lib/f1c-ingest.mjs'

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const legacy = JSON.parse(readFileSync(arg('--snapshot'), 'utf8'))
const files = readdirSync(arg('--captures')).filter(f => f.endsWith('.json'))
const captures = files.map(f => JSON.parse(readFileSync(join(arg('--captures'), f), 'utf8')))
const read = p => readFileSync(p, 'utf8')

const db = new PGlite(); const q = (s, p) => db.query(s, p); const rows = async (s, p) => (await q(s, p)).rows
await db.exec(read('supabase-schema.sql'))
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas'])
  if (legacy[t]?.length) await q(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(legacy[t])])
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(read(join('supabase/migrations', f)))
await db.exec(read('scripts/migration/sql/f1b_migrate_legacy.sql'))
const lh = async () => (await rows(`select md5((select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from proyectos p)::text || (select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from items i)::text || (select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') from hitos h)::text || (select count(*) from comentarios)::text) h`))[0].h
const before = await lh()

const out = { files, ingest_first: [], ingest_second: [] }
for (const c of captures) out.ingest_first.push(await ingestCapture(q, c))
for (const c of captures) out.ingest_second.push(await ingestCapture(q, c))
out.hash_check = { mismatches: 0, checked: 0 }
for (const c of captures) for (const e of c.entries) {
  const r = (await rows(`select payload_hash, raw_payload = $3 as same_raw from legacy_localstorage_import where source_id = $1 and storage_key = $2`, [c.source_id, e.storage_key, e.raw_payload]))[0]
  out.hash_check.checked++
  if (!r || !r.same_raw || r.payload_hash !== createHash('sha256').update(e.raw_payload, 'utf8').digest('hex')) out.hash_check.mismatches++
}
out.staging_rows = (await rows(`select count(*)::int n from legacy_localstorage_import`))[0].n
out.legacy_unchanged = before === await lh()
out.status = await rows(`select stage, metric, n from v_f1c_status order by ord, metric`)
out.override_report_rows = (await rows(`select recommended_action, count(*)::int n from v_f1c_project_reconciliation_report group by 1`))
out.comments = await rows(`select scope, local_key as k, iso, match_result, note, target_id is not null as has_target, body, candidates from v_f1c_comment_classification order by scope, iso`)
out.comment_counts = await rows(`select match_result, count(*)::int n from v_f1c_comment_classification group by 1 order by 1`)
out.done_ts_totals = (await rows(`select count(*)::int total, count(*) filter (where work_item_id is not null)::int matched_work_items,
  count(*) filter (where work_item_id is not null and evidence like 'LIKELY%')::int matched_likely_fabricated,
  count(*) filter (where work_item_id is not null and evidence = 'UNKNOWN')::int matched_unknown,
  count(*) filter (where work_item_id is null)::int unmatched_ids,
  count(*) filter (where work_item_id is null and evidence like 'LIKELY%')::int unmatched_likely_fabricated,
  count(distinct ts_ms)::int distinct_ts, max(same_ts_in_source)::int largest_same_ts_group, count(*) filter (where completed_at is not null)::int completed_at_set from v_f1c_done_ts`))[0]
out.done_ts_matched = await rows(`select d.item_legacy_id, w.title, to_char(d.ts at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI') as done_ts_local, d.same_ts_in_source, d.evidence, d.completed_at is not null as completed_at_set
  from v_f1c_done_ts d join work_items w on w.id = d.work_item_id order by d.ts`)
out.work_items_done_without_done_ts = await rows(`select w.legacy_id, w.title from work_items w join statuses s on s.id = w.status_id where s.category = 'DONE' and not exists (select 1 from v_f1c_done_ts d where d.work_item_id = w.id)`)
out.completed_at_non_null = (await rows(`select count(*)::int n from work_items where completed_at is not null`))[0].n
out.decisions = (await rows(`select count(*)::int n from f1c_review_decisions`))[0].n
out.projects_changed = (await rows(`select count(*)::int n from activity_events`))[0].n
console.log(JSON.stringify(out, null, 1))
