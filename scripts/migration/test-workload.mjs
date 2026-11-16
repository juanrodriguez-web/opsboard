// Tests for src/lib/workload.js. node scripts/migration/test-workload.mjs
import assert from 'node:assert/strict'
import { weekStart, weekList, loadLevel, utilization, workloadRows, workloadSummary } from '../../src/lib/workload.js'

const D = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12) }
// 2026-11-16 is a Monday
assert.equal(weekStart('2026-11-16'), '2026-11-16'); assert.equal(weekStart('2026-11-22'), '2026-11-16', 'Sunday belongs to the week that started Monday')
assert.equal(weekStart('2026-11-18'), '2026-11-16'); assert.equal(weekStart('2026-11-23'), '2026-11-23')
assert.equal(weekStart('2027-01-01'), '2026-12-28', 'crosses the year')
assert.deepEqual(weekList('2026-11-18', 3), ['2026-11-16', '2026-11-23', '2026-11-30'])

assert.equal(loadLevel(10, null), 'none'); assert.equal(loadLevel(10, 0), 'none')
assert.equal(loadLevel(20, 40), 'ok'); assert.equal(loadLevel(34, 40), 'high', '85% is high'); assert.equal(loadLevel(40, 40), 'high', 'exactly 100% is not over')
assert.equal(loadLevel(40.5, 40), 'over'); assert.equal(utilization(10, null), null); assert.equal(utilization(20, 40), 0.5)

const people = [{ id: 'j', name: 'Juan Rodriguez Peisel', capacityH: 40 }, { id: 'f', name: 'Francisco Toledo', capacityH: null }]
const it = (id, owner, status, due, h) => ({ id, tema: id, propietario: owner, status, fechaFin: due ? D(due) : null, estimateH: h })
const items = [
  it('a', 'Juan Rodriguez Peisel', 'inprogress', '2026-11-17', 10),     // this week
  it('b', 'juan rodriguez peisel', 'pending', '2026-11-20', 8),         // this week (name matching ignores case)
  it('c', 'Juan Rodriguez Peisel', 'blocked', '2026-11-25', 30),        // next week
  it('d', 'Juan Rodriguez Peisel', 'pending', '2026-11-10', 5),         // overdue -> current week
  it('e', 'Juan Rodriguez Peisel', 'done', '2026-11-18', 99),           // done: ignored
  it('f', 'Juan Rodriguez Peisel', 'backlog', '2026-11-18', 99),        // backlog: ignored
  it('g', 'Juan Rodriguez Peisel', 'pending', null, 4),                 // no date
  it('h', 'Juan Rodriguez Peisel', 'pending', '2026-11-19', null),      // no estimate
  it('i', 'Juan Rodriguez Peisel', 'pending', '2027-06-01', 6),         // beyond the horizon
  it('j', 'Francisco Toledo', 'pending', '2026-11-18', 12),
  it('k', 'Nacho Cruz', 'pending', '2026-11-18', 3),                    // not in people
  it('l', '', 'pending', '2026-11-18', 3),                              // no owner
  it('m', 'Juan Rodriguez Peisel', 'pending', '2026-11-18', 0),         // zero hours = no estimate
]
const { weeks, rows, unassigned } = workloadRows(people, items, '2026-11-16', 4)
assert.deepEqual(weeks, ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'])
const j = rows[0], f = rows[1]
assert.equal(j.weeks[0].hours, 23, 'a 10 + b 8 + overdue d 5'); assert.deepEqual(j.weeks[0].items.map(i => i.id).sort(), ['a', 'b', 'd', 'h', 'm'])
assert.equal(j.weeks[1].hours, 30); assert.equal(j.weeks[1].level, 'ok', '30/40 = 75%')
assert.equal(j.weeks[0].level, 'ok', '23/40')
assert.equal(j.noDate.hours, 4); assert.deepEqual(j.noDate.items.map(i => i.id), ['g'])
assert.deepEqual(j.later.items.map(i => i.id), ['i']); assert.equal(j.later.hours, 6)
assert.deepEqual(j.unestimated.map(i => i.id).sort(), ['h', 'm'], 'items without hours are counted, not guessed')
assert.equal(j.overdue, 1)
assert.equal(f.capacityH, null); assert.equal(f.weeks[0].hours, 12); assert.equal(f.weeks[0].level, 'none', 'no capacity -> no level')
assert.deepEqual(unassigned.map(i => i.id).sort(), ['k', 'l'], 'owners outside the people list are reported, not dropped silently')

const over = workloadRows([{ id: 'x', name: 'X', capacityH: 10 }], [it('o', 'X', 'pending', '2026-11-18', 12)], '2026-11-18', 2)
assert.equal(over.rows[0].weeks[0].level, 'over')
const s = workloadSummary(rows); assert.equal(s.hoursThisWeek, 35); assert.equal(s.capacityThisWeek, 40); assert.equal(s.overloaded, 0); assert.equal(s.unestimated, 2); assert.equal(s.overdue, 1)
assert.equal(workloadSummary(over.rows).overloaded, 1)
assert.deepEqual(workloadRows([], items, '2026-11-16').rows, [])
console.log('workload: all assertions PASS')
