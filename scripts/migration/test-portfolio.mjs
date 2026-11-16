// Tests for src/lib/portfolio.js. node scripts/migration/test-portfolio.mjs
import assert from 'node:assert/strict'
import { itemsOfProject, projectStats, portfolioRows, portfolioSummary, filterRows, sortRows, overview, daysLeft, HEALTH_LABEL } from '../../src/lib/portfolio.js'

const today = '2026-11-16'
const at = (y, m, d) => new Date(y, m - 1, d, 12)
const mkP = (nombre, o) => ({ id: nombre, nombre, status: 'inprogress', health: 'not_set', propietario: '', fechaFin: null, ...o })
const mkI = (id, proyecto, o) => ({ id, tema: 'T' + id, proyecto, status: 'pending', propietario: '', fechaFin: null, updated_at: '2026-11-0' + (Number(id.replace(/\D/g, '')) % 9 + 1), ...o })
const P = {
  alpha: mkP('Alpha', { health: 'at_risk', propietario: 'Juan Rodriguez Peisel', fechaFin: at(2026, 12, 1) }),
  beta:  mkP('Beta', { health: 'on_track', propietario: 'Francisco Toledo', fechaFin: at(2026, 11, 10) }),
  gamma: mkP('Gamma Árbol', { status: 'done', health: 'on_track' }),
  delta: mkP('Delta', { status: 'backlog' }),
  eps:   mkP('Épsilon', { health: 'off_track', propietario: 'Juan Rodriguez Peisel' }),
  zero:  mkP('Sin temas'),
}
const items = [
  mkI('1', 'Alpha', { status: 'done' }), mkI('2', 'alpha', { status: 'inprogress', fechaFin: at(2026, 11, 20), propietario: 'Juan Rodriguez Peisel' }),
  mkI('3', 'ALPHA ', { status: 'blocked', fechaFin: at(2026, 11, 1), propietario: 'Francisco Toledo' }), mkI('4', 'Alpha', { status: 'backlog' }),
  mkI('5', 'Alpha', { status: 'pending' }),
  mkI('6', 'Beta', { status: 'done' }), mkI('7', 'Beta', { status: 'done' }),
  mkI('8', 'gamma arbol', { status: 'done' }), mkI('9', '', { status: 'pending' }), mkI('10', 'Otro', { status: 'blocked' }),
]
const projects = Object.values(P)

// linking by normalized name
assert.deepEqual(itemsOfProject(P.alpha, items).map(i => i.id), ['1', '2', '3', '4', '5'], 'case/space-insensitive, excludes other projects and unassigned items')
assert.deepEqual(itemsOfProject(P.gamma, items).map(i => i.id), ['8'], 'accent-insensitive')
assert.deepEqual(itemsOfProject({ nombre: '' }, items), [], 'a nameless project links nothing')

// stats
const s = projectStats(P.alpha, items, today)
assert.deepEqual({ ...s }, { total: 5, done: 1, active: 3, backlog: 1, blockers: 1, overdue: 1, progress: 20, nextDue: '2026-11-20' })
assert.equal(projectStats(P.beta, items, today).progress, 100); assert.equal(projectStats(P.zero, items, today).progress, null, 'no items -> no progress')
assert.equal(projectStats(P.beta, items, today).nextDue, null)

assert.equal(daysLeft(P.alpha, today), 15); assert.equal(daysLeft(P.beta, today), -6); assert.equal(daysLeft(P.zero, today), null)

// rows, summary, filters
const rows = portfolioRows(projects, items, today)
assert.equal(rows.length, 6)
const sum = portfolioSummary(rows)
assert.deepEqual(sum, { projects: 6, open: 4, atRisk: 1, offTrack: 1, notSet: 1, blockers: 1, overdue: 1 }, 'summary counts open projects (not completed / backlog)')
const names = r => r.map(x => x.project.nombre)
assert.deepEqual(names(filterRows(rows)).sort(), ['Alpha', 'Beta', 'Sin temas', 'Épsilon'].sort(), 'default: open projects')
assert.deepEqual(names(filterRows(rows, { state: 'done' })), ['Gamma Árbol']); assert.deepEqual(names(filterRows(rows, { state: 'backlog' })), ['Delta']); assert.equal(filterRows(rows, { state: 'all' }).length, 6)
assert.deepEqual(names(filterRows(rows, { owner: 'juan rodríguez peisel' })).sort(), ['Alpha', 'Épsilon'], 'owner filter ignores accents/case')
assert.deepEqual(names(filterRows(rows, { health: 'at_risk' })), ['Alpha']); assert.deepEqual(names(filterRows(rows, { health: 'not_set', state: 'all' })).sort(), ['Delta', 'Sin temas'])

// sorting: worst health first by default; empties last
assert.deepEqual(names(sortRows(filterRows(rows), 'health', 'asc')), ['Épsilon', 'Alpha', 'Beta', 'Sin temas'], 'worst health first, undefined last')
assert.deepEqual(names(sortRows(filterRows(rows), 'health', 'desc')).at(-1), 'Sin temas', 'undefined stays last when descending')
assert.deepEqual(names(sortRows(rows, 'progress', 'desc')).slice(0, 3), ['Beta', 'Gamma Árbol', 'Alpha'], 'progress desc, projects without items last')
assert.equal(names(sortRows(rows, 'progress', 'asc')).at(-1), 'Sin temas', 'empty progress stays last when ascending (alphabetical among empties)')
assert.deepEqual(names(sortRows(rows, 'target', 'asc')).slice(0, 2), ['Beta', 'Alpha'], 'dates ascending, no date last')
assert.deepEqual(names(sortRows(rows, 'nombre', 'asc')).slice(0, 2), ['Alpha', 'Beta'])
assert.deepEqual(names(sortRows(rows, 'overdue', 'desc'))[0], 'Alpha')

// overview
const o = overview(P.alpha, items, today)
assert.deepEqual(o.blockers.map(i => i.id), ['3']); assert.deepEqual(o.overdue.map(i => i.id), ['3']); assert.deepEqual(o.upcoming.map(i => i.id), ['2'])
assert.deepEqual(o.team.sort(), ['Francisco Toledo', 'Juan Rodriguez Peisel']); assert.equal(o.stats.progress, 20)
assert.ok(o.recent.length > 0 && o.recent.length <= 6)
assert.equal(HEALTH_LABEL.at_risk, 'En riesgo')
console.log('portfolio: all assertions PASS')
