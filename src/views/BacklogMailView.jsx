// Backlog Mail: tasks/projects proposed from e-mails. The user decides on each one: Create (-> pending topic / project) or Ignore.
// Candidates are written by the /backlog-mail skill into mail_candidates; this view only reviews them. Logic in src/lib/mail.js.
// `ui` injects shared styles (avoids a circular import with App.jsx). Components are module-level so inputs keep focus.
import { useState, useEffect, useMemo } from 'react'
import { sortCandidates, candidateToItem, candidateToProject } from '../lib/mail.js'

const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '' } }
const TABS = [['pending', 'Pendientes'], ['created', 'Creadas'], ['ignored', 'Ignoradas']]

function Card({ c, S, busy }) {
  const { C } = S.ui
  const [ed, setEd] = useState({ suggestedTitle: c.suggestedTitle, kind: c.kind, suggestedProject: c.suggestedProject, suggestedPriority: c.suggestedPriority, dueDate: c.dueDate || '' })
  const set = (k, v) => setEd(p => ({ ...p, [k]: v }))
  const inp = { background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, outline: 'none' }
  const pending = c.status === 'pending'
  const knownProject = !ed.suggestedProject || S.projectNames.includes(ed.suggestedProject)
  return <div style={{ background: C.card, border: `1px solid ${c.prioritySender && pending ? '#f59e0b88' : C.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10, opacity: busy ? 0.6 : 1 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.muted, marginBottom: 6, flexWrap: 'wrap' }}>
      {c.prioritySender && <span title="Remitente prioritario" style={{ color: '#d97706', fontWeight: 700 }}>★ Prioritario</span>}
      <span>De <b style={{ color: C.text }}>{c.senderName || c.senderEmail || 'desconocido'}</b></span>
      {c.receivedAt && <span>· {fmtDate(c.receivedAt)}</span>}
      {c.subject && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {c.subject}</span>}
      {c.webLink && <a href={c.webLink} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontWeight: 600 }}>Abrir correo ↗</a>}
    </div>
    {pending ? <input value={ed.suggestedTitle} onChange={e => set('suggestedTitle', e.target.value)} style={{ ...inp, width: '100%', boxSizing: 'border-box', fontSize: 14, fontWeight: 700, marginBottom: 6 }} />
             : <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{c.suggestedTitle}</div>}
    {c.summary && <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{c.summary}</div>}
    {c.duplicateOf && <div style={{ fontSize: 11, color: '#b45309', background: '#fef3c7', borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>⚠ Posible duplicado de «{c.duplicateOf}»</div>}
    {pending ? <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <select value={ed.kind} onChange={e => set('kind', e.target.value)} style={inp}><option value="topic">Tema</option><option value="project">Proyecto</option></select>
        {ed.kind === 'topic' && <select value={ed.suggestedProject} onChange={e => set('suggestedProject', e.target.value)} style={{ ...inp, maxWidth: 220 }}>
          <option value="">Sin proyecto</option>
          {!knownProject && <option value={ed.suggestedProject}>{ed.suggestedProject} (no existe)</option>}
          {S.projectNames.map(n => <option key={n} value={n}>{n}</option>)}</select>}
        <select value={ed.suggestedPriority} onChange={e => set('suggestedPriority', e.target.value)} style={inp}>
          <option value="">Sin prioridad</option>{['P0', 'P1', 'P2', 'P3'].map(p => <option key={p} value={p}>{p}</option>)}</select>
        {ed.kind === 'topic' && <input type="date" value={ed.dueDate} onChange={e => set('dueDate', e.target.value)} style={{ ...inp, colorScheme: 'light' }} title="Fecha límite" />}
      </div>
      {!knownProject && ed.kind === 'topic' && <div style={{ fontSize: 11, color: '#b45309', marginBottom: 8 }}>El proyecto sugerido no existe en OpsBoard; elige uno o créalo sin proyecto.</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={busy || !ed.suggestedTitle.trim()} onClick={() => S.create(c, { ...ed, dueDate: ed.dueDate || null })}
          style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#10b981', color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>Crear</button>
        <button disabled={busy} onClick={() => S.ignore(c)}
          style={{ padding: '7px 18px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontWeight: 600, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>Ignorar</button>
      </div></>
      : c.status === 'ignored'
        ? <button disabled={busy} onClick={() => S.restore(c)} style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 12, cursor: 'pointer' }}>Volver a pendientes</button>
        : <div style={{ fontSize: 11, color: '#059669' }}>✓ Creada como {c.kind === 'project' ? 'proyecto' : 'tema pendiente'} · {fmtDate(c.decidedAt)}</div>}
  </div>
}

export default function BacklogMailView({ supported, projectNames, onCreateTopic, onCreateProject, onCount, ui, api, newId }) {
  const [list, setList] = useState(null)
  const [tab, setTab] = useState('pending')
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState(null)        // { kind: 'ok' | 'err', text }
  const { C } = ui
  const load = () => api.listMailCandidates().then(l => { setList(l); onCount?.(l.filter(x => x.status === 'pending').length) })
    .catch(e => { setList([]); setMsg({ kind: 'err', text: 'No se pudieron cargar las propuestas: ' + (e.message || e) }) })
  useEffect(() => { if (supported) load() }, [supported])
  const counts = useMemo(() => Object.fromEntries(TABS.map(([k]) => [k, (list || []).filter(c => c.status === k).length])), [list])
  const shown = useMemo(() => {
    const l = (list || []).filter(c => c.status === tab)
    return tab === 'pending' ? sortCandidates(l) : l.sort((a, b) => String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')))
  }, [list, tab])
  const patch = c => setList(prev => { const next = prev.map(x => (x.id === c.id ? c : x)); onCount?.(next.filter(x => x.status === 'pending').length); return next })

  const S = {
    ui, projectNames,
    // Create: first claim the candidate (so a double click / second tab cannot create it twice), then create; undo the claim if creating fails.
    create: async (c, edits) => {
      if (busyId) return
      setBusyId(c.id); setMsg(null)
      const id = newId()
      try {
        const claimed = await api.decideMailCandidate(c.id, { to: 'created', createdRef: id })
        try {
          if (edits.kind === 'project') await onCreateProject(candidateToProject(c, edits, id))
          else await onCreateTopic(candidateToItem(c, edits, id))
        } catch (e) {
          await api.decideMailCandidate(c.id, { from: 'created', to: 'pending' }).catch(() => {})
          throw e
        }
        patch({ ...claimed, kind: edits.kind, suggestedTitle: edits.suggestedTitle.trim() })
        setMsg({ kind: 'ok', text: edits.kind === 'project' ? 'Proyecto creado (pendiente de asignar responsable).' : 'Tema creado en el Tablero como Pendiente; asigna responsable cuando quieras.' })
      } catch (e) { setMsg({ kind: 'err', text: 'No se pudo crear: ' + (e.message || e) }); load() }
      setBusyId(null)
    },
    ignore: async c => {
      if (busyId) return
      setBusyId(c.id); setMsg(null)
      try { patch(await api.decideMailCandidate(c.id, { to: 'ignored' })) } catch (e) { setMsg({ kind: 'err', text: e.message || String(e) }); load() }
      setBusyId(null)
    },
    restore: async c => {
      if (busyId) return
      setBusyId(c.id); setMsg(null)
      try { patch(await api.decideMailCandidate(c.id, { from: 'ignored', to: 'pending' })) } catch (e) { setMsg({ kind: 'err', text: e.message || String(e) }); load() }
      setBusyId(null)
    },
  }
  if (!supported) return <div style={{ padding: 20, color: C.muted }}>Backlog Mail necesita el backend PM.</div>
  if (list === null) return <div style={{ padding: 20, color: C.muted }}>Cargando…</div>
  return <div style={{ padding: '4px 2px', maxWidth: 860 }}>
    <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
      Propuestas generadas a partir de tu correo de Sercom. <b>Crear</b> añade un tema Pendiente al Tablero (sin responsable) o un proyecto; <b>Ignorar</b> lo descarta y no se vuelve a proponer.
      Para generar propuestas nuevas, pídele a Claude «<code>/backlog-mail</code>».
    </div>
    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
      {TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)}
        style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${tab === k ? C.accent : C.border}`, background: tab === k ? '#fef2f2' : 'transparent', color: tab === k ? C.accent : C.muted, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
        {label} ({counts[k]})</button>)}
    </div>
    {msg && <div style={{ fontSize: 12, marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: msg.kind === 'ok' ? '#ecfdf5' : '#fef2f2', color: msg.kind === 'ok' ? '#047857' : '#b91c1c' }}>{msg.text}</div>}
    {shown.length === 0 ? <div style={{ padding: 20, color: C.muted, fontSize: 13 }}>{tab === 'pending' ? 'No hay propuestas pendientes.' : 'Nada por aquí.'}</div>
      : shown.map(c => <Card key={c.id} c={c} S={S} busy={busyId === c.id} />)}
  </div>
}
