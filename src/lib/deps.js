// Dependencies between work items. Pure functions (no React, no network), tested in plain Node.
// Relation shape used by the UI: { id, kind: 'blocks' | 'related', fromId, toId } with app item ids.
//   kind 'blocks':  fromId BLOCKS toId  (== toId is blocked by fromId). Stored once; both directions are read from the same row.
//   kind 'related': symmetric, no planning constraint.

const RESOLVED = ['done']                              // a blocker only stops blocking once it is completed

// Would adding "from blocks to" close a loop? (i.e. `from` is already, directly or not, blocked by `to`.)
export function wouldCreateCycle(relations, from, to) {
  if (from === to) return true
  const next = new Map()
  for (const r of relations) if (r.kind === 'blocks') { if (!next.has(r.fromId)) next.set(r.fromId, []); next.get(r.fromId).push(r.toId) }
  const seen = new Set([to]), stack = [to]              // can we reach `from` by following "blocks" edges starting at `to`?
  while (stack.length) {
    const cur = stack.pop()
    for (const n of next.get(cur) || []) {
      if (n === from) return true
      if (!seen.has(n)) { seen.add(n); stack.push(n) }
    }
  }
  return false
}

export const blockersOf  = (id, relations) => relations.filter(r => r.kind === 'blocks' && r.toId === id).map(r => r.fromId)   // items that block `id`
export const blockedBy   = (id, relations) => relations.filter(r => r.kind === 'blocks' && r.fromId === id).map(r => r.toId)   // items `id` blocks
export const relatedTo   = (id, relations) => relations.filter(r => r.kind === 'related' && (r.fromId === id || r.toId === id)).map(r => (r.fromId === id ? r.toId : r.fromId))

// Blockers of `id` that are not completed yet (items that no longer exist are ignored).
export function unresolvedBlockers(id, relations, items) {
  const byId = new Map(items.map(i => [i.id, i]))
  return blockersOf(id, relations).map(b => byId.get(b)).filter(i => i && !RESOLVED.includes(i.status))
}

// Set of item ids that are currently blocked by an unresolved dependency (for badges).
export function blockedIdSet(relations, items) {
  const byId = new Map(items.map(i => [i.id, i]))
  const out = new Set()
  for (const r of relations) {
    if (r.kind !== 'blocks') continue
    const blocker = byId.get(r.fromId), blocked = byId.get(r.toId)
    if (blocker && blocked && !RESOLVED.includes(blocker.status) && !RESOLVED.includes(blocked.status)) out.add(r.toId)
  }
  return out
}

// Items that can still be offered as the other end of a new relation.
export function candidatesFor(id, kind, direction, relations, items) {
  const existing = new Set(relations.filter(r => r.fromId === id || r.toId === id).map(r => (r.fromId === id ? r.toId : r.fromId)))
  return items.filter(i => i.id !== id && !existing.has(i.id) &&
    (kind !== 'blocks' || !(direction === 'blockedBy' ? wouldCreateCycle(relations, i.id, id) : wouldCreateCycle(relations, id, i.id))))
}

export function completionWarning(id, relations, items) {
  const open = unresolvedBlockers(id, relations, items)
  if (!open.length) return null
  const names = open.slice(0, 3).map(i => `"${i.tema}"`).join(', ') + (open.length > 3 ? ` y ${open.length - 3} más` : '')
  return `Este tema depende de ${open.length === 1 ? 'un tema' : open.length + ' temas'} sin completar: ${names}.\n\n¿Marcarlo como completado igualmente?`
}
