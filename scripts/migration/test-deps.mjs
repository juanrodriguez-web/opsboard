// Tests for src/lib/deps.js. node scripts/migration/test-deps.mjs
import assert from 'node:assert/strict'
import { wouldCreateCycle, blockersOf, blockedBy, relatedTo, unresolvedBlockers, blockedIdSet, candidatesFor, completionWarning } from '../../src/lib/deps.js'

const it = (id, status = 'pending') => ({ id, tema: 'Tema ' + id, status })
const items = [it('A'), it('B'), it('C', 'done'), it('D'), it('E', 'inprogress'), it('F')]
const R = (id, kind, fromId, toId) => ({ id, kind, fromId, toId })
// A blocks B, B blocks D, C(done) blocks D, E related F
const rel = [R(1, 'blocks', 'A', 'B'), R(2, 'blocks', 'B', 'D'), R(3, 'blocks', 'C', 'D'), R(4, 'related', 'E', 'F')]

assert.deepEqual(blockersOf('D', rel).sort(), ['B', 'C']); assert.deepEqual(blockedBy('A', rel), ['B']); assert.deepEqual(blockersOf('A', rel), [])
assert.deepEqual(relatedTo('E', rel), ['F']); assert.deepEqual(relatedTo('F', rel), ['E']); assert.deepEqual(relatedTo('A', rel), [])
assert.deepEqual(blockersOf('E', rel), [], 'related is not a block')

// one stored row is both "A blocks B" and "B is blocked by A"
assert.ok(blockedBy('A', rel).includes('B') && blockersOf('B', rel).includes('A'))

// unresolved: only blockers that are not done
assert.deepEqual(unresolvedBlockers('D', rel, items).map(i => i.id), ['B'], 'C is done so it no longer blocks')
assert.deepEqual(unresolvedBlockers('B', rel, items).map(i => i.id), ['A']); assert.deepEqual(unresolvedBlockers('A', rel, items), [])
assert.deepEqual(unresolvedBlockers('D', [R(9, 'blocks', 'GONE', 'D')], items), [], 'a deleted blocker is ignored')
assert.deepEqual([...blockedIdSet(rel, items)].sort(), ['B', 'D'], 'badge set: blocked by an unresolved item, and not itself done')
assert.deepEqual([...blockedIdSet([R(1, 'blocks', 'A', 'C')], items)], [], 'a done item is never shown as blocked')

// cycles
assert.equal(wouldCreateCycle(rel, 'A', 'A'), true, 'self')
assert.equal(wouldCreateCycle(rel, 'D', 'A'), true, 'D blocks A would close A->B->D->A')
assert.equal(wouldCreateCycle(rel, 'B', 'A'), true, 'direct reverse')
assert.equal(wouldCreateCycle(rel, 'A', 'D'), false, 'A already reaches D: redundant but no loop')
assert.equal(wouldCreateCycle(rel, 'F', 'A'), false); assert.equal(wouldCreateCycle(rel, 'E', 'F'), false, 'related edges do not count')
assert.equal(wouldCreateCycle([R(1, 'blocks', 'X', 'Y'), R(2, 'blocks', 'Y', 'X')], 'Z', 'X'), false, 'terminates on an existing loop elsewhere')

// candidates
const ids = l => l.map(i => i.id).sort()
assert.deepEqual(ids(candidatesFor('A', 'blocks', 'blockedBy', rel, items)), ['C', 'E', 'F'], 'A cannot be blocked by D (loop) nor by B (already linked)')
assert.deepEqual(ids(candidatesFor('A', 'blocks', 'blocks', rel, items)), ['C', 'D', 'E', 'F'], 'A may block anything not linked yet and not creating a loop')
assert.deepEqual(ids(candidatesFor('E', 'related', 'blocks', rel, items)), ['A', 'B', 'C', 'D'], 'related: only excludes itself and the already related')

// completion warning
const w = completionWarning('D', rel, items)
assert.match(w, /depende de un tema sin completar: "Tema B"/); assert.match(w, /¿Marcarlo como completado igualmente\?/)
assert.equal(completionWarning('A', rel, items), null); assert.equal(completionWarning('C', rel, items), null)
const many = completionWarning('X', [R(1, 'blocks', 'a', 'X'), R(2, 'blocks', 'b', 'X'), R(3, 'blocks', 'c', 'X'), R(4, 'blocks', 'd', 'X')], ['a', 'b', 'c', 'd', 'X'].map(i => it(i)))
assert.match(many, /4 temas sin completar/); assert.match(many, /y 1 más/)
console.log('dependencies: all assertions PASS')