// Tests for src/lib/mywork.js (My Work classification + e-mail cleaning). Plain Node, no dependencies.
//   node scripts/migration/test-mywork.mjs
import assert from 'node:assert/strict'
import { classifyMyWork, cleanEmail, dayKey, addDays, daysBetween } from '../../src/lib/mywork.js'

const now = new Date(2026, 10, 13, 15, 30)                         // 13 Nov 2026, local time
const at = (y, m, d) => new Date(y, m - 1, d, 12)                   // a due date (local noon, as the PM adapter returns)
const mk = (id, over) => ({ id, tema: 'T' + id, propietario: 'Juan Rodriguez Peisel', status: 'pending', prioridad: 'P2', fechaFin: null, ...over })
const items = [
  mk('overdue-old', { fechaFin: at(2026, 6, 1), prioridad: 'P3' }),
  mk('overdue-new', { fechaFin: at(2026, 11, 12), prioridad: 'P0' }),
  mk('today', { fechaFin: at(2026, 11, 13), status: 'inprogress' }),
  mk('today-midnight', { fechaFin: new Date(2026, 10, 13, 0, 0) }),   // legacy-style local midnight is still "today"
  mk('in3', { fechaFin: at(2026, 11, 16) }),
  mk('in7', { fechaFin: at(2026, 11, 20) }),
  mk('in8', { fechaFin: at(2026, 11, 21) }),
  mk('blocked-nodate', { status: 'blocked' }),
  mk('blocked-overdue', { status: 'blocked', fechaFin: at(2026, 11, 1) }),
  mk('nodate'),
  mk('done', { status: 'done', fechaFin: at(2026, 11, 1) }),
  mk('backlog', { status: 'backlog', fechaFin: at(2026, 11, 1) }),
  mk('other-owner', { propietario: 'Francisco Toledo', fechaFin: at(2026, 11, 1) }),
  mk('no-owner', { propietario: '', fechaFin: at(2026, 11, 1) }),
  mk('accents', { propietario: 'JUAN  rodríguez peisel', fechaFin: at(2026, 11, 14) }),
]
const g = classifyMyWork(items, 'Juan Rodriguez Peisel', now)
const ids = l => l.map(i => i.id)

assert.equal(g.today, '2026-11-13')
assert.deepEqual(ids(g.overdue), ['overdue-old', 'blocked-overdue', 'overdue-new'], 'overdue: oldest first')
assert.deepEqual(ids(g.dueToday).sort(), ['today', 'today-midnight'], 'today includes local-midnight dates')
assert.deepEqual(ids(g.upcoming), ['in3', 'accents', 'in7'].sort((a, b) => ({ in3: '2026-11-16', accents: '2026-11-14', in7: '2026-11-20' }[a]).localeCompare({ in3: '2026-11-16', accents: '2026-11-14', in7: '2026-11-20' }[b])), 'next 7 days inclusive, sorted by date; day 8 excluded')
assert.ok(!ids(g.upcoming).includes('in8'))
assert.deepEqual(ids(g.blocked).sort(), ['blocked-nodate', 'blocked-overdue'])
assert.deepEqual(ids(g.noDate).sort(), ['blocked-nodate', 'nodate'])
for (const excluded of ['done', 'backlog', 'other-owner', 'no-owner']) assert.ok(!ids(g.all).includes(excluded), excluded + ' is not my active work')
assert.ok(ids(g.all).includes('accents'), 'owner match ignores case, accents and extra spaces')
assert.equal(g.all.length, 11)
assert.equal(classifyMyWork(items, '', now).all.length, 0, 'no person -> nothing')
assert.equal(classifyMyWork(null, 'x', now).all.length, 0)

// priority breaks ties on the same day
const tie = classifyMyWork([mk('p3', { prioridad: 'P3', fechaFin: at(2026, 11, 14) }), mk('p0', { prioridad: 'P0', fechaFin: at(2026, 11, 14) })], 'Juan Rodriguez Peisel', now)
assert.deepEqual(ids(tie.upcoming), ['p0', 'p3'])

// date helpers
assert.equal(dayKey(new Date('x')), null); assert.equal(dayKey(null), null)
assert.equal(addDays('2026-12-28', 7), '2027-01-04'); assert.equal(addDays('2026-03-28', 3), '2026-03-31')
assert.equal(daysBetween('2026-11-13', '2026-11-16'), 3); assert.equal(daysBetween('2026-11-13', '2026-11-12'), -1)
assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2, 'DST change does not shift the count')

// e-mail cleaning
assert.equal(cleanEmail('  Juan@Empresa.COM '), 'juan@empresa.com')
for (const bad of ['', 'juan', 'juan@', '@x.com', 'a b@x.com', null, undefined]) assert.equal(cleanEmail(bad), null, String(bad))
console.log('my work: all assertions PASS')
