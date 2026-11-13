// "Lista" view: filters, sorting, grouping, column picker, inline editing and saved views over the same work items.
// The view only holds configuration; items are never copied. `ui` injects the app's shared styles/helpers (avoids a circular import).
import { useState, useEffect, useMemo } from 'react'
import {
  FIELDS, OPERATORS, NO_VALUE_OPS, PRESETS, GROUPABLE, GROUP_LABEL, ALL_COLUMNS, DEFAULT_COLUMNS,
  runView, normalizeConfig, STATUS_ORDER, STATUS_LABEL, PRIO_ORDER,
} from '../lib/listview.js'
import { dayKey } from '../lib/mywork.js'

const sameConfig = (a, b) => JSON.stringify(normalizeConfig(a)) === JSON.stringify(normalizeConfig(b))
const DATE_TOKENS = [['@today', 'Hoy'], ['@week', 'Fin de esta semana'], ['@week_start', 'Inicio de esta semana']]
const toDate = key => (key ? new Date(`${key}T12:00:00`) : null)

export default function ListaView({ items, me, owners = [], projectNames = [], onItemChange, onOpenItem, ui, api }) {
  const { C, Tag, priColor, fmtFecha } = ui
  const [selected, setSelected] = useState('preset:mine')
  const [config, setConfig] = useState(() => normalizeConfig(PRESETS.find(p => p.id === 'mine').config))
  const [saved, setSaved] = useState([])
  const [savedError, setSavedError] = useState('')
  const [saving, setSaving] = useState(null)               // null | { name, visibility }
  const [showCols, setShowCols] = useState(false)
  const [collapsed, setCollapsed] = useState({})

  const ctx = useMemo(() => ({ today: dayKey(new Date()), me: me?.name || '' }), [me?.name])
  const reloadSaved = async () => {
    try { setSaved(await api.listSavedViews(me?.id)); setSavedError('') }
    catch (e) { setSaved([]); setSavedError('Las vistas guardadas no están disponibles todavía.') }
  }
  useEffect(() => { if (me?.id) reloadSaved() }, [me?.id])

  const current = selected.startsWith('saved:') ? saved.find(v => v.id === selected.slice(6)) : PRESETS.find(p => p.id === selected.slice(7))
  const baseConfig = current ? normalizeConfig(current.config) : null
  const dirty = baseConfig ? !sameConfig(baseConfig, config) : true
  const isOwnSaved = selected.startsWith('saved:') && current && current.owner_id === me?.id

  const pick = id => {
    setSelected(id)
    const v = id.startsWith('saved:') ? saved.find(s => s.id === id.slice(6)) : PRESETS.find(p => p.id === id.slice(7))
    if (v) setConfig(normalizeConfig(v.config))
    setCollapsed({})
  }

  const { groups, total } = useMemo(() => runView(items, config, ctx), [items, config, ctx])
  const optionsFor = field => {
    const def = FIELDS[field]
    if (def.options) return def.options.map(v => [v, def.optionLabel ? def.optionLabel(v) : v])
    const vals = [...new Set(items.map(i => def.get(i)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
    return vals.map(v => [v, v])
  }

  // ── config editing ──
  const setFilter = (idx, patch) => setConfig(c => ({ ...c, filters: c.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)) }))
  const changeField = (idx, field) => {
    const type = FIELDS[field].type
    setFilter(idx, { field, op: type === 'text' ? 'contains' : type === 'date' ? 'lte' : 'eq', value: type === 'date' ? '@today' : '' })
  }
  const changeOp = (idx, op) => setConfig(c => ({ ...c, filters: c.filters.map((f, i) => {
    if (i !== idx) return f
    const multi = op === 'in' || op === 'not_in'
    const v = multi ? (Array.isArray(f.value) ? f.value : f.value ? [f.value] : []) : (Array.isArray(f.value) ? f.value[0] || '' : f.value)
    return { ...f, op, value: NO_VALUE_OPS.includes(op) ? '' : v }
  }) }))
  const addFilter = () => setConfig(c => ({ ...c, filters: [...c.filters, { field: 'status', op: 'eq', value: '' }] }))
  const removeFilter = idx => setConfig(c => ({ ...c, filters: c.filters.filter((_, i) => i !== idx) }))
  const sortBy = field => setConfig(c => {
    const cur = c.sort[0]
    const next = !cur || cur.field !== field ? [{ field, dir: 'asc' }] : cur.dir === 'asc' ? [{ field, dir: 'desc' }] : []
    return { ...c, sort: next }
  })
  const toggleColumn = k => setConfig(c => {
    const has = c.columns.includes(k)
    if (has && c.columns.length === 1) return c
    return { ...c, columns: ALL_COLUMNS.filter(x => (x === k ? !has : c.columns.includes(x))) }
  })

  // ── saved views ──
  const doSave = async (asNew) => {
    try {
      if (asNew || !isOwnSaved) {
        const created = await api.saveSavedView({ name: saving.name.trim(), visibility: saving.visibility, ownerId: me.id, config })
        await reloadSaved(); setSelected('saved:' + created.id)
      } else {
        await api.saveSavedView({ id: current.id, name: current.name, visibility: current.visibility, ownerId: me.id, config })
        await reloadSaved()
      }
      setSaving(null)
    } catch (e) { setSavedError('No se pudo guardar la vista: ' + (e.message || e)) }
  }
  const doDelete = async () => {
    if (!isOwnSaved || !window.confirm(`¿Eliminar la vista "${current.name}"?`)) return
    try { await api.deleteSavedView(current.id); await reloadSaved(); pick('preset:all') } catch (e) { setSavedError('No se pudo eliminar: ' + (e.message || e)) }
  }

  // ── styles ──
  const sel = { padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, background: C.card, color: C.text, maxWidth: 180 }
  const btn = { padding: '5px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, background: C.card, color: C.text, cursor: 'pointer' }
  const cell = { padding: '8px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: 'middle' }
  const COLS = { tema: 260, status: 130, propietario: 150, prioridad: 80, proyecto: 190, category: 110, risk: 90, fechaInicio: 120, fechaFin: 120 }

  const valueControl = (f, idx) => {
    if (NO_VALUE_OPS.includes(f.op)) return null
    const def = FIELDS[f.field]
    if (def.type === 'text') return <input value={f.value || ''} onChange={e => setFilter(idx, { value: e.target.value })} placeholder="valor…" style={{ ...sel, width: 130 }} />
    if (def.type === 'date') {
      const token = DATE_TOKENS.some(([t]) => t === f.value) ? f.value : 'custom'
      return <>
        <select value={token} onChange={e => setFilter(idx, { value: e.target.value === 'custom' ? dayKey(new Date()) : e.target.value })} style={sel}>
          {DATE_TOKENS.map(([t, l]) => <option key={t} value={t}>{l}</option>)}<option value="custom">Fecha concreta</option>
        </select>
        {token === 'custom' && <input type="date" value={f.value || ''} onChange={e => setFilter(idx, { value: e.target.value })} style={sel} />}
      </>
    }
    const opts = optionsFor(f.field)
    if (f.op === 'in' || f.op === 'not_in') {
      const cur = Array.isArray(f.value) ? f.value : []
      return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
        {opts.map(([v, l]) => {
          const on = cur.includes(v)
          return <button key={v} type="button" onClick={() => setFilter(idx, { value: on ? cur.filter(x => x !== v) : [...cur, v] })}
            style={{ ...btn, padding: '3px 8px', background: on ? C.accent : C.card, color: on ? '#fff' : C.text, borderColor: on ? C.accent : C.border }}>{l}</button>
        })}
      </span>
    }
    return <select value={Array.isArray(f.value) ? f.value[0] || '' : f.value || ''} onChange={e => setFilter(idx, { value: e.target.value })} style={sel}>
      <option value="">—</option>
      {f.field === 'propietario' && <option value="@me">Yo</option>}
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  }

  const editCell = (it, k) => {
    const stop = e => e.stopPropagation()
    if (k === 'tema') return <a onClick={() => onOpenItem(it)} style={{ cursor: 'pointer', fontWeight: 600, color: C.text }}>{it.tema}</a>
    if (k === 'status') return <select value={it.status} onClick={stop} onChange={e => onItemChange(it.id, { status: e.target.value })} style={sel}>{STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
    if (k === 'prioridad') return <select value={it.prioridad || ''} onClick={stop} onChange={e => onItemChange(it.id, { prioridad: e.target.value })} style={{ ...sel, background: priColor(it.prioridad).bg, color: priColor(it.prioridad).color, fontWeight: 700 }}><option value="">—</option>{PRIO_ORDER.map(p => <option key={p}>{p}</option>)}</select>
    if (k === 'propietario') return <select value={it.propietario || ''} onClick={stop} onChange={e => onItemChange(it.id, { propietario: e.target.value })} style={sel}>
      <option value="">—</option>{[...new Set([...owners, it.propietario].filter(Boolean))].map(o => <option key={o} value={o}>{o}</option>)}</select>
    if (k === 'proyecto') return <select value={it.proyecto || ''} onClick={stop} onChange={e => onItemChange(it.id, { proyecto: e.target.value })} style={sel}>
      <option value="">—</option>{[...new Set([...projectNames, it.proyecto].filter(Boolean))].map(p => <option key={p} value={p}>{p}</option>)}</select>
    if (k === 'fechaFin' || k === 'fechaInicio') {
      const key = FIELDS[k].get(it)
      const late = k === 'fechaFin' && key && key < ctx.today && it.status !== 'done' && it.status !== 'backlog'
      return <input type="date" value={key} onClick={stop} onChange={e => onItemChange(it.id, { [k]: toDate(e.target.value) })} style={{ ...sel, color: late ? '#e11d48' : C.text, fontWeight: late ? 700 : 400 }} />
    }
    const v = FIELDS[k].get(it)
    return <span style={{ color: C.muted }}>{FIELDS[k].optionLabel ? FIELDS[k].optionLabel(v) : v || '—'}</span>
  }

  const sortMark = k => config.sort[0]?.field === k ? (config.sort[0].dir === 'asc' ? ' ▲' : ' ▼') : ''
  const savedMine = saved.filter(v => v.owner_id === me?.id), savedShared = saved.filter(v => v.owner_id !== me?.id)

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 20px', background: C.bg }}>
      {/* toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={selected} onChange={e => pick(e.target.value)} style={{ ...sel, fontWeight: 600, maxWidth: 240 }}>
          <optgroup label="Vistas base">{PRESETS.map(p => <option key={p.id} value={'preset:' + p.id}>{p.name}</option>)}</optgroup>
          {savedMine.length > 0 && <optgroup label="Mis vistas">{savedMine.map(v => <option key={v.id} value={'saved:' + v.id}>{v.name}{v.visibility !== 'private' ? ' (equipo)' : ''}</option>)}</optgroup>}
          {savedShared.length > 0 && <optgroup label="Compartidas">{savedShared.map(v => <option key={v.id} value={'saved:' + v.id}>{v.name}</option>)}</optgroup>}
        </select>
        {dirty && <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>● modificada</span>}
        {isOwnSaved && dirty && <button style={btn} onClick={() => doSave(false)}>Guardar cambios</button>}
        <button style={btn} onClick={() => setSaving({ name: '', visibility: 'private' })} disabled={!me?.id}>Guardar como…</button>
        {isOwnSaved && <button style={{ ...btn, color: '#e11d48' }} onClick={doDelete}>Eliminar vista</button>}
        {dirty && baseConfig && <button style={btn} onClick={() => setConfig(baseConfig)}>Descartar cambios</button>}
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: C.muted }}>Agrupar por&nbsp;
          <select value={config.groupBy} onChange={e => setConfig(c => ({ ...c, groupBy: e.target.value }))} style={sel}>
            <option value="">Sin agrupar</option>{GROUPABLE.map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
        </label>
        <span style={{ position: 'relative' }}>
          <button style={btn} onClick={() => setShowCols(v => !v)}>Columnas ▾</button>
          {showCols && <div style={{ position: 'absolute', right: 0, top: 32, zIndex: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 170 }}>
            {ALL_COLUMNS.map(k => <label key={k} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={config.columns.includes(k)} onChange={() => toggleColumn(k)} />{FIELDS[k].label}</label>)}
            <button style={{ ...btn, marginTop: 6, width: '100%' }} onClick={() => setConfig(c => ({ ...c, columns: DEFAULT_COLUMNS }))}>Por defecto</button>
          </div>}
        </span>
      </div>
      {savedError && <div style={{ fontSize: 12, color: '#b45309', marginBottom: 8 }}>{savedError}</div>}
      {saving && <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, marginBottom: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, flexWrap: 'wrap' }}>
        <input autoFocus value={saving.name} onChange={e => setSaving(s => ({ ...s, name: e.target.value }))} placeholder="Nombre de la vista" style={{ ...sel, width: 220 }} />
        <select value={saving.visibility} onChange={e => setSaving(s => ({ ...s, visibility: e.target.value }))} style={sel}><option value="private">Privada</option><option value="team">Equipo</option></select>
        <button style={{ ...btn, background: C.accent, color: '#fff', borderColor: C.accent }} disabled={!saving.name.trim()} onClick={() => doSave(true)}>Guardar</button>
        <button style={btn} onClick={() => setSaving(null)}>Cancelar</button>
      </div>}

      {/* filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {config.filters.map((f, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: C.muted, width: 38 }}>{idx === 0 ? 'Donde' : 'y'}</span>
            <select value={f.field} onChange={e => changeField(idx, e.target.value)} style={sel}>{Object.entries(FIELDS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select>
            <select value={f.op} onChange={e => changeOp(idx, e.target.value)} style={sel}>{Object.entries(OPERATORS[FIELDS[f.field].type]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {valueControl(f, idx)}
            <button style={{ ...btn, padding: '3px 8px' }} onClick={() => removeFilter(idx)} title="Quitar filtro">✕</button>
          </div>))}
        <div><button style={btn} onClick={addFilter}>+ Filtro</button>
          <span style={{ fontSize: 12, color: C.muted, marginLeft: 12 }}>{total} {total === 1 ? 'tema' : 'temas'}</span></div>
      </div>

      {/* table */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflowX: 'auto', background: C.card }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: config.columns.reduce((s, k) => s + COLS[k], 0) }}>
          <thead><tr>{config.columns.map(k => (
            <th key={k} onClick={() => sortBy(k)} style={{ ...cell, width: COLS[k], textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted, cursor: 'pointer', background: C.surface, userSelect: 'none' }}>
              {FIELDS[k].label}{sortMark(k)}</th>))}</tr></thead>
          <tbody>
            {total === 0 && <tr><td colSpan={config.columns.length} style={{ ...cell, textAlign: 'center', color: C.muted, padding: 30 }}>Ningún tema cumple los filtros.</td></tr>}
            {groups.map(g => (
              <GroupRows key={g.key || '_'} g={g} grouped={!!config.groupBy} collapsed={!!collapsed[g.key]} toggle={() => setCollapsed(c => ({ ...c, [g.key]: !c[g.key] }))}
                columns={config.columns} cell={cell} C={C} render={editCell} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GroupRows({ g, grouped, collapsed, toggle, columns, cell, C, render }) {
  return <>
    {grouped && <tr onClick={toggle} style={{ cursor: 'pointer', background: C.surface }}>
      <td colSpan={columns.length} style={{ ...cell, fontWeight: 700, fontSize: 12 }}>{collapsed ? '▶' : '▼'} {g.label} <span style={{ color: C.muted, fontWeight: 400 }}>{g.items.length}</span></td></tr>}
    {!collapsed && g.items.map(it => <tr key={it.id}>{columns.map(k => <td key={k} style={{ ...cell, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{render(it, k)}</td>)}</tr>)}
  </>
}
