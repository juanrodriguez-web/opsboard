// Tests for src/lib/mail.js. node scripts/migration/test-mail.mjs
import assert from 'node:assert/strict'
import { sortCandidates, validateIncoming, candidateToItem, candidateToProject } from '../../src/lib/mail.js'

const c = (id, o = {}) => ({ id, prioritySender: false, suggestedPriority: '', receivedAt: '2026-11-10T10:00:00Z', ...o })
assert.deepEqual(sortCandidates([c('a'), c('b', { prioritySender: true, suggestedPriority: 'P3' }), c('c', { suggestedPriority: 'P0' }), c('d', { prioritySender: true, suggestedPriority: 'P1' }), c('e', { suggestedPriority: 'P0', receivedAt: '2026-11-12T10:00:00Z' })]).map(x => x.id),
  ['d', 'b', 'e', 'c', 'a'], 'priority senders first (by priority), then by priority, then newest first')
assert.deepEqual(sortCandidates([]), [])

assert.equal(validateIncoming({}).ok, false); assert.equal(validateIncoming({ messageId: 'x' }).reason, 'missing suggestedTitle')
const v = validateIncoming({ messageId: ' m1 ', suggestedTitle: ' T ', senderEmail: 'A@B.com', suggestedPriority: 'P2', dueDate: '2026-12-31', summary: 'x'.repeat(900), prioritySender: 1, body: 'SECRET BODY', kind: 'project' })
assert.ok(v.ok); assert.equal(v.row.message_id, 'm1'); assert.equal(v.row.suggested_title, 'T'); assert.equal(v.row.sender_email, 'a@b.com')
assert.equal(v.row.summary.length, 600, 'summary is capped'); assert.ok(!('body' in v.row) && !JSON.stringify(v.row).includes('SECRET'), 'the body is never kept')
assert.equal(v.row.kind, 'project'); assert.equal(v.row.priority_sender, true)
assert.equal(validateIncoming({ messageId: 'm', suggestedTitle: 't', dueDate: '31/12/2026', suggestedPriority: 'urgent', senderEmail: 'nope' }).row.due_date, null)
const bad = validateIncoming({ messageId: 'm', suggestedTitle: 't', suggestedPriority: 'urgent', senderEmail: 'nope', kind: 'x' }).row
assert.equal(bad.suggested_priority, ''); assert.equal(bad.sender_email, ''); assert.equal(bad.kind, 'topic')

const cand = { id: 'u1', summary: 'Pedir presupuesto', subject: 'Re: licencias', senderName: 'Cristina Ferrando', senderEmail: 'c@x.es', webLink: 'https://o/1', suggestedTitle: 'Presupuesto licencias', suggestedProject: 'Proyecto A', suggestedPriority: 'P1', dueDate: '2026-12-01' }
const item = candidateToItem(cand, {}, 'new-id')
assert.equal(item.status, 'pending'); assert.equal(item.estadoSheet, 'No iniciado'); assert.equal(item.propietario, '', 'no owner: to be assigned later')
assert.equal(item.id, 'new-id'); assert.equal(item.tema, 'Presupuesto licencias'); assert.equal(item.prioridad, 'P1'); assert.equal(item.risk, 'yellow'); assert.equal(item.proyecto, 'Proyecto A')
assert.equal(item.fechaFin.getFullYear(), 2026); assert.equal(item.fechaFin.getMonth(), 11); assert.equal(item.fechaFin.getDate(), 1); assert.equal(item.fechaFin.getHours(), 12, 'local noon, like the rest of the app')
assert.match(item.notas, /Pedir presupuesto/); assert.match(item.notas, /Cristina Ferrando/); assert.match(item.notas, /Enlace: https:\/\/o\/1/)
const edited = candidateToItem(cand, { suggestedTitle: '  Otro título ', suggestedProject: '', suggestedPriority: 'P0', dueDate: null }, 'i2')
assert.equal(edited.tema, 'Otro título'); assert.equal(edited.proyecto, ''); assert.equal(edited.prioridad, 'P0'); assert.equal(edited.risk, 'red'); assert.equal(edited.fechaFin, null, 'user can clear the date')
const none = candidateToItem({ ...cand, suggestedPriority: '', dueDate: null, webLink: '', subject: '' }, {}, 'i3')
assert.equal(none.prioridad, ''); assert.equal(none.fechaFin, null); assert.ok(!/Enlace/.test(none.notas))
const proj = candidateToProject(cand, {}, 'p1')
assert.equal(proj.nombre, 'Presupuesto licencias'); assert.equal(proj.status, 'pending'); assert.equal(proj.propietario, ''); assert.equal(proj.id, 'p1'); assert.match(proj.notas, /Enlace/)
console.log('mail: all assertions PASS')