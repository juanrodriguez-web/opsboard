// Runs capture-localstorage.js against a fake browser and checks what it reads / writes / exports.
//   node scripts/migration/test-capture.mjs
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { validateCapture, ingestCapture } from './lib/f1c-ingest.mjs'

const store = new Map([
  ['obs-comments', '[{"k":"tema","ts":"1/1","text":"x","id":"c1","iso":"2026-01-01"}]'],
  ['obs-proy-overrides', '{"p":{"capex":1}}'], ['obs-done-ts-abc', '1700000000000'],
  ['obs-dash-own', 'team'], ['sb-secret-token', 'DO-NOT-EXPORT'], ['unrelated', 'x'],
])
const before = new Map(store)
const localStorage = { get length() { return store.size }, key: i => [...store.keys()][i], getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)),
  removeItem() { throw new Error('capture must never remove keys') }, clear() { throw new Error('capture must never clear') } }
const blobs = [], clicks = [], requests = []
const ctx = { localStorage, crypto: webcrypto, location: { origin: 'https://prod.example', hostname: 'prod.example' }, prompt: () => 'Juan - Chrome',
  Blob: class { constructor(parts) { this.text = parts.join(''); blobs.push(this) } }, URL: { createObjectURL: () => 'blob:x' },
  document: { createElement: () => ({ click() { clicks.push(this) } }) }, console: { log() {} },
  fetch: () => { requests.push('fetch'); throw new Error('no network allowed') }, XMLHttpRequest: class { constructor() { requests.push('xhr'); throw new Error('no network allowed') } } }
const capture = vm.runInNewContext(readFileSync('scripts/migration/capture/capture-localstorage.js', 'utf8'), ctx)

assert.equal(requests.length, 0, 'no network')
assert.equal(clicks.length, 1); assert.match(clicks[0].download, /^opsboard-capture-prod\.example-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.json$/)
const file = JSON.parse(blobs[0].text)
assert.deepEqual(file, JSON.parse(JSON.stringify(capture)))
assert.deepEqual(validateCapture(file), [])
assert.deepEqual(file.entries.map(e => e.storage_key), ['obs-comments', 'obs-done-ts-abc', 'obs-proy-overrides'])
assert.equal(file.entries.find(e => e.storage_key === 'obs-comments').raw_payload, before.get('obs-comments'), 'raw string preserved byte for byte')
assert.deepEqual(file.ignored_keys, ['obs-dash-own'], 'UI keys: names only')
assert.ok(!blobs[0].text.includes('DO-NOT-EXPORT') && !blobs[0].text.includes('unrelated'), 'non-obs keys never exported')
assert.equal(file.source_label, 'Juan - Chrome'); assert.equal(file.origin, 'https://prod.example')
// only write: the new source id; all legacy keys unchanged
const added = [...store.keys()].filter(k => !before.has(k)); assert.deepEqual(added, ['opsboard_source_id'])
for (const [k, v] of before) assert.equal(store.get(k), v)
// second run: same source id (recognises the same browser profile)
const second = vm.runInNewContext(readFileSync('scripts/migration/capture/capture-localstorage.js', 'utf8'), ctx)
assert.equal(second.source_id, file.source_id); assert.notEqual(second.capture_id, file.capture_id)
assert.equal(typeof ingestCapture, 'function')
console.log('capture snippet: all assertions PASS')
