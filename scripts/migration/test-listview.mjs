// Tests for src/lib/listview.js (filters, operators, relative dates, sorting, grouping, presets, config sanitising).
//   node scripts/migration/test-listview.mjs
import assert from 'node:assert/strict'
import { applyFilters, sortItems, groupItems, runView, PRESETS, resolveValue, normalizeConfig, matches, DEFAULT_COLUMNS } from '../../src/lib/listview.js'

// Friday 13 Nov 2026
const today = '2026-11-13'
const ctx = { today, me: 'Juan Rodriguez Peisel' }
const at = (y, m, d) => new Date(y, m - 1, d, 12)
const mk = (id, o) => ({ id, tema: 'Tema ' + id, propietario: 'Juan Rodriguez Peisel', status: 'pending', prioridad: 'P2', proyecto: '', category: 'projects', risk: 'green', fechaFin: null, fechaInicio: null, ...o })
const items = [
  mk('a', { status: 'inprogress', prioridad: 'P0', fechaFin: at(2026, 11, 10), proyecto: 'Alpha' }),
  mk('b', { status: 'blocked', prioridad: 'P1', fechaFin: at(2026, 11, 13), propietario: 'Francisco Toledo', proyecto: 'Alpha' }),
  mk('c', { status: 'done', prioridad: 'P3', fechaFin: at(2026, 11, 1), proyecto: 'Beta' }),
  mk('d', { status: 'pending', prioridad: '', fechaFin: at(2026, 11, 15), proyecto: 'Beta', category: 'tools' }),
  mk('e', { status: 'backlog', prioridad: 'P2', fechaFin: null, propietario: '' }),
  mk('f', { status: 'pending', prioridad: 'P1', fechaFin: at(2026, 11, 30), proyecto: 'Árbol', tema: 'Revisión ÁRBOL de decisión' }),
]
const ids = l => l.map(i => i.id)
const F = (field, op, value) => ({ field, op, value })

// relative values
assert.equal(resolveValue('@today', ctx), today); assert.equal(resolveValue('@me', ctx), 'Juan Rodriguez Peisel')
assert.equal(resolveValue('@week', ctx), '2026-11-15', 'Friday -> Sunday of that week'); assert.equal(resolveValue('@week_start', ctx), '2026-11-09')
assert.equal(resolveValue('@week', { today: '2026-11-15' }), '2026-11-15', 'Sunday is its own week end'); assert.equal(resolveValue('@week_start', { today: '2026-11-15' }), '2026-11-09')
assert.equal(resolveValue('plain', ctx), 'plain')

// enum operators
assert.deepEqual(ids(applyFilters(items, [F('status', 'eq', 'pending')], ctx)), ['d', 'f'])
assert.deepEqual(ids(applyFilters(items, [F('status', 'neq', 'pending')], ctx)), ['a', 'b', 'c', 'e'])
assert.deepEqual(ids(applyFilters(items, [F('prioridad', 'in', ['P0', 'P1'])], ctx)), ['a', 'b', 'f'])
assert.deepEqual(ids(applyFilters(items, [F('status', 'not_in', ['done', 'backlog'])], ctx)), ['a', 'b', 'd', 'f'])
assert.deepEqual(ids(applyFilters(items, [F('prioridad', 'empty')], ctx)), ['d']); assert.equal(applyFilters(items, [F('prioridad', 'not_empty')], ctx).length, 5)
assert.deepEqual(ids(applyFilters(items, [F('propietario', 'eq', '@me')], ctx)), ['a', 'c', 'd', 'f'], '@me, ignoring accents/case')
assert.deepEqual(ids(applyFilters(items, [F('propietario', 'eq', 'juan  RODRÍGUEZ peisel')], ctx)), ['a', 'c', 'd', 'f'])
// combined (AND)
assert.deepEqual(ids(applyFilters(items, [F('propietario', 'eq', '@me'), F('status', 'not_in', ['done', 'backlog']), F('prioridad', 'in', ['P0', 'P1'])], ctx)), ['a', 'f'])
// dates
assert.deepEqual(ids(applyFilters(items, [F('fechaFin', 'lt', '@today')], ctx)), ['a', 'c'], 'overdue; items without date never match <')
assert.deepEqual(ids(applyFilters(items, [F('fechaFin', 'lte', '@week')], ctx)), ['a', 'b', 'c', 'd'], 'due this week or before')
assert.deepEqual(ids(applyFilters(items, [F('fechaFin', 'gte', '@today'), F('fechaFin', 'lte', '@week')], ctx)), ['b', 'd'])
assert.deepEqual(ids(applyFilters(items, [F('fechaFin', 'eq', '2026-11-13')], ctx)), ['b'])
assert.deepEqual(ids(applyFilters(items, [F('fechaFin', 'empty')], ctx)), ['e'])
assert.ok(ids(applyFilters(items, [F('fechaFin', 'neq', '2026-11-13')], ctx)).includes('e'), 'no date is "not equal" to a date')
// text (accent/case-insensitive)
assert.deepEqual(ids(applyFilters(items, [F('tema', 'contains', 'arbol')], ctx)), ['f'])
assert.deepEqual(ids(applyFilters(items, [F('proyecto', 'eq', 'arbol')], ctx)), ['f'])
assert.equal(applyFilters(items, [F('tema', 'not_contains', 'tema')], ctx).length, 1)
// incomplete filters (no value yet) do not hide everything
assert.equal(applyFilters(items, [F('tema', 'contains', '')], ctx).length, 6); assert.equal(applyFilters(items, [F('status', 'in', [])], ctx).length, 6)
assert.equal(applyFilters(items, [F('unknown', 'eq', 'x')], ctx).length, 6, 'unknown field ignored')

// sorting
assert.deepEqual(ids(sortItems(items, [{ field: 'fechaFin', dir: 'asc' }])), ['c', 'a', 'b', 'd', 'f', 'e'], 'empty dates last')
assert.deepEqual(ids(sortItems(items, [{ field: 'fechaFin', dir: 'desc' }])), ['f', 'd', 'b', 'a', 'c', 'e'], 'empty dates still last when descending')
assert.deepEqual(ids(sortItems(items, [{ field: 'prioridad', dir: 'asc' }])), ['a', 'b', 'f', 'e', 'c', 'd'], 'P0 first, empty last')
assert.deepEqual(ids(sortItems(items, [{ field: 'status', dir: 'asc' }, { field: 'prioridad', dir: 'asc' }])), ['f', 'd', 'a', 'b', 'c', 'e'], 'multi-key, workflow order for status')
assert.deepEqual(ids(sortItems(items, [{ field: 'tema', dir: 'asc' }])).slice(0, 2), ['f', 'a'])

// grouping
let g = groupItems(items, 'status', ctx)
assert.deepEqual(g.map(x => x.key), ['pending', 'inprogress', 'blocked', 'done', 'backlog']); assert.equal(g[0].label, 'Pendiente')
g = groupItems(items, 'prioridad', ctx); assert.deepEqual(g.map(x => x.key), ['P0', 'P1', 'P2', 'P3', '']); assert.equal(g.at(-1).label, 'Sin prioridad')
g = groupItems(items, 'proyecto', ctx); assert.deepEqual(g.map(x => x.label), ['Alpha', 'Árbol', 'Beta', 'Sin proyecto'], 'alphabetical ignoring accents, empty last')
g = groupItems(items, 'due', ctx); assert.deepEqual(g.map(x => x.key), ['overdue', 'today', 'week', 'later', 'none']); assert.deepEqual(ids(g[0].items), ['a', 'c']); assert.deepEqual(ids(g[2].items), ['d'])
assert.deepEqual(groupItems(items, '', ctx).length, 1)

// presets (the screens' built-in views)
const run = id => ids(runView(items, PRESETS.find(p => p.id === id).config, ctx).groups.flatMap(x => x.items))
assert.deepEqual(run('all'), ['a', 'b', 'd', 'f']); assert.deepEqual(run('mine'), ['a', 'd', 'f'], 'my tasks: mine, active, by due date')
assert.deepEqual(run('urgent'), ['a', 'b', 'f']); assert.deepEqual(run('overdue'), ['a']); assert.deepEqual(run('blocked'), ['b']); assert.deepEqual(run('thisweek'), ['b', 'd'])
assert.deepEqual(runView(items, PRESETS.find(p => p.id === 'byproject').config, ctx).groups.map(x => x.label), ['Alpha', 'Árbol', 'Beta'])
assert.equal(runView(items, PRESETS[0].config, ctx).total, 4)

// stale/invalid stored configs never break the screen
const n = normalizeConfig({ filters: [F('status', 'eq', 'x'), F('ghost', 'eq', 1), F('status', 'between', 3)], sort: [{ field: 'zzz' }, { field: 'tema', dir: 'weird' }], groupBy: 'nope', columns: ['tema', 'zzz'] })
assert.deepEqual(n.filters, [F('status', 'eq', 'x')]); assert.deepEqual(n.sort, [{ field: 'tema', dir: 'asc' }]); assert.equal(n.groupBy, ''); assert.deepEqual(n.columns, ['tema'])
assert.deepEqual(normalizeConfig(null).columns, DEFAULT_COLUMNS)
assert.equal(matches(items[0], F('status', 'eq', 'inprogress'), ctx), true)
console.log('list view engine: all assertions PASS')
