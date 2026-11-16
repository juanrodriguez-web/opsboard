// Backlog Mail: pure helpers (no React, no network), tested in plain Node.
// A candidate (UI shape, camelCase): { id, messageId, subject, senderName, senderEmail, receivedAt, summary, suggestedTitle, kind,
//   suggestedProject, suggestedPriority, dueDate ('YYYY-MM-DD'|null), prioritySender, duplicateOf, webLink, status, createdRef }
import { cleanEmail } from './mywork.js'

const PRIO_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, '': 4 }

// Pending list: priority senders first, then by suggested priority, then newest first.
export function sortCandidates(list) {
  return [...list].sort((a, b) =>
    (b.prioritySender ? 1 : 0) - (a.prioritySender ? 1 : 0) ||
    (PRIO_RANK[a.suggestedPriority] ?? 4) - (PRIO_RANK[b.suggestedPriority] ?? 4) ||
    String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')))
}

// Validates a candidate coming from the ingestion (skill). Returns { ok, row?, reason? } with the DB column names.
export function validateIncoming(c) {
  const messageId = String(c?.messageId ?? '').trim()
  const title = String(c?.suggestedTitle ?? '').trim()
  if (!messageId) return { ok: false, reason: 'missing messageId' }
  if (!title) return { ok: false, reason: 'missing suggestedTitle' }
  const kind = c.kind === 'project' ? 'project' : 'topic'
  const prio = ['P0', 'P1', 'P2', 'P3'].includes(c.suggestedPriority) ? c.suggestedPriority : ''
  const due = /^\d{4}-\d{2}-\d{2}$/.test(c.dueDate || '') ? c.dueDate : null
  const email = cleanEmail(c.senderEmail) || ''
  return { ok: true, row: {
    message_id: messageId, thread_id: c.threadId || null, subject: String(c.subject ?? '').slice(0, 300),
    sender_name: String(c.senderName ?? '').slice(0, 120), sender_email: email,
    received_at: c.receivedAt || null,
    summary: String(c.summary ?? '').slice(0, 600),          // short summary only: never the body
    suggested_title: title.slice(0, 200), kind, suggested_project: String(c.suggestedProject ?? '').trim(),
    suggested_priority: prio, due_date: due, priority_sender: !!c.prioritySender,
    duplicate_of: String(c.duplicateOf ?? '').trim(), web_link: String(c.webLink ?? '').slice(0, 1000),
  } }
}

const notesFor = c => [c.summary, `Origen: correo de ${c.senderName || c.senderEmail || 'desconocido'}${c.subject ? ` — "${c.subject}"` : ''}`, c.webLink ? `Enlace: ${c.webLink}` : ''].filter(Boolean).join('\n\n')
const noonLocal = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12) }
const RISK = { P0: 'red', P1: 'yellow', P2: 'green', P3: 'green', '': 'green' }

// What "Crear" produces for a topic: a PENDING item without owner (to be assigned later). `edits` = what the user changed in the card.
export function candidateToItem(c, edits = {}, id) {
  const prio = edits.suggestedPriority ?? c.suggestedPriority
  const due = edits.dueDate !== undefined ? edits.dueDate : c.dueDate
  return {
    id, tema: String(edits.suggestedTitle ?? c.suggestedTitle).trim(), objetivo: '', category: 'projects', propietario: '',
    prioridad: prio || '', risk: RISK[prio || ''], status: 'pending', estadoSheet: 'No iniciado',
    fechaInicio: null, fechaFin: due ? noonLocal(due) : null, archivos: '', notas: notesFor(c),
    proyecto: String(edits.suggestedProject ?? c.suggestedProject ?? '').trim(), subtareas: [], _local: true,
  }
}

// What "Crear" produces for a project.
export function candidateToProject(c, edits = {}, id) {
  const prio = edits.suggestedPriority ?? c.suggestedPriority
  return { id, nombre: String(edits.suggestedTitle ?? c.suggestedTitle).trim(), descripcion: c.summary || '', propietario: '',
    prioridad: prio || '', status: 'pending', notas: notesFor(c) }
}
