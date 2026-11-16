#!/usr/bin/env node
// Ingestion helper for the /backlog-mail skill (Backlog Mail proposals). Uses the PM data layer (never legacy tables).
//   node scripts/mail-ingest.mjs context            -> JSON: projects, active topics, known message ids (any status)
//   node scripts/mail-ingest.mjs insert <file.json> -> inserts candidates (dedupes by messageId) and prints { inserted, skipped }
// Env, ENDPOINT mode (use this once the database is closed to the public key): INGEST_URL (the mail-ingest Edge Function URL) + INGEST_TOKEN.
// Env, DIRECT mode (only while the database is still open): SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY); SUPABASE_URL optional.
// PRIVACY: candidates carry only subject, sender, a short summary (max 600 chars) and a link. Never bodies or attachments.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createPmApi } from '../src/lib/api/pm/index.js'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qmgmvtjnbarqonrfmpix.supabase.co'
const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const ENDPOINT = process.env.INGEST_URL && process.env.INGEST_TOKEN
if (!ENDPOINT && !key) { console.error('Falta INGEST_URL + INGEST_TOKEN (modo endpoint) o SUPABASE_ANON_KEY (modo directo).'); process.exit(2) }
const api = ENDPOINT ? null : createPmApi(createClient(url, key), { listCampanas: async () => [], listPlanAccion: async () => [] })
const call = async body => {
  const r = await fetch(process.env.INGEST_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': process.env.INGEST_TOKEN }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { console.error('Endpoint de ingesta: ' + r.status + ' ' + (j.error || '')); process.exit(3) }
  return j
}

// Privacy: customer identifiers must never reach the table (phone numbers, NIF/NIE, ICCID/IMSI, long digit runs, e-mails of customers are not stored in summaries).
export const scrub = s => String(s ?? '')
  .replace(/\b[XYZxyz]?\d{7,8}[A-Za-z]\b/g, '[id]')      // NIF / NIE
  .replace(/\b\d{9,}\b/g, '[nº]')                         // MSISDN, ICCID, IMSI...
  .replace(/\b\d{3}[ .-]\d{3}[ .-]\d{3}\b/g, '[nº]')     // phone with separators
// Same conversation = same subject once reply/forward prefixes are removed.
export const normSubject = s => String(s ?? '').toLowerCase().replace(/^(\s*(re|rv|fw|fwd|enc|res)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim()

const [mode, file] = process.argv.slice(2)
if (mode === 'context' && ENDPOINT) {
  console.log(JSON.stringify(await call({ action: 'context' })))
} else if (mode === 'insert' && file && ENDPOINT) {
  console.log(JSON.stringify(await call({ action: 'insert', candidates: JSON.parse(readFileSync(file, 'utf8')) })))
} else if (mode === 'context') {
  const { items, proyectos } = await api.loadAll()
  const mail = await api.listMailCandidates()
  console.log(JSON.stringify({
    projects: proyectos.map(p => p.nombre),
    activeTopics: items.filter(i => i.status !== 'done').map(i => ({ title: i.tema, project: i.proyecto || '', status: i.status })),
    knownMessageIds: mail.map(c => c.messageId),
    knownThreads: mail.map(c => ({ threadId: c.threadId || '', subject: normSubject(c.subject), title: c.suggestedTitle, status: c.status })),
    pendingCount: mail.filter(c => c.status === 'pending').length,
  }))
} else if (mode === 'insert' && file) {
  const known = await api.listMailCandidates()
  const seenThreads = new Set(known.map(c => c.threadId).filter(Boolean))
  const seenSubjects = new Set(known.map(c => normSubject(c.subject)))
  const fresh = [], skipped = []
  for (const c of JSON.parse(readFileSync(file, 'utf8'))) {
    const cand = { ...c, subject: scrub(c.subject), summary: scrub(c.summary), suggestedTitle: scrub(c.suggestedTitle) }
    const subj = normSubject(cand.subject)
    if ((cand.threadId && seenThreads.has(cand.threadId)) || (subj && seenSubjects.has(subj))) { skipped.push({ messageId: c.messageId, reason: 'same thread already proposed' }); continue }
    if (cand.threadId) seenThreads.add(cand.threadId)
    if (subj) seenSubjects.add(subj)
    fresh.push(cand)
  }
  const r = await api.insertMailCandidates(fresh)
  console.log(JSON.stringify({ inserted: r.inserted, skipped: [...skipped, ...r.skipped] }))
} else {
  console.error('Uso: mail-ingest.mjs context | insert <file.json>'); process.exit(1)
}
