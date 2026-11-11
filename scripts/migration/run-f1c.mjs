// F1C pipeline in an in-memory Postgres (PGlite). Never touches Supabase.
//   node scripts/migration/run-f1c.mjs                                   # synthetic fixtures + assertions
//   node scripts/migration/run-f1c.mjs --snapshot legacy.json --captures ./captures-dir --out ./report-dir
//       (real read-only snapshot + real capture files -> reconciliation report, no assertions, nothing applied)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ingestCapture } from './lib/f1c-ingest.mjs'

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const fixture = !arg('--snapshot')
const legacy = JSON.parse(readFileSync(arg('--snapshot') || 'scripts/migration/fixtures/f1c/legacy.json', 'utf8'))
const captures = fixture
  ? (await import('./fixtures/f1c/captures.mjs')).captures
  : readdirSync(arg('--captures')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(arg('--captures'), f), 'utf8')))
const read = p => readFileSync(p, 'utf8')

const db = new PGlite()
const q = (sql, p) => db.query(sql, p)
await db.exec(read('supabase-schema.sql'))
for (const t of ['items', 'proyectos', 'hitos', 'comentarios', 'campanas'])
  if (legacy[t]?.length) await q(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(legacy[t])])
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(read(join('supabase/migrations', f)))
await db.exec(read('scripts/migration/sql/f1b_migrate_legacy.sql'))

const legacyHash = async () => (await q(`select md5((select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from proyectos p)::text || (select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from items i)::text) h`)).rows[0].h
const legacyBefore = await legacyHash()

const ingest = []
for (const c of captures) ingest.push({ source: c.source_label || c.source_id, capture_at: c.captured_at, ...(await ingestCapture(q, c)) })
const ingest2 = []
for (const c of captures) ingest2.push(await ingestCapture(q, c))   // idempotency: re-ingesting the same files

const rows = async sql => (await q(sql)).rows
const status = await rows(`select stage, metric, n from v_f1c_status order by ord, metric`)
const recon = await rows(`select * from v_f1c_project_reconciliation_report`)
const comments = await rows(`select scope, local_key, iso, match_result, note, n_sources, sources, candidates, target_id, left(body, 40) as body from v_f1c_comment_classification order by scope, iso`)
const doneTs = await rows(`select source_id, item_legacy_id, ts_ms, same_ts_in_source, evidence, completed_at from v_f1c_done_ts order by 1,2`)

const results = []
const rec = (name, ok, detail = '') => results.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail })

if (fixture) {
  const sum = (proj, field) => recon.filter(r => r.project_name === proj && r.field === field)
  const ct = (proj, field) => [...new Set(sum(proj, field).map(r => r.conflict_type))].join(',')
  const S = (await import('./fixtures/f1c/captures.mjs')).SOURCES
  rec('ingest: 4 captures -> rows inserted; 2nd ingest inserts 0', ingest.reduce((a, b) => a + b.inserted, 0) > 0 && ingest2.every(x => x.inserted === 0), JSON.stringify(ingest2[0]))
  rec('ingest: identical payload from another browser is reported, still stored per source', ingest[3].same_payload_other_source > 0 && ingest[3].inserted > 0, JSON.stringify(ingest[3]))
  rec('latest-per-source: B older prioridad=P3 ignored, latest P0 used', sum('Bonos Prepago', 'prioridad').find(r => r.source_id === S.B)?.local_override_value === 'P0')
  rec('conflict: prioridad A=P1 vs B=P0 -> SOURCE_CONFLICT, conflict=true', ct('Bonos Prepago', 'prioridad') === 'SOURCE_CONFLICT' && sum('Bonos Prepago', 'prioridad').every(r => r.conflict))
  rec('conflict: propietario differs across sources', ct('Bonos Prepago', 'propietario') === 'SOURCE_CONFLICT')
  rec('agreement across 3 sources (A,B,C) with blank DB -> LOCAL_ONLY_ADDITION', ct('Bonos Prepago', 'descripcion') === 'LOCAL_ONLY_ADDITION' && sum('Bonos Prepago', 'descripcion').length === 3)
  rec('local differs from non-blank DB -> DB_DIFFERS (status pending vs inprogress)', ct('Bonos Prepago', 'status') === 'DB_DIFFERS' && ct('Otro Proyecto', 'prioridad') === 'DB_DIFFERS')
  rec('local equals DB -> NOOP (descripcion, capex, and Madrid calendar date 2026-01-11)', ct('Gamificación', 'descripcion') === 'NOOP' && ct('Otro Proyecto', 'fechaInicio') === 'NOOP')
  rec('match: key with internal tab is MATCHED_EXACT', recon.find(r => r.project_name === 'Tab\tName')?.match_status === 'MATCHED_EXACT')
  rec('match: double-space key -> MATCHED_UNIQUE_NORMALIZED', recon.find(r => r.project_name === 'Nombre Doble')?.match_status === 'MATCHED_UNIQUE_NORMALIZED')
  rec('match: unknown key -> UNMATCHED / NOT_MATCHED, never applied', recon.filter(r => r.local_key === 'proyecto inexistente').every(r => r.match_status === 'UNMATCHED' && r.conflict_type === 'NOT_MATCHED'))
  const cls = (scope, k) => comments.find(c => c.scope === scope && c.local_key === k)
  rec('comments: exact / unique-normalized / ambiguous / unmatched', cls('item', 'tema uno')?.match_result === 'MATCHED_EXACT' && cls('item', 'tema tres')?.match_result === 'MATCHED_UNIQUE_NORMALIZED'
      && cls('item', 'duplicado')?.match_result === 'AMBIGUOUS' && cls('item', 'tema cuatro antiguo')?.match_result === 'UNMATCHED', comments.map(c => c.match_result).join(','))
  rec('comments: ambiguous keeps candidates for review, no target chosen', cls('item', 'duplicado')?.target_id === null && cls('item', 'duplicado').candidates.length === 2)
  rec('comments: item held by a BLOCKING exception is UNMATCHED with note', /TARGET_NOT_MIGRATED/.test(cls('item', 'held owner')?.note || ''))
  rec('comments: identical comment in 3 sources counted once (content dedupe)', cls('item', 'tema uno')?.n_sources === 3 && comments.filter(c => c.local_key === 'tema uno').length === 1)
  rec('project comments classified (exact + unmatched)', cls('project', 'bonos prepago')?.match_result === 'MATCHED_EXACT' && cls('project', 'proyecto zzz')?.match_result === 'UNMATCHED')
  rec('done_ts: staged as evidence, identical ms flagged LIKELY_FABRICATED, completed_at stays NULL',
      doneTs.filter(d => d.item_legacy_id === 'i1').every(d => /LIKELY/.test(d.evidence)) && doneTs.every(d => d.completed_at === null)
      && (await rows(`select count(*)::int n from work_items where completed_at is not null`))[0].n === 0)
  rec('raw_payload is immutable', await (async () => { try { await db.exec(`update legacy_localstorage_import set raw_payload='x'`); return false } catch { return true } })())
  rec('PARSE_FAILED is recorded, not dropped', await (async () => {
    const r = await ingestCapture(q, { format: 'opsboard-localstorage-capture', version: 1, capture_id: '00000000-0000-4000-8000-0000000000ff', source_id: 'zzz', captured_at: '2026-01-01T00:00:00Z', entries: [{ storage_key: 'obs-comments', raw_payload: '{broken' }] })
    return r.inserted === 1 && r.parse_failed === 1 })())
  rec('ingest rejects a non-whitelisted key', await (async () => { try { await ingestCapture(q, { ...captures[0], entries: [{ storage_key: 'sb-auth-token', raw_payload: 'x' }] }); return false } catch { return true } })())

  // ── decision rules & DB context columns (report is a recommendation, never a decision) ──
  const row = (proj, field) => recon.find(r => r.project_name === proj && r.field === field)
  const need = ['project_created_at', 'project_updated_at', 'db_modified_after_legacy_editor_window', 'db_current_value', 'local_override_value', 'source_id', 'match_status',
                'conflict_type', 'recommended_action', 'review_risk', 'db_value_present', 'local_value_present', 'multiple_local_values', 'project_modified_after_cutoff']
  rec('report exposes all required context columns', need.every(k => k in recon[0]), need.filter(k => !(k in recon[0])).join(','))
  rec('report never creates decisions (f1c_review_decisions empty before any approve)', (await rows(`select count(*)::int n from f1c_review_decisions`))[0].n === 0)
  rec('A: DB == local -> NOOP / NO_ACTION', row('Gamificación', 'descripcion')?.conflict_type === 'NOOP' && row('Gamificación', 'descripcion')?.recommended_action === 'NO_ACTION')
  rec('B: DB empty + local value + no source conflict -> LOCAL_ONLY_ADDITION / SAFE_LOCAL_ADDITION (also when project modified after cutoff, non-sensitive field)',
      ['LOCAL_ONLY_ADDITION', 'SAFE_LOCAL_ADDITION', null].join() === [row('Otro Proyecto', 'fase').conflict_type, row('Otro Proyecto', 'fase').recommended_action, row('Otro Proyecto', 'fase').review_risk].join()
      && row('Otro Proyecto', 'fase').db_modified_after_legacy_editor_window === true)
  rec('B on a SENSITIVE field of a project modified after cutoff: still SAFE_LOCAL_ADDITION but flagged (DB may have been cleared on purpose)',
      row('Sensible Vaciada', 'descripcion')?.recommended_action === 'SAFE_LOCAL_ADDITION' && row('Sensible Vaciada', 'descripcion')?.sensitive_field === true
      && row('Sensible Vaciada', 'descripcion')?.review_risk === 'SENSITIVE_FIELD_DB_MAY_HAVE_BEEN_CLEARED')
  rec('B on an untouched project: no flags', row('Bonos Prepago', 'descripcion')?.review_risk === null && row('Bonos Prepago', 'descripcion')?.db_modified_after_legacy_editor_window === false)
  rec('C: DB value != local -> REVIEW_DB_VS_LOCAL, DB_MODIFIED_AFTER_OVERRIDE_WINDOW risk, NO winner chosen',
      row('Otro Proyecto', 'prioridad')?.conflict_type === 'DB_DIFFERS' && row('Otro Proyecto', 'prioridad')?.recommended_action === 'REVIEW_DB_VS_LOCAL'
      && /DB_MODIFIED_AFTER_OVERRIDE_WINDOW/.test(row('Otro Proyecto', 'prioridad')?.review_risk) && row('Otro Proyecto', 'prioridad')?.decision === null)
  rec('C variant: local blank vs DB value -> flagged LOCAL_BLANK_WOULD_CLEAR_DB',
      /LOCAL_BLANK_WOULD_CLEAR_DB/.test(row('Otro Proyecto', 'descripcion')?.review_risk) && row('Otro Proyecto', 'descripcion')?.local_value_present === false && row('Otro Proyecto', 'descripcion')?.db_value_present === true)
  rec('D: different local sources -> SOURCE_CONFLICT / REVIEW_SOURCE_CONFLICT / multiple_local_values',
      row('Bonos Prepago', 'prioridad')?.recommended_action === 'REVIEW_SOURCE_CONFLICT' && row('Bonos Prepago', 'prioridad')?.multiple_local_values === true)
  rec('sensitive fields are exactly status, fechaInicio, fechaFin, descripcion', [...new Set(recon.filter(r => r.sensitive_field).map(r => r.field))].sort().join() === 'descripcion,fechaFin,fechaInicio,status')
  rec('cutoff is presented as ORIENTATIVE (git commit time, not deploy time)', /ORIENTATIVE/.test(recon[0].window_end_basis) && /not the production deploy time/i.test(recon[0].window_end_basis))
  rec('no recommended_action is ever APPLIED-like: recommendations are one of the allowed labels',
      recon.every(r => ['NO_ACTION', 'SAFE_LOCAL_ADDITION', 'REVIEW_DB_VS_LOCAL', 'REVIEW_SOURCE_CONFLICT', 'REVIEW_MATCH'].includes(r.recommended_action)))

  // approval + apply
  const nClean = (await q(`select f1c_approve_clean('tester') n`)).rows[0].n
  const applied1 = (await q(`select * from f1c_apply_project_overrides()`)).rows
  const P = async legacyId => (await q(`select * from projects where legacy_id=$1`, [legacyId])).rows[0]
  const bonos = await P('p1')
  rec('approve_clean skips flagged rows (Sensible Vaciada) and never touches DB_DIFFERS / conflicts',
      (await rows(`select count(*)::int n from f1c_review_decisions d join projects p on p.id = d.project_id where p.legacy_id = 'p6'`))[0].n === 0
      && (await rows(`select count(*)::int n from f1c_review_decisions d join projects p on p.id = d.project_id where p.legacy_id = 'p4' and d.field in ('prioridad','descripcion')`))[0].n === 0)
  rec('approve_clean approves only safe, unflagged additions (8) and applies them', nClean === 8 && applied1.length === 8, `approved ${nClean}, applied ${applied1.length}`)
  rec('applied: description/start_date/fase/capex set; owner, priority, status untouched (conflicts)',
      bonos.description === 'Desc A' && String(bonos.start_date?.toISOString?.().slice(0, 10) ?? bonos.start_date).startsWith('2026-03-01') && bonos.fase === 'RTM' && Number(bonos.capex) === 1000
      && bonos.owner_id === null && bonos.priority === null && bonos.legacy_status === 'pending')
  rec('apply is idempotent (2nd run applies nothing)', (await q(`select * from f1c_apply_project_overrides()`)).rows.length === 0)
  const nFlagged = (await q(`select f1c_approve_clean('tester', true) n`)).rows[0].n
  const appliedF = (await q(`select * from f1c_apply_project_overrides()`)).rows
  rec('approve_clean(include_flagged=true) is an explicit opt-in that picks up the flagged addition', nFlagged === 1 && appliedF.length === 1 && (await P('p6')).description === 'Local desc')
  await q(`select f1c_approve('p1','prioridad','USE_SOURCE',$1,null,'tester','A is right')`, [S.A])
  await q(`select f1c_approve('p1','propietario','SET_VALUE',null,'"Francisco Toledo"'::jsonb,'tester')`)
  await q(`select f1c_approve('p4','prioridad','KEEP_CURRENT',null,null,'tester','keep DB')`)
  const applied2 = (await q(`select * from f1c_apply_project_overrides()`)).rows
  const bonos2 = await P('p1'), otro = await P('p4')
  rec('explicit human decisions resolve conflicts (USE_SOURCE, SET_VALUE, KEEP_CURRENT)',
      applied2.length === 3 && bonos2.priority === 'high' && otro.priority === 'low' && bonos2.owner_id !== null)
  rec('applying an already-applied decision is refused', await (async () => { try { await q(`select f1c_approve('p1','prioridad','KEEP_CURRENT',null,null,'x')`); return false } catch { return true } })())
  rec('lifecycle: rows end APPLIED; unmatched stay PARSED', recon.length > 0
      && (await rows(`select distinct lifecycle from v_f1c_project_reconciliation_report where field='prioridad' and project_name='Bonos Prepago'`)).every(r => r.lifecycle === 'APPLIED')
      && (await rows(`select distinct lifecycle from v_f1c_project_reconciliation_report where local_key='proyecto inexistente'`)).every(r => r.lifecycle === 'PARSED'))
  const nAct = (await q(`select count(*)::int n from activity_events where action like 'f1c_apply:%'`)).rows[0].n
  rec('audit: activity_events written for every applied change (KEEP_CURRENT writes none)', nAct === 11, `events=${nAct} (expected 8 clean + 1 flagged opt-in + 2 explicit)`)
  rec('legacy tables untouched (hash of proyectos+items)', legacyBefore === await legacyHash())
  rec('completed_at still NULL everywhere after apply', (await rows(`select count(*)::int n from work_items where completed_at is not null`))[0].n === 0)
  rec('comments never applied (comments table empty)', (await rows(`select count(*)::int n from comments`))[0].n === 0)
}

console.log('\n== F1C status =='); console.table(status)
console.log('\n== Ingest =='); console.table(ingest)
console.log('\n== Project override reconciliation (before any approval) =='); console.table(recon.map(r => ({ project: r.project_name?.replace(/\t/g, '\\t'), field: r.field, db: r.db_current_value, local: r.local_override_value, source: r.source_label, match: r.match_status, type: r.conflict_type, conflict: r.conflict ? 'YES' : 'no', action: r.recommended_action, risk: r.review_risk, after_cutoff: r.db_modified_after_legacy_editor_window, sens: r.sensitive_field, key: r.local_key?.replace(/\t/g, '\\t') })))
console.log('\n== Comment classification =='); console.table(comments.map(c => ({ ...c, sources: undefined, candidates: c.candidates.length, target_id: c.target_id ? 'yes' : '' })))
if (results.length) { console.log('\n== Assertions =='); console.table(results) }

const outDir = arg('--out')
if (outDir) {
  mkdirSync(outDir, { recursive: true })
  const csv = rs => rs.length ? [Object.keys(rs[0]).join(','), ...rs.map(r => Object.values(r).map(v => v == null ? '' : `"${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/"/g, '""')}"`).join(','))].join('\n') : ''
  writeFileSync(join(outDir, 'project_override_reconciliation.csv'), csv(recon))
  writeFileSync(join(outDir, 'comment_classification.csv'), csv(comments))
  writeFileSync(join(outDir, 'done_ts_evidence.csv'), csv(doneTs))
  writeFileSync(join(outDir, 'status.csv'), csv(status))
  console.log('reports written to', outDir)
}
process.exit(results.some(r => r.result === 'FAIL') ? 1 : 0)
