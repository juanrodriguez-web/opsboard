// Tests for the data-layer port of bin/process-intake.js (applyUpdates / loadData / saveItemFields). No network, no Claude.
//   VITE_SUPABASE_URL=http://x VITE_SUPABASE_ANON_KEY=x node scripts/migration/test-process-intake.cjs
const assert = require('node:assert/strict')
process.env.VITE_SUPABASE_URL ||= 'http://localhost:1'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test'
delete process.env.DATA_BACKEND; delete process.env.VITE_DATA_BACKEND
const intake = require('../../bin/process-intake.js')

const calls = []
const items = [{ id: 'a1', tema: 'Tema A', notas: 'previa', status: 'pending' }, { id: 'b2', tema: 'Tema B', notas: '', status: 'pending' }]
intake._setPmApi({
  updateItem: async (id, f) => { calls.push([id, f]); if (id === 'bad') throw new Error('boom') },
  listItems: async () => items, listProyectos: async () => [{ id: 'p1', nombre: 'P', status: 'pending' }],
})

;(async () => {
  assert.equal(intake.BACKEND, 'pm', 'default backend is pm after the cutover')
  const d = await intake.loadData(); assert.equal(d.items.length, 2); assert.equal(d.proyectos.length, 1)

  const analysis = (updates, matches = [{ type: 'item', id: 'a1', name: 'Tema A' }, { type: 'item', id: 'b2', name: 'Tema B' }, { type: 'proyecto', id: 'p1', name: 'P' }]) =>
    ({ matches, updates, extractedComment: 'resumen' })

  let r = await intake.applyUpdates(analysis([{ matchId: 'a1', field: 'status', value: 'done', reason: 'r' }]), 'f.eml', items)
  assert.deepEqual(r, { success: 1, pending: 0, errors: 0 })
  assert.equal(calls[0][0], 'a1'); assert.equal(calls[0][1].status, 'done'); assert.equal(calls[0][1].estadoSheet, 'Hecho')
  assert.match(calls[0][1].notas, /^previa\n\[.*\] resumen$/, 'note appended to existing notes')

  r = await intake.applyUpdates(analysis([{ matchId: 'b2', field: 'status', value: 'En curso??', reason: 'r' }]), 'f.eml', items)
  assert.equal(r.success, 1); assert.equal(calls[1][1].status, undefined, 'invalid status is not written'); assert.match(calls[1][1].notas, /\[.*\] resumen/)

  r = await intake.applyUpdates(analysis([{ matchId: 'b2', field: 'fecha_fin', value: '2026-12-31', reason: 'r' }]), 'f.eml', items)
  assert.equal(calls[2][1].fechaFin, '2026-12-31')

  r = await intake.applyUpdates(analysis([{ matchId: 'p1', field: 'status', value: 'done', reason: 'r' }]), 'f.eml', items)
  assert.deepEqual(r, { success: 0, pending: 1, errors: 0 }, 'projects stay manual-confirmation')

  r = await intake.applyUpdates(analysis([{ matchId: 'zzz', field: 'status', value: 'done' }]), 'f.eml', items)
  assert.deepEqual(r, { success: 0, pending: 0, errors: 0 }, 'unknown match is skipped')

  const before = calls.length
  r = await intake.applyUpdates(analysis([{ matchId: 'bad', field: 'status', value: 'done', reason: 'r' }], [{ type: 'item', id: 'bad', name: 'Bad' }]), 'f.eml', [{ id: 'bad', tema: 'Bad', notas: '' }])
  assert.deepEqual(r, { success: 0, pending: 0, errors: 1 }, 'a failing write is counted, not thrown'); assert.equal(calls.length, before + 1)

  r = await intake.applyUpdates({ matches: [], updates: [] }, 'f.eml', items); assert.deepEqual(r, { success: 0, pending: 0, errors: 0 })
  console.log('process-intake data layer: all assertions PASS')
})().catch(e => { console.error(e); process.exit(1) })
