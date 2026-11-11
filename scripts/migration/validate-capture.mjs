// Pre-flight validation of a capture file (read-only, no DB, no network). Prints structure only, never values.
//   node scripts/migration/validate-capture.mjs <capture.json>
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { validateCapture } from './lib/f1c-ingest.mjs'

const file = process.argv[2]
const raw = readFileSync(file, 'utf8')
const c = JSON.parse(raw)
const R = { file_sha256: createHash('sha256').update(raw).digest('hex').slice(0, 16), format_errors: validateCapture(c),
  source_id: c.source_id, source_label: c.source_label, origin: c.origin, captured_at: c.captured_at, capture_id: c.capture_id,
  top_level_keys: Object.keys(c), ignored_keys: c.ignored_keys }
const byKey = {}
for (const e of c.entries) byKey[e.storage_key.startsWith('obs-done-ts-') ? 'obs-done-ts-*' : e.storage_key] = (byKey[e.storage_key.startsWith('obs-done-ts-') ? 'obs-done-ts-*' : e.storage_key] || 0) + 1
R.entries_by_key = byKey
R.total_entries = c.entries.length
R.duplicate_storage_keys = Object.entries(c.entries.reduce((m, e) => (m[e.storage_key] = (m[e.storage_key] || 0) + 1, m), {})).filter(([, n]) => n > 1)
R.unexpected_keys = c.entries.filter(e => !(['obs-comments', 'obs-proj-comments', 'obs-proy-overrides', 'obs-status-overrides', 'obs-local-items'].includes(e.storage_key) || /^obs-done-ts-[a-z0-9]+$/i.test(e.storage_key))).map(e => e.storage_key)

const parse = k => { const e = c.entries.find(x => x.storage_key === k); if (!e) return { present: false }; try { return { present: true, value: JSON.parse(e.raw_payload) } } catch { return { present: true, invalid: true } } }
const shape = (v) => Array.isArray(v) ? { type: 'array', length: v.length, element_keys: [...new Set(v.flatMap(x => Object.keys(x || {})))].sort() }
  : v && typeof v === 'object' ? { type: 'object', keys: Object.keys(v).length } : { type: typeof v }
R.payloads = {}
for (const k of ['obs-proy-overrides', 'obs-comments', 'obs-proj-comments', 'obs-status-overrides', 'obs-local-items']) {
  const p = parse(k)
  R.payloads[k] = !p.present ? 'absent' : p.invalid ? 'INVALID JSON' : shape(p.value)
  if (k === 'obs-proy-overrides' && p.value) {
    const fields = {}; for (const o of Object.values(p.value)) for (const f of Object.keys(o || {})) fields[f] = (fields[f] || 0) + 1
    R.payloads[k].fields_per_entry = fields
  }
}
const done = c.entries.filter(e => e.storage_key.startsWith('obs-done-ts-'))
R.done_ts = { count: done.length, non_numeric: done.filter(e => !/^\d+$/.test(e.raw_payload)).length,
  distinct_values: new Set(done.map(e => e.raw_payload)).size,
  min: new Date(Math.min(...done.map(e => +e.raw_payload))).toISOString(), max: new Date(Math.max(...done.map(e => +e.raw_payload))).toISOString() }
R.invalid_json_entries = c.entries.filter(e => !e.storage_key.startsWith('obs-done-ts-')).filter(e => { try { JSON.parse(e.raw_payload); return false } catch { return true } }).map(e => e.storage_key)
console.log(JSON.stringify(R, null, 2))
