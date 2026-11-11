// Loads capture files (see ../capture/capture-localstorage.js) into `legacy_localstorage_import`.
// `query(sql, params)` is any Postgres executor (PGlite in tests, a real connection later).
// The server derives payload_hash / parsed_payload; identical (source, key, content) is skipped.
const FORMAT = 'opsboard-localstorage-capture'
const ALLOWED = k => ['obs-comments', 'obs-proj-comments', 'obs-proy-overrides', 'obs-status-overrides', 'obs-local-items'].includes(k) || k.startsWith('obs-done-ts-')

export function validateCapture(c) {
  const errs = []
  if (!c || c.format !== FORMAT) errs.push('bad format')
  if (c?.version !== 1) errs.push('unsupported version')
  for (const f of ['capture_id', 'source_id', 'captured_at']) if (!c?.[f]) errs.push('missing ' + f)
  if (!Array.isArray(c?.entries)) errs.push('entries must be an array')
  else for (const e of c.entries) {
    if (typeof e.raw_payload !== 'string') errs.push(`entry ${e.storage_key}: raw_payload must be a string`)
    if (!ALLOWED(e.storage_key)) errs.push(`entry ${e.storage_key}: key not allowed`)
  }
  return errs
}

export async function ingestCapture(query, capture, { migrationVersion = 'f1c-1' } = {}) {
  const errs = validateCapture(capture)
  if (errs.length) throw new Error('invalid capture: ' + errs.join('; '))
  const r = { inserted: 0, duplicates: 0, parse_failed: 0, same_payload_other_source: 0 }
  for (const e of capture.entries) {
    const res = await query(
      `insert into legacy_localstorage_import (capture_id, source_id, source_label, origin, storage_key, raw_payload, migration_version, captured_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (source_id, storage_key, payload_hash) do nothing
       returning capture_status`,
      [capture.capture_id, capture.source_id, capture.source_label ?? null, capture.origin ?? null, e.storage_key, e.raw_payload, migrationVersion, capture.captured_at])
    if (res.rows.length) {
      r.inserted++
      if (res.rows[0].capture_status === 'PARSE_FAILED') r.parse_failed++
      const other = await query(
        `select 1 from legacy_localstorage_import where storage_key = $1 and source_id <> $2 and payload_hash = encode(sha256(convert_to($3,'UTF8')),'hex') limit 1`,
        [e.storage_key, capture.source_id, e.raw_payload])
      if (other.rows.length) r.same_payload_other_source++
    } else r.duplicates++
  }
  return r
}
