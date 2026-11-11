/*
 * OpsBoard F1C — local capture of browser data.  Paste into the DevTools console (F12 → Console)
 * while on the PRODUCTION origin, once per browser profile that has ever been used with OpsBoard.
 *
 * What it does:
 *   - READS localStorage keys used by the legacy app (whitelist below) and downloads them as ONE local JSON file.
 *   - Makes NO network request and does not touch the app, Supabase or any legacy key.
 *   - Its ONLY write: one new key `opsboard_source_id` (random UUID, not read by the app) so that later captures
 *     of this same browser profile are recognised as the same source. No fingerprinting.
 * Nothing leaves the machine until you choose to hand the file over.
 */
(() => {
  const FORMAT = 'opsboard-localstorage-capture', VERSION = 1, SOURCE_KEY = 'opsboard_source_id'
  const FIXED = ['obs-comments', 'obs-proj-comments', 'obs-proy-overrides', 'obs-status-overrides', 'obs-local-items']
  const DONE_PREFIX = 'obs-done-ts-'

  let sourceId = localStorage.getItem(SOURCE_KEY)
  if (!sourceId) { sourceId = crypto.randomUUID(); localStorage.setItem(SOURCE_KEY, sourceId) }
  const label = (typeof prompt === 'function' ? prompt('Optional label for this browser (e.g. "Juan - Chrome work"):', '') : '') || null

  const entries = [], ignored = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k === SOURCE_KEY) continue
    if (FIXED.includes(k) || k.startsWith(DONE_PREFIX)) entries.push({ storage_key: k, raw_payload: localStorage.getItem(k) })
    else if (k.startsWith('obs-')) ignored.push(k)            // UI preferences etc.: names only, values not exported
  }
  entries.sort((a, b) => a.storage_key.localeCompare(b.storage_key))

  const capture = { format: FORMAT, version: VERSION, capture_id: crypto.randomUUID(), source_id: sourceId, source_label: label,
                    origin: location.origin, captured_at: new Date().toISOString(), entries, ignored_keys: ignored }
  const name = `opsboard-capture-${location.hostname}-${sourceId.slice(0, 8)}-${capture.captured_at.slice(0, 10)}.json`
  const url = URL.createObjectURL(new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  console.log(`OpsBoard capture: ${entries.length} keys → ${name} (source ${sourceId}). Ignored UI keys: ${ignored.length}.`)
  return capture
})()
