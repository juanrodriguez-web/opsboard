// Portfolio (one row per project) and Project Overview (drill-down). Calculations live in src/lib/portfolio.js.
// `ui` injects the app's shared styles/helpers (avoids a circular import with App.jsx).
// All sub-components are defined at module level (not inside the render) so typing / selects keep their state across re-renders.
import { useState, useEffect, useMemo } from 'react'
import {
  HEALTH, HEALTH_LABEL, HEALTH_COLOR, STATE, STATE_LABEL,
  portfolioRows, portfolioSummary, filterRows, sortRows, overview,
} from '../lib/portfolio.js'
import { dayKey } from '../lib/mywork.js'

const fmtDT = iso => { try { return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

function HealthSelect({ p, S }) {
  return <select value={p.health || 'not_set'} onChange={e => S.change(p.id, { health: e.target.value })}
    style={{ ...S.sel, fontWeight: 700, color: '#fff', background: HEALTH_COLOR[p.health || 'not_set'], border: 'none' }}>
    {HEALTH.map(h => <option key={h} value={h} style={{ color: S.C.text, background: '#fff' }}>{HEALTH_LABEL[h]}</option>)}</select>
}
function StateSelect({ p, S }) {
  return <select value={p.status || 'pending'} onChange={e => S.change(p.id, { status: e.target.value })} style={S.sel}>
    {STATE.map(s => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}</select>
}
function OwnerSelect({ p, S }) {
  return <select value={p.propietario || ''} onChange={e => S.change(p.id, { propietario: e.target.value })} style={S.sel}>
    <option value="">—</option>{[...new Set([...S.owners, p.propietario].filter(Boolean))].map(o => <option key={o} value={o}>{o}</option>)}</select>
}
function Bar({ v, S }) {
  if (v === null) return <span style={{ color: S.C.muted }}>—</span>
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <div style={{ flex: 1, height: 6, background: S.C.border, borderRadius: 3, minWidth: 50 }}><div style={{ width: v + '%', height: '100%', background: '#10b981', borderRadius: 3 }} /></div>
    <span style={{ fontSize: 11, width: 32, textAlign: 'right' }}>{v}%</span></div>
}
function ItemRow({ it, extra, S }) {
  const { C, Tag, fmtFecha } = S.ui
  return <div onClick={() => S.onOpenItem(it)} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12 }}>
    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{it.tema}</span>
    <Tag id={it.status} type="st" /><span style={{ width: 80, textAlign: 'right', color: C.muted }}>{extra ?? (it.fechaFin ? fmtFecha(dayKey(it.fechaFin)) : '—')}</span></div>
}
function Box({ title, count, S, children }) {
  const { C } = S.ui
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
    <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: `1px solid ${C.border}`, background: C.surface }}>
      {title}{count !== undefined && <span style={{ color: C.muted, fontWeight: 400 }}> · {count}</span>}</div>{children}</div>
}
const Empty = ({ S, children }) => <div style={{ padding: 12, fontSize: 12, color: S.C.muted }}>{children}</div>

function Overview({ p, items, today, S, api, onBack }) {
  const { C, fmtFecha } = S.ui
  const o = useMemo(() => overview(p, items, today), [p, items, today])
  const [update, setUpdate] = useState('')
  const [objectives, setObjectives] = useState(p.objectives || '')
  const [hitos, setHitos] = useState(null)
  useEffect(() => { setObjectives(p.objectives || '') }, [p.id])
  useEffect(() => { api.listHitos(p.id).then(h => setHitos(h.filter(x => !x.completado).slice(0, 5))).catch(() => setHitos([])) }, [p.id])
  const k = [['Temas', o.stats.total, C.text], ['Completados', o.stats.done, '#10b981'], ['Abiertos', o.stats.active, '#2563eb'], ['Bloqueos', o.stats.blockers, '#e11d48'], ['Vencidos', o.stats.overdue, '#d97706']]
  const ta = { width: '100%', boxSizing: 'border-box', padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 22px', background: C.bg }}>
      <button style={S.btn} onClick={onBack}>← Portfolio</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 6px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20, flex: 1, minWidth: 200 }}>{p.nombre}</h2>
        <HealthSelect p={p} S={S} /><StateSelect p={p} S={S} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: C.muted, marginBottom: 14, alignItems: 'center' }}>
        <span>Responsable <OwnerSelect p={p} S={S} /></span>
        <span>Inicio <input type="date" value={p.fecha_inicio || ''} onChange={e => S.change(p.id, { fecha_inicio: e.target.value || null })} style={S.sel} /></span>
        <span>Objetivo <input type="date" value={p.fecha_fin || ''} onChange={e => S.change(p.id, { fecha_fin: e.target.value || null })} style={S.sel} /></span>
        {p.fase && <span>Fase: {p.fase}</span>}
      </div>
      {S.msg && <div style={{ color: '#b45309', fontSize: 12, marginBottom: 8 }}>{S.msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 12 }}>
        {k.map(([l, v, c]) => <div key={l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div><div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase' }}>{l}</div></div>)}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Progreso</div><Bar v={o.stats.progress} S={S} /></div>
      </div>
      <Box title="Última actualización" S={S}>
        <div style={{ padding: 12 }}>
          {p.latestUpdate ? <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{p.latestUpdate}<div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{p.latestUpdateAt ? fmtDT(p.latestUpdateAt) : ''}</div></div>
            : <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Aún no hay ninguna actualización.</div>}
          <textarea value={update} onChange={e => setUpdate(e.target.value)} rows={3} placeholder="Escribe una nueva actualización de estado…" style={ta} />
          <button style={{ ...S.btn, marginTop: 6 }} disabled={!update.trim()} onClick={async () => { await S.change(p.id, { latestUpdate: update.trim() }); setUpdate('') }}>Publicar actualización</button>
        </div>
      </Box>
      <Box title="Objetivos" S={S}>
        <div style={{ padding: 12 }}>
          <textarea value={objectives} onChange={e => setObjectives(e.target.value)} rows={3} placeholder="Objetivos del proyecto…" style={ta} />
          <button style={{ ...S.btn, marginTop: 6 }} disabled={objectives === (p.objectives || '')} onClick={() => S.change(p.id, { objectives })}>Guardar objetivos</button>
        </div>
      </Box>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <div>
          <Box title="Hitos próximos" count={hitos ? hitos.length : '…'} S={S}>
            {hitos && hitos.length === 0 && <Empty S={S}>Sin hitos pendientes.</Empty>}
            {(hitos || []).map(h => <div key={h.id} style={{ display: 'flex', padding: '7px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}><span style={{ flex: 1 }}>◆ {h.nombre}</span><span style={{ color: C.muted }}>{h.fecha_prevista ? fmtFecha(String(h.fecha_prevista).slice(0, 10)) : '—'}</span></div>)}</Box>
          <Box title="Bloqueos" count={o.blockers.length} S={S}>{o.blockers.length === 0 ? <Empty S={S}>Nada bloqueado.</Empty> : o.blockers.map(it => <ItemRow key={it.id} it={it} S={S} />)}</Box>
          <Box title="Vencidos" count={o.overdue.length} S={S}>{o.overdue.length === 0 ? <Empty S={S}>Nada vencido.</Empty> : o.overdue.map(it => <ItemRow key={it.id} it={it} S={S} />)}</Box>
        </div>
        <div>
          <Box title="Próximos vencimientos" count={o.upcoming.length} S={S}>{o.upcoming.length === 0 ? <Empty S={S}>Sin fechas próximas.</Empty> : o.upcoming.map(it => <ItemRow key={it.id} it={it} S={S} />)}</Box>
          <Box title="Equipo" count={o.team.length} S={S}><div style={{ padding: 12, fontSize: 12 }}>{o.team.length ? o.team.join(' · ') : <span style={{ color: C.muted }}>Sin responsables asignados.</span>}</div></Box>
          <Box title="Cambios recientes" count={o.recent.length} S={S}>{o.recent.length === 0 ? <Empty S={S}>Sin temas vinculados.</Empty> : o.recent.map(it => <ItemRow key={it.id} it={it} extra={fmtDT(it.updated_at)} S={S} />)}</Box>
        </div>
      </div>
    </div>)
}

export default function PortfolioView({ projects, items, supported, owners = [], onProjectChange, onOpenItem, ui, api }) {
  const { C, fmtFecha } = ui
  const [openId, setOpenId] = useState(null)
  const [filters, setFilters] = useState({ state: 'open', owner: '', health: '' })
  const [sort, setSort] = useState({ key: 'health', dir: 'asc' })
  const [msg, setMsg] = useState('')
  const today = useMemo(() => dayKey(new Date()), [])
  const rows = useMemo(() => portfolioRows(projects, items, today), [projects, items, today])
  const shown = useMemo(() => sortRows(filterRows(rows, filters), sort.key, sort.dir), [rows, filters, sort])
  const summary = useMemo(() => portfolioSummary(rows), [rows])

  const change = async (id, fields) => {
    try { await onProjectChange(id, fields); setMsg('') } catch (e) { setMsg('No se pudo guardar: ' + (e.message || e)) }
  }
  const S = {
    ui, C, owners, change, msg, onOpenItem,
    sel: { padding: '4px 6px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, background: C.card, color: C.text, maxWidth: 160 },
    btn: { padding: '5px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, background: C.card, color: C.text, cursor: 'pointer' },
  }

  if (!supported) return <div style={{ padding: 40, color: C.muted }}>El Portfolio necesita el modelo de datos nuevo (VITE_DATA_BACKEND=pm).</div>
  const open = openId ? projects.find(x => x.id === openId) : null
  if (open) return <Overview p={open} items={items} today={today} S={S} api={api} onBack={() => setOpenId(null)} />

  const th = (key, label, w) => (
    <th onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}
      style={{ width: w, padding: '8px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted, cursor: 'pointer', background: C.surface, borderBottom: `1px solid ${C.border}`, userSelect: 'none' }}>
      {label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)
  const td = { padding: '8px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: 'middle' }
  const tiles = [['Proyectos abiertos', summary.open, C.text], ['En riesgo', summary.atRisk, '#d97706'], ['Fuera de plan', summary.offTrack, '#e11d48'], ['Sin definir', summary.notSet, '#94a3b8'], ['Bloqueos', summary.blockers, '#e11d48'], ['Vencidos', summary.overdue, '#d97706']]
  const ownersInData = [...new Set(projects.map(p => p.propietario).filter(Boolean))]
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 22px', background: C.bg }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 14 }}>
        {tiles.map(([l, v, c]) => <div key={l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div><div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase' }}>{l}</div></div>)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={filters.state} onChange={e => setFilters(f => ({ ...f, state: e.target.value }))} style={S.sel}>
          <option value="open">Abiertos</option><option value="all">Todos</option><option value="done">Completados</option><option value="backlog">Backlog</option></select>
        <select value={filters.owner} onChange={e => setFilters(f => ({ ...f, owner: e.target.value }))} style={S.sel}><option value="">Todos los responsables</option>{ownersInData.map(o => <option key={o} value={o}>{o}</option>)}</select>
        <select value={filters.health} onChange={e => setFilters(f => ({ ...f, health: e.target.value }))} style={S.sel}><option value="">Toda la salud</option>{HEALTH.map(h => <option key={h} value={h}>{HEALTH_LABEL[h]}</option>)}</select>
        <span style={{ fontSize: 12, color: C.muted }}>{shown.length} proyectos</span>
      </div>
      {msg && <div style={{ color: '#b45309', fontSize: 12, marginBottom: 8 }}>{msg}</div>}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflowX: 'auto', background: C.card }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
          <thead><tr>{th('nombre', 'Proyecto', 250)}{th('owner', 'Responsable', 150)}{th('state', 'Estado', 120)}{th('health', 'Salud', 120)}{th('progress', 'Progreso', 130)}{th('target', 'Objetivo', 120)}{th('open', 'Abiertos', 70)}{th('blockers', 'Bloqueos', 70)}{th('overdue', 'Vencidos', 70)}</tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: C.muted, padding: 30 }}>Ningún proyecto cumple los filtros.</td></tr>}
            {shown.map(({ project: p, stats: s, target, daysLeft }) => (
              <tr key={p.id}>
                <td style={td}><a onClick={() => setOpenId(p.id)} style={{ cursor: 'pointer', fontWeight: 600, color: C.text }}>{p.nombre}</a></td>
                <td style={td}><OwnerSelect p={p} S={S} /></td><td style={td}><StateSelect p={p} S={S} /></td><td style={td}><HealthSelect p={p} S={S} /></td>
                <td style={td}><Bar v={s.progress} S={S} /></td>
                <td style={{ ...td, color: daysLeft !== null && daysLeft < 0 && p.status !== 'done' ? '#e11d48' : C.text }}>{target ? <>{fmtFecha(target)} <span style={{ fontSize: 10, color: C.muted }}>{daysLeft === 0 ? 'hoy' : daysLeft < 0 ? `hace ${-daysLeft} d` : `en ${daysLeft} d`}</span></> : '—'}</td>
                <td style={td}>{s.active}</td>
                <td style={{ ...td, color: s.blockers ? '#e11d48' : C.muted, fontWeight: s.blockers ? 700 : 400 }}>{s.blockers}</td>
                <td style={{ ...td, color: s.overdue ? '#d97706' : C.muted, fontWeight: s.overdue ? 700 : 400 }}>{s.overdue}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>)
}
