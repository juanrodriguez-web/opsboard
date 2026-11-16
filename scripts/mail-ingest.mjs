#!/usr/bin/env node
// Ingestion helper for the /backlog-mail skill (Backlog Mail proposals). Uses the PM data layer (never legacy tables).
//   node scripts/mail-ingest.mjs context            -> JSON: projects, active topics, known message ids (any status)
//   node scripts/mail-ingest.mjs insert <file.json> -> inserts candidates (dedupes by messageId) and prints { inserted, skipped }
// Env: SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY); SUPABASE_URL optional (defaults to the OpsBoard project).
// PRIVACY: candidates carry only subject, sender, a short summary (max 600 chars) and a link. Never bodies or attachments.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createPmApi } from '../src/lib/api/pm/index.js'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qmgmvtjnbarqonrfmpix.supabase.co'
const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!key) { console.error('Falta SUPABASE_ANON_KEY (clave pública anon del proyecto).'); process.exit(2) }
const api = createPmApi(createClient(url, key), { listCampanas: async () => [], listPlanAccion: async () => [] })

const [mode, file] = process.argv.slice(2)
if (mode === 'context') {
  const { items, proyectos } = await api.loadAll()
  const mail = await api.listMailCandidates()
  console.log(JSON.stringify({
    projects: proyectos.map(p => p.nombre),
    activeTopics: items.filter(i => i.status !== 'done').map(i => ({ title: i.tema, project: i.proyecto || '', status: i.status })),
    knownMessageIds: mail.map(c => c.messageId),
    pendingCount: mail.filter(c => c.status === 'pending').length,
  }))
} else if (mode === 'insert' && file) {
  console.log(JSON.stringify(await api.insertMailCandidates(JSON.parse(readFileSync(file, 'utf8')))))
} else {
  console.error('Uso: mail-ingest.mjs context | insert <file.json>'); process.exit(1)
}
