// Edge Function "mail-ingest": the ONLY door for the unattended /backlog-mail skill once the database is closed to the public key.
// Auth: header x-ingest-token must equal the INGEST_TOKEN secret (deploy with verify_jwt = false). Uses the service role internally,
// but only ever reads the few things the skill needs and only ever inserts into mail_candidates. Never bodies: summary is capped.
import { createClient } from 'npm:@supabase/supabase-js@2'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const TOKEN = Deno.env.get('INGEST_TOKEN') ?? ''

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const same = (a: string, b: string) => { if (a.length !== b.length || !a) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }
const scrub = (s: unknown) => String(s ?? '').replace(/\b[XYZxyz]?\d{7,8}[A-Za-z]\b/g, '[id]').replace(/\b\d{9,}\b/g, '[nº]').replace(/\b\d{3}[ .-]\d{3}[ .-]\d{3}\b/g, '[nº]')
const normSubject = (s: unknown) => String(s ?? '').toLowerCase().replace(/^(\s*(re|rv|fw|fwd|enc|res)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim()
const cleanEmail = (s: unknown) => { const m = String(s ?? '').trim().toLowerCase().match(/[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+/); return m ? m[0] : '' }

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  if (!same(req.headers.get('x-ingest-token') ?? '', TOKEN)) return json({ error: 'unauthorized' }, 401)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  if (body.action === 'context') {
    const [projects, topics, mail] = await Promise.all([
      db.from('projects').select('name'),
      db.from('work_items').select('title, project:projects(name), status:statuses(category)').eq('type', 'topic').is('parent_id', null),
      db.from('mail_candidates').select('message_id, thread_id, subject, suggested_title, status'),
    ])
    if (projects.error || topics.error || mail.error) return json({ error: 'read failed' }, 500)
    const active = (topics.data ?? []).filter((t: any) => ['NOT_STARTED', 'ACTIVE'].includes(t.status?.category))
    return json({
      projects: (projects.data ?? []).map((p: any) => p.name),
      activeTopics: active.map((t: any) => ({ title: t.title, project: t.project?.name ?? '' })),
      knownMessageIds: (mail.data ?? []).map((c: any) => c.message_id),
      knownThreads: (mail.data ?? []).map((c: any) => ({ threadId: c.thread_id ?? '', subject: normSubject(c.subject), title: c.suggested_title, status: c.status })),
      pendingCount: (mail.data ?? []).filter((c: any) => c.status === 'pending').length,
    })
  }

  if (body.action === 'insert' && Array.isArray(body.candidates)) {
    const { data: known, error } = await db.from('mail_candidates').select('message_id, thread_id, subject')
    if (error) return json({ error: 'read failed' }, 500)
    const ids = new Set((known ?? []).map((k: any) => k.message_id))
    const threads = new Set((known ?? []).map((k: any) => k.thread_id).filter(Boolean))
    const subjects = new Set((known ?? []).map((k: any) => normSubject(k.subject)))
    const rows: any[] = [], skipped: { messageId: string; reason: string }[] = []
    for (const c of body.candidates.slice(0, 100)) {
      const messageId = String(c?.messageId ?? '').trim(), title = scrub(c?.suggestedTitle).trim()
      if (!messageId) { skipped.push({ messageId, reason: 'missing messageId' }); continue }
      if (!title) { skipped.push({ messageId, reason: 'missing suggestedTitle' }); continue }
      const subject = scrub(c.subject).slice(0, 300), subj = normSubject(subject)
      if (ids.has(messageId)) { skipped.push({ messageId, reason: 'already known' }); continue }
      if ((c.threadId && threads.has(c.threadId)) || (subj && subjects.has(subj))) { skipped.push({ messageId, reason: 'same thread already proposed' }); continue }
      ids.add(messageId); if (c.threadId) threads.add(c.threadId); if (subj) subjects.add(subj)
      rows.push({
        message_id: messageId, thread_id: c.threadId || null, subject, sender_name: String(c.senderName ?? '').slice(0, 120), sender_email: cleanEmail(c.senderEmail),
        received_at: c.receivedAt || null, summary: scrub(c.summary).slice(0, 600), suggested_title: title.slice(0, 200),
        kind: c.kind === 'project' ? 'project' : 'topic', suggested_project: String(c.suggestedProject ?? '').trim(),
        suggested_priority: ['P0', 'P1', 'P2', 'P3'].includes(c.suggestedPriority) ? c.suggestedPriority : '',
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(c.dueDate || '') ? c.dueDate : null, priority_sender: !!c.prioritySender,
        duplicate_of: String(c.duplicateOf ?? '').trim(), web_link: String(c.webLink ?? '').slice(0, 1000),
      })
    }
    if (rows.length) { const ins = await db.from('mail_candidates').insert(rows); if (ins.error) return json({ error: 'insert failed' }, 500) }
    return json({ inserted: rows.length, skipped })
  }
  return json({ error: 'unknown action' }, 400)
})
