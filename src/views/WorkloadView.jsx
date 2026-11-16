// Workload: planned hours per person and week vs weekly capacity. Calculations live in src/lib/workload.js.
// `ui` injects the app's shared styles/helpers (avoids a circular import with App.jsx).
// Sub-components are defined at module level so typing in inputs keeps focus across re-renders.
import { useState, useEffect, useMemo } from 'react'
import { workloadRows, workloadSummary } from '../lib/workload.js'
import { dayKey } from '../lib/mywork.js'

const LEVEL_COLOR = { none: '#94a3b8', ok: '#10b981', high: '#d97706', over: '#e11d48' }
const LEVEL_BG = { none: 'transparent', ok: '#10b98114', high: '#d9770618', over: '#e11d4820' }
const fmtH = h => (Number.isInteger(h) ? String(h) : h.toFixed(1))
const weekLabel = (start, i) => {
  const [, m, d] = start.split('-')
  return (i === 0 ? 'Esta sem. ' : '') + `${d}/${m}`
}

function Tile({ label, value, tone, S }) {
  const { C } = S.ui
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', minWidth: 130 }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: tone || C.text }}>{value}</div></div>
}

function CapacityInput({ row, S }) {
  const [v, setV] = useState(row.capacityH === null ? '' : String(row.capacityH))
  const [err, setErr] = useState('')
  useEffect(() => { setV(row.capacityH === null ? '' : String(row.capacityH)) }, [row.capacityH])
  const save = async () => {
    const cur = row.capacityH === null ? '' : String(row.capacityH)
    if (v.trim() === cur) return
    setErr('')
    try { await S.saveCapacity(row.person.id, v.trim() === '' ? null : v.trim().replace(',', '.')) }
    catch (e) { setErr(e.message || String(e)); setV(cur) }
  }
  const { C } = S.ui
  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.muted }}>
      <input value={v} onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="—" inputMode="decimal" title="Horas disponibles por semana"
        style={{ width: 44, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 5px', fontSize: 12, textAlign: 'right' }} /> h/sem
    </div>
    {err && <div style={{ fontSize: 10, color: '#dc2626', maxWidth: 160 }}>{err}</div>}
  </div>
}

function Cell({ bucket, capacity, level, selected, onClick, S, muted }) {
  const { C } = S.ui
  const h = bucket.hours, n = bucket.items.length
  const pct = capacity > 0 ? Math.min(100, Math.round((h / capacity) * 100)) : 0
  return <td onClick={onClick} style={{ padding: 4, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', cursor: n ? 'pointer' : 'default' }}>
    <div style={{ background: selected ? '#6366f122' : LEVEL_BG[level], border: `1px solid ${selected ? '#6366f1' : 'transparent'}`, borderRadius: 6, padding: '5px 7px', minHeight: 44, opacity: muted && !n ? 0.5 : 1 }}>
      {n ? <>
        <div style={{ fontSize: 12, fontWeight: 700, color: LEVEL_COLOR[level] === '#94a3b8' ? C.text : LEVEL_COLOR[level] }}>{fmtH(h)}h{capacity > 0 ? <span style={{ fontWeight: 400, color: C.muted }}> / {fmtH(capacity)}</span> : null}</div>
        {capacity > 0 && <div style={{ height: 4, background: C.border, borderRadius: 2, marginTop: 3 }}><div style={{ width: pct + '%', height: '100%', background: LEVEL_COLOR[level], borderRadius: 2 }} /></div>}
        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{n} tema{n === 1 ? '' : 's'}</div>
      </> : <div style={{ fontSize: 11, color: C.muted }}>—</div>}
    </div></td>
}

function EstimateInput({ item, S }) {
  const [v, setV] = useState(item.estimateH ? String(item.estimateH) : '')
  useEffect(() => { setV(item.estimateH ? String(item.estimateH) : '') }, [item.estimateH])
  const { C } = S.ui
  const commit = () => {
    const t = v.trim().replace(',', '.')
    const cur = item.estimateH ? String(item.estimateH) : ''
    if (t === cur) return
    if (t !== '' && (!Number.isFinite(Number(t)) || Number(t) < 0)) { setV(cur); return }
    S.onItemChange(item.id, { estimateH: t === '' ? null : Number(t) })
  }
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: C.muted }} onClick={e => e.stopPropagation()}>
    <input value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      placeholder="?" inputMode="decimal" title="Esfuerzo estimado (horas)"
      style={{ width: 40, background: C.card, color: C.text, border: `1px solid ${item.estimateH ? C.border : '#d97706'}`, borderRadius: 4, padding: '2px 4px', fontSize: 12, textAlign: 'right' }} />h</span>
}

function Detail({ title, items, S, onClose }) {
  const { C, Tag, fmtFecha } = S.ui
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginTop: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
      <b style={{ fontSize: 13, flex: 1 }}>{title}</b>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14 }}>✕</button></div>
    {items.length === 0 ? <div style={{ padding: 12, fontSize: 12, color: C.muted }}>Sin temas.</div> : items.map(it =>
      <div key={it.id} onClick={() => S.onOpenItem(it)} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{it.tema}</span>
        {it.proyecto && <span style={{ color: C.muted, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.proyecto}</span>}
        <Tag id={it.status} type="st" />
        <span style={{ width: 52, textAlign: 'right', color: C.muted }}>{it.fechaFin ? fmtFecha(dayKey(it.fechaFin)) : '—'}</span>
        <EstimateInput item={it} S={S} /></div>)}
  </div>
}

export default function WorkloadView({ items, supported, owners = [], onOpenItem, onItemChange, ui, api }) {
  const [people, setPeople] = useState(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState(null)        // { personId, key: 'w0'.. | 'nodate' | 'later' | 'noest' }
  useEffect(() => {
    if (!supported) return
    let live = true
    api.listPeople().then(p => { if (live) setPeople(p) }).catch(e => { if (live) { setPeople([]); setError(e.message || String(e)) } })
    return () => { live = false }
  }, [supported])
  const today = dayKey(new Date())
  const shown = useMemo(() => (people || []).filter(p => owners.length === 0 || owners.some(o => o.trim().toLowerCase() === p.name.trim().toLowerCase())), [people, owners])
  const { weeks, rows, unassigned } = useMemo(() => workloadRows(shown, items, today, 8), [shown, items, today])
  const sum = useMemo(() => workloadSummary(rows), [rows])
  const S = {
    ui, onOpenItem, onItemChange,
    saveCapacity: async (id, hours) => { const v = await api.updatePersonCapacity(id, hours); setPeople(prev => prev.map(p => (p.id === id ? { ...p, capacityH: v } : p))) },
  }
  const { C } = ui
  if (!supported) return <div style={{ padding: 20, color: C.muted }}>Workload necesita el backend PM (capacidad y esfuerzo se guardan en la base de datos nueva).</div>
  if (people === null) return <div style={{ padding: 20, color: C.muted }}>Cargando…</div>

  const detail = (() => {
    if (!sel) return null
    const row = rows.find(r => r.person.id === sel.personId); if (!row) return null
    const who = row.person.name.split(' ')[0]
    if (sel.key === 'nodate') return { title: `${who} · sin fecha`, items: row.noDate.items }
    if (sel.key === 'later') return { title: `${who} · más adelante`, items: row.later.items }
    if (sel.key === 'noest') return { title: `${who} · sin estimar (no cuentan horas)`, items: row.unestimated }
    const i = Number(sel.key.slice(1)); const w = row.weeks[i]
    return { title: `${who} · semana del ${w.start.split('-').reverse().slice(0, 2).join('/')} (${fmtH(w.hours)}h)`, items: w.items }
  })()
  const th = { padding: '6px 6px', fontSize: 10, textTransform: 'uppercase', color: C.muted, textAlign: 'left', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }

  return <div style={{ padding: '4px 2px' }}>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      <Tile label="Horas esta semana" value={`${fmtH(sum.hoursThisWeek)}${sum.capacityThisWeek ? ' / ' + fmtH(sum.capacityThisWeek) : ''}h`} S={S} />
      <Tile label="Personas sobrecargadas" value={sum.overloaded} tone={sum.overloaded ? '#e11d48' : undefined} S={S} />
      <Tile label="Temas sin estimar" value={sum.unestimated} tone={sum.unestimated ? '#d97706' : undefined} S={S} />
      <Tile label="Vencidos (cuentan esta semana)" value={sum.overdue} tone={sum.overdue ? '#e11d48' : undefined} S={S} />
    </div>
    {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{error}</div>}
    <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
      Cada tema activo cuenta en la semana de su fecha fin con su esfuerzo estimado (horas). Los vencidos cuentan en la semana actual; sin fecha o más allá de 8 semanas van aparte. Define la capacidad semanal de cada persona y estima los temas desde su detalle.
    </div>
    <div style={{ overflowX: 'auto', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
        <thead><tr>
          <th style={{ ...th, minWidth: 150 }}>Persona</th>
          {weeks.map((w, i) => <th key={w} style={th}>{weekLabel(w, i)}</th>)}
          <th style={th}>Más adelante</th><th style={th}>Sin fecha</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={weeks.length + 3} style={{ padding: 16, color: C.muted, fontSize: 12 }}>No hay personas para mostrar.</td></tr> : rows.map(row => (
          <tr key={row.person.id}>
            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{row.person.name}</div>
              <CapacityInput row={row} S={S} />
              {row.unestimated.length > 0 && <div onClick={() => setSel({ personId: row.person.id, key: 'noest' })} style={{ fontSize: 10, color: '#d97706', cursor: 'pointer', marginTop: 2 }}>{row.unestimated.length} sin estimar</div>}
            </td>
            {row.weeks.map((w, i) => <Cell key={w.start} bucket={w} capacity={row.capacityH} level={w.level} S={S}
              selected={sel?.personId === row.person.id && sel.key === 'w' + i} onClick={() => w.items.length && setSel({ personId: row.person.id, key: 'w' + i })} />)}
            <Cell bucket={row.later} capacity={0} level="none" S={S} muted selected={sel?.personId === row.person.id && sel.key === 'later'} onClick={() => row.later.items.length && setSel({ personId: row.person.id, key: 'later' })} />
            <Cell bucket={row.noDate} capacity={0} level="none" S={S} muted selected={sel?.personId === row.person.id && sel.key === 'nodate'} onClick={() => row.noDate.items.length && setSel({ personId: row.person.id, key: 'nodate' })} />
          </tr>))}</tbody>
      </table>
    </div>
    {unassigned.length > 0 && <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>{unassigned.length} tema(s) activo(s) sin responsable en esta lista (sin persona o de otra persona) no se cuentan aquí.</div>}
    {detail && <Detail title={detail.title} items={detail.items} S={S} onClose={() => setSel(null)} />}
  </div>
}
