import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { parseSheetValues, buildItems, parseCampanas, parseProyectos, norm, mapRisk } from './parser.js'

// ── Constants ────────────────────────────────────────────────────────────────
const CATS = [
  { id:'projects', label:'Iniciativas',   color:'#3b82f6', bg:'#dbeafe' },
  { id:'product',  label:'Producto',     color:'#8b5cf6', bg:'#ede9fe' },
  { id:'tools',    label:'Herramientas', color:'#d97706', bg:'#fef3c7' },
  { id:'cvm',      label:'CVM',          color:'#0891b2', bg:'#cffafe' },
]
const ST = [
  { id:'pending',    label:'Pendiente',  color:'#64748b' },
  { id:'inprogress', label:'En Curso',   color:'#f59e0b' },
  { id:'blocked',    label:'Bloqueado',  color:'#e11d48' },
  { id:'done',       label:'Completado', color:'#10b981' },
  { id:'backlog',    label:'Backlog',    color:'#94a3b8' },
]
const RK = [
  { id:'green',  label:'Normal',   color:'#10b981' },
  { id:'yellow', label:'Atención', color:'#d97706' },
  { id:'red',    label:'Riesgo',   color:'#e11d48' },
]
const ST_TO_SHEET = {
  pending:'No iniciado', inprogress:'Según lo planificado',
  blocked:'En peligro',  done:'Hecho', backlog:'No iniciado',
}
const C = {
  bg:'#f5f3f0', surface:'#fafaf8', card:'#ffffff',
  border:'#ebe8e3', text:'#1c1b19', muted:'#6b6862', accent:'#e8243b',
}
const OV_KEY           = 'obs-status-overrides'
const COMMENTS_KEY     = 'obs-comments'
const PROJ_COMMENTS_KEY = 'obs-proj-comments'
const PROY_OV_KEY       = 'obs-proy-overrides'
const DONE_TS_KEY       = id => `obs-done-ts-${id}`
const LOCAL_ITEMS_KEY  = 'obs-local-items'

// Owner colors
const OWN_COLORS = {
  'juan rodriguez peisel': '#2563eb',
  'francisco toledo':      '#7c3aed',
  'nacho cruz':            '#d97706',
  'maria garcia':          '#0891b2',
}
const ownerColor = name => OWN_COLORS[norm(name || '')] || '#64748b'

// Priority color mapping
const PRI_COLORS = {
  P0: { bg:'#fef2f2', color:'#dc2626' },
  P1: { bg:'#fff7ed', color:'#c2410c' },
  P2: { bg:'#fffbeb', color:'#b45309' },
  P3: { bg:'#f0fdf4', color:'#15803d' },
}
const priColor = p => PRI_COLORS[p] || { bg:C.surface, color:C.muted }

// WIP limits per column (null = no limit)
const WIP_LIMITS = { pending:null, inprogress:null, blocked:null, done:null, backlog:null }

const PRIORIDADES  = ['P0', 'P1', 'P2', 'P3']
const KNOWN_OWNERS = ['Juan Rodriguez Peisel', 'Francisco Toledo', 'Nacho Cruz', 'Maria Garcia']

const FASES = [
  { id:'RTM',             label:'RTM',              labelEN:'RTM',             pct:10  },
  { id:'Viabilidad',      label:'Viabilidad',       labelEN:'Feasibility',     pct:25  },
  { id:'Business case',   label:'Business case',    labelEN:'Business case',   pct:30  },
  { id:'Comite de capex', label:'Comité de capex',  labelEN:'Capex Committee', pct:30  },
  { id:'Desarrollo',      label:'Desarrollo',       labelEN:'Development',     pct:100 },
]
const fasePct = fase => { if(!fase) return 0; const f=FASES.find(f=>norm(f.id)===norm(fase)); return f?f.pct:0 }
const faseLabel = (fase,lng='es') => { if(!fase) return '—'; const f=FASES.find(f=>norm(f.id)===norm(fase)); return f?(lng==='en'?f.labelEN:f.label):fase }

// CVM campaign helpers
const TIPO_COLORS = {
  'oferta one shot':'#d97706', 'oferta':'#d97706',
  'reminder':'#e8243b', 'bau':'#475569',
  'reactivacion':'#e11d48', 'reactivación':'#e11d48',
}
const ESTADO_CAMP_COLORS = {
  'planificado':'#e8243b', 'enviado':'#10b981', 'cancelado':'#e11d48',
}
const tipoColor   = t => TIPO_COLORS[norm(t)]   || '#0891b2'
const estadoCColor = e => ESTADO_CAMP_COLORS[norm(e)] || '#64748b'

// ── Helpers ──────────────────────────────────────────────────────────────────
const uid       = () => Math.random().toString(36).slice(2, 9)
const pad       = n  => String(n).padStart(2, '0')
const fmtFecha  = d => {
  if (!d) return '—'
  try { return new Date(d + 'T12:00').toLocaleDateString('es-ES', { day:'2-digit', month:'short' }) }
  catch { return d }
}
const diasRestantes = e => e ? Math.ceil((new Date(e + 'T23:59').getTime() - Date.now()) / 86400000) : null
const iniciales     = n => (n || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()
const fdStr         = d => d instanceof Date ? d.toISOString().slice(0, 10) : (d || '')

const useW = () => {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1400)
  useEffect(() => { const h = () => setW(window.innerWidth); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) }, [])
  return w
}

const lsGet = (k, def = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def } catch { return def } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

const getOverrides = ()          => lsGet(OV_KEY, {})
const saveOverride     = (k, fields)     => { const ov = getOverrides(); ov[k] = { ...(ov[k]||{}), ...fields, ts:new Date().toISOString() }; lsSet(OV_KEY, ov) }
const getProyOverrides = ()              => lsGet(PROY_OV_KEY, {})
const saveProyOverride = (nombre, flds) => { const ov = getProyOverrides(); const nk = norm(nombre); ov[nk] = {...(ov[nk]||{}), ...flds}; lsSet(PROY_OV_KEY, ov) }
const saveDoneTs       = id             => { try { if (!localStorage.getItem(DONE_TS_KEY(id))) localStorage.setItem(DONE_TS_KEY(id), Date.now().toString()) } catch {} }
const getDoneTs        = id             => { try { return parseInt(localStorage.getItem(DONE_TS_KEY(id)) || '0') } catch { return 0 } }
const isArchived       = item           => item.status === 'done' && getDoneTs(item.id) > 0 && (Date.now() - getDoneTs(item.id)) > 7 * 86400000
const getComments  = k           => (lsGet(COMMENTS_KEY, []) || []).filter(c => c.k === k)
const saveComment  = (k, text)   => {
  const all = lsGet(COMMENTS_KEY, []) || []
  const now = new Date()
  const ts  = `${pad(now.getDate())}/${pad(now.getMonth()+1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const item = { k, ts, text, id:uid(), iso:now.toISOString() }
  lsSet(COMMENTS_KEY, [item, ...all].slice(0, 300))
  return item
}
const getProjectComments = k         => (lsGet(PROJ_COMMENTS_KEY, []) || []).filter(c => c.k === k)
const saveProjectComment = (k, text) => {
  const all = lsGet(PROJ_COMMENTS_KEY, []) || []
  const now = new Date()
  const ts  = `${pad(now.getDate())}/${pad(now.getMonth()+1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const item = { k, ts, text, id:uid(), iso:now.toISOString() }
  lsSet(PROJ_COMMENTS_KEY, [item, ...all].slice(0, 300))
  return item
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
function dbToItem(row) {
  return {
    ...row,
    estadoSheet: row.estado_sheet || 'No iniciado',
    fechaInicio: row.fecha_inicio ? new Date(row.fecha_inicio) : null,
    fechaFin:    row.fecha_fin    ? new Date(row.fecha_fin)    : null,
    subtareas:   Array.isArray(row.subtareas) ? row.subtareas : [],
  }
}
function itemToDb(item) {
  return {
    id:           item.id,
    tema:         item.tema || '',
    objetivo:     item.objetivo || '',
    category:     item.category || 'projects',
    propietario:  item.propietario || '',
    prioridad:    item.prioridad || '',
    risk:         item.risk || 'green',
    status:       item.status || 'pending',
    estado_sheet: item.estadoSheet || 'No iniciado',
    fecha_inicio: item.fechaInicio instanceof Date ? item.fechaInicio.toISOString() : (item.fechaInicio || null),
    fecha_fin:    item.fechaFin    instanceof Date ? item.fechaFin.toISOString()    : (item.fechaFin    || null),
    archivos:     item.archivos || '',
    notas:        item.notas || '',
    proyecto:     item.proyecto || '',
    subtareas:    item.subtareas || [],
  }
}
function dbToProy(row) {
  return {
    ...row,
    // Map snake_case DB fields to camelCase used by components
    status:      row.status || mapSt(row.estado || ''),
    fechaInicio: row.fecha_inicio ? new Date(row.fecha_inicio) : null,
    fechaFin:    row.fecha_fin    ? new Date(row.fecha_fin)    : null,
    fase:        row.fase        || '',
    capex:       row.capex       ?? null,
    nombreEN:    row.nombre_en   || '',
  }
}

async function fetchAll() {
  const [{ data: iData, error: e1 }, { data: pData, error: e2 }, { data: cData, error: e3 }] = await Promise.all([
    supabase.from('items').select('*').order('created_at', { ascending: false }),
    supabase.from('proyectos').select('*').order('created_at', { ascending: false }),
    supabase.from('campanas').select('*').order('created_at', { ascending: false }),
  ])
  if (e1) throw new Error('items: ' + e1.message)
  if (e2) throw new Error('proyectos: ' + e2.message)
  // campanas error is non-fatal (table may be empty)
  return {
    items:     (iData || []).map(dbToItem),
    proyectos: (pData || []),
    campanas:  (cData || []),
  }
}

async function sbUpdate(id, fields) {
  const { error } = await supabase.from('items').update(fields).eq('id', id)
  if (error) throw new Error(error.message)
}

async function sbUpdateProyecto(id, fields) {
  const { error } = await supabase.from('proyectos').update(fields).eq('id', id)
  if (error) throw new Error(error.message)
}

// Hitos
async function fetchHitos(proyectoId) {
  const { data, error } = await supabase.from('hitos').select('*').eq('proyecto_id', proyectoId).order('orden', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

async function addHito(proyectoId, nombre, fechaPrevista) {
  const { data, error } = await supabase.from('hitos').insert({ id:uid(), proyecto_id:proyectoId, nombre, fecha_prevista:fechaPrevista, orden:0 }).select()
  if (error) throw new Error(error.message)
  return data?.[0]
}

async function updateHito(id, fields) {
  const { error } = await supabase.from('hitos').update(fields).eq('id', id)
  if (error) throw new Error(error.message)
}

async function deleteHito(id) {
  const { error } = await supabase.from('hitos').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Comentarios de proyecto
async function fetchProyectoComments(proyectoId) {
  const { data, error } = await supabase.from('comentarios').select('*').eq('proyecto_id', proyectoId).eq('item_id', null).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

async function addProyectoComment(proyectoId, texto) {
  const { data, error } = await supabase.from('comentarios').insert({ id:uid(), proyecto_id:proyectoId, item_id:null, texto, ts:new Date().toLocaleString('es-ES') }).select()
  if (error) throw new Error(error.message)
  return data?.[0]
}

// Fire-and-forget email notification when a task is assigned to Juan or Fran
async function notifyAssignment({ tema, propietario, descripcion = '', categoria = '', prioridad = '' }) {
  if (!propietario) return
  try {
    await fetch('/api/notify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tema, propietario, descripcion, categoria, prioridad }),
    })
  } catch (e) {
    console.warn('[notify] Error:', e.message)
  }
}

async function callClaude(body) {
  const res  = await fetch('/api/claude', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    const msg = data.error?.message || data.error || `HTTP ${res.status}`
    throw new Error(`API Anthropic: ${msg}`)
  }
  return data.content?.find(b => b.type === 'text')?.text || ''
}

// ── Small UI components ───────────────────────────────────────────────────────
const Dot  = ({ risk }) => { const r = RK.find(x => x.id === risk) || RK[0]; return <div style={{ width:8, height:8, borderRadius:'50%', background:r.color, boxShadow:`0 0 5px ${r.color}88`, flexShrink:0 }} /> }
const Tag  = ({ id, type }) => {
  const src  = type === 'cat' ? CATS : ST
  const item = src.find(x => x.id === id)
  if (!item) return null
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:type==='cat'?item.bg:item.color+'22', color:item.color, textTransform:'uppercase', letterSpacing:'.05em' }}>{item.label}</span>
}
const Sel  = ({ value, onChange, opts, style }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', fontSize:13, outline:'none', cursor:'pointer', ...style }}>
    {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
  </select>
)
const TA   = ({ value, onChange, placeholder, rows = 4, style, onKeyDown }) => (
  <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} onKeyDown={onKeyDown}
    style={{ background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'8px 12px', fontSize:13, outline:'none', width:'100%', resize:'vertical', fontFamily:'inherit', ...style }} />
)
const Btn  = ({ onClick, children, v='primary', style, disabled }) => {
  const vs = {
    primary: { background:C.accent, color:'#fff', border:'none' },
    sec:     { background:C.card, color:C.text, border:`1px solid ${C.border}` },
    ghost:   { background:'transparent', color:C.muted, border:'none' },
  }
  return <button onClick={onClick} disabled={disabled}
    style={{ padding:'8px 16px', borderRadius:6, fontSize:13, fontWeight:600, cursor:disabled?'not-allowed':'pointer', opacity:disabled?.5:1, display:'inline-flex', alignItems:'center', gap:6, ...vs[v], ...style }}>
    {children}
  </button>
}
const Lbl  = ({ children }) => <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:5 }}>{children}</div>
const AlertFecha = ({ endDate, status }) => {
  if (!endDate || status === 'done') return null
  const dl    = diasRestantes(fdStr(endDate))
  const color = dl < 0 ? '#f43f5e' : dl <= 3 ? '#fbbf24' : C.muted
  const txt   = dl < 0 ? `Vencida ${Math.abs(dl)}d` : dl === 0 ? 'Hoy' : dl <= 3 ? `${dl}d` : fmtFecha(fdStr(endDate))
  return <span style={{ fontSize:11, color, fontWeight:dl<=3?700:400, background:dl<=3?color+'22':'transparent', padding:dl<=3?'2px 5px':'0', borderRadius:4 }}>{txt}</span>
}
const Toast = ({ msg, type = 'success', onHide }) => {
  useEffect(() => { const t = setTimeout(onHide, 2800); return () => clearTimeout(t) }, [])
  const col = type === 'error' ? '#f43f5e' : type === 'warn' ? '#fbbf24' : '#34d399'
  return (
    <div style={{
      position:'fixed', bottom:24, right:24, zIndex:3000,
      background:C.card, border:`1px solid ${col}55`, borderLeft:`3px solid ${col}`,
      borderRadius:8, padding:'11px 18px', fontSize:13, color:col, fontWeight:600,
      display:'flex', alignItems:'center', gap:8,
      boxShadow:'0 4px 20px rgba(0,0,0,.12)',
      animation:'toastSlideIn 220ms cubic-bezier(0.23,1,0.32,1) both',
      pointerEvents:'none', userSelect:'none',
    }}>
      <style>{`@keyframes toastSlideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>
      {type === 'error' ? '⚠' : type === 'warn' ? '⚠' : '✓'} {msg}
    </div>
  )
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────
const Tarjeta = ({ item, onClick, onNextSt }) => {
  const cat       = CATS.find(c => c.id === item.category)
  const nextIdx   = (ST.findIndex(s => s.id === item.status) + 1) % ST.length
  const nextId    = ST[nextIdx].id
  const nextSt    = ST[nextIdx]
  const allSubs   = [...(item.subtareas||[]), ...(item.subtareasLocal||[])]
  const stOk      = allSubs.filter(s => s.status === 'done').length
  const stTot     = allSubs.length
  const dl        = item.fechaFin && item.status !== 'done' ? diasRestantes(fdStr(item.fechaFin)) : null
  const isOverdue = dl !== null && dl < 0
  const isBlocked = item.status === 'blocked'
  const isDone    = item.status === 'done'
  const pc        = priColor(item.prioridad)
  const oc        = ownerColor(item.propietario)
  // soft pastel of ownerColor for square avatar bg
  const ocSoft    = oc + '22'
  // due label
  const dueLabel  = item.fechaFin && item.status !== 'done'
    ? (() => { const d = fdStr(item.fechaFin); const [y,m,dd] = d.split('-'); return `${dd}/${m}` })()
    : null
  const dueColor  = isOverdue ? '#dc2626' : dl !== null && dl <= 3 ? '#f59e0b' : '#9b978f'
  const borderColor = (isOverdue || isBlocked)
    ? (isBlocked ? '#e11d4844' : '#dc262644')
    : C.border

  return (
    <div
      onClick={() => onClick(item)}
      style={{
        background:'#fff', borderRadius:12, padding:'11px 12px 12px',
        border:`1px solid ${borderColor}`,
        marginBottom:8, cursor:'pointer', opacity: isDone ? 0.7 : 1,
        display:'flex', flexDirection:'column', gap:9,
        transition:'border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor='#d6d1c8'
        e.currentTarget.style.boxShadow='0 4px 14px rgba(28,27,25,.07)'
        e.currentTarget.style.transform='translateY(-1px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor=borderColor
        e.currentTarget.style.boxShadow='none'
        e.currentTarget.style.transform='translateY(0)'
      }}>

      {/* Row 1: cat dot + cat label + ~local badge + prio badge */}
      <div style={{ display:'flex', alignItems:'center', gap:7 }}>
        <span style={{ width:6, height:6, borderRadius:'50%', background: cat?.color || C.muted, flexShrink:0 }} />
        <span style={{ fontSize:10, fontWeight:600, letterSpacing:'.04em', textTransform:'uppercase', color:'#9b978f' }}>
          {cat?.label || 'Sin categoría'}
        </span>
        <span style={{ flex:1 }} />
        {item._hasLocal && (
          <span title="Cambios locales pendientes" style={{ fontFamily:"'Geist Mono',monospace", fontSize:9, color:'#a8a39a', border:'1px solid #e8e5df', borderRadius:4, padding:'1px 4px', letterSpacing:'.02em' }}>~local</span>
        )}
        {item.prioridad && (
          <span style={{ fontFamily:"'Geist Mono',monospace", fontSize:9.5, fontWeight:500, color:pc.color, background:pc.bg, border:`1px solid ${pc.bd||pc.bg}`, borderRadius:5, padding:'1px 5px' }}>
            {item.prioridad}
          </span>
        )}
      </div>

      {/* Row 2: tema text */}
      <div style={{ fontSize:13, fontWeight:550, color: isDone ? C.muted : '#1c1b19', lineHeight:1.38, letterSpacing:'-.005em', textDecoration: isDone ? 'line-through' : 'none' }}>
        {item.tema}
      </div>

      {/* Row 3: owner avatar + name + subtasks + due date + → button */}
      <div style={{ display:'flex', alignItems:'center', gap:7, marginTop:1 }}>
        <span
          title={item.propietario || 'Sin propietario'}
          style={{ width:19, height:19, borderRadius:6, background:ocSoft, color:oc, fontFamily:"'Geist Mono',monospace", fontSize:9, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          {iniciales(item.propietario)}
        </span>
        <span style={{ fontSize:11.5, color:'#6b6862', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:80 }}>
          {item.propietario ? item.propietario.split(' ')[0] : '—'}
        </span>
        {stTot > 0 && <span style={{ fontSize:10, color:'#9b978f', fontFamily:"'Geist Mono',monospace" }}>{stOk}/{stTot}</span>}
        <span style={{ flex:1 }} />
        {dueLabel && (
          <span style={{ fontFamily:"'Geist Mono',monospace", fontSize:10.5, color:dueColor, display:'flex', alignItems:'center', gap:3 }}>
            {isOverdue && '⚠ '}{dueLabel}
          </span>
        )}
        {!isDone && item.status !== 'backlog' && (
          <button
            title="Mover al Backlog (pausar)"
            aria-label="Mover al Backlog"
            onClick={e => { e.stopPropagation(); onNextSt(item.id, 'backlog') }}
            style={{ width:22, height:22, borderRadius:6, border:'1px solid #cbd5e1', background:'#f1f5f9', color:'#64748b', fontSize:13, lineHeight:1, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .15s ease' }}
            onMouseEnter={e => { e.currentTarget.style.background='#e2e8f0'; e.currentTarget.style.borderColor='#64748b'; e.currentTarget.style.color='#334155'; e.currentTarget.style.fontWeight='700' }}
            onMouseLeave={e => { e.currentTarget.style.background='#f1f5f9'; e.currentTarget.style.borderColor='#cbd5e1'; e.currentTarget.style.color='#64748b'; e.currentTarget.style.fontWeight='400' }}>
            ⊞
          </button>
        )}
        {!isDone && item.status !== 'backlog' && (
          <button
            title={`Avanzar a: ${nextSt.label}`}
            aria-label={`Cambiar estado a ${nextSt.label}`}
            onClick={e => { e.stopPropagation(); onNextSt(item.id, nextId) }}
            style={{ width:22, height:22, borderRadius:6, border:'1px solid #e4e1db', background:'#fbfaf8', color:'#6b6862', fontSize:13, lineHeight:1, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .15s ease' }}
            onMouseEnter={e => { e.currentTarget.style.background=C.accent; e.currentTarget.style.borderColor=C.accent; e.currentTarget.style.color='#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background='#fbfaf8'; e.currentTarget.style.borderColor='#e4e1db'; e.currentTarget.style.color='#6b6862' }}>
            →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Tablero KPI Strip ────────────────────────────────────────────────────────
const TableroKPIStrip = ({ items }) => {
  const total      = items.length
  const done       = items.filter(i => i.status === 'done').length
  const inprogress = items.filter(i => i.status === 'inprogress').length
  const blocked    = items.filter(i => i.status === 'blocked').length
  const overdue    = items.filter(i => i.fechaFin && i.status !== 'done' && diasRestantes(fdStr(i.fechaFin)) < 0).length
  const next7      = items.filter(i => { const d = i.fechaFin && i.status !== 'done' ? diasRestantes(fdStr(i.fechaFin)) : null; return d !== null && d >= 0 && d <= 7 }).length
  const pct        = total > 0 ? Math.round(done / total * 100) : 0

  const kpis = [
    { l:'Total',        v:total,        sub:'temas activos',   cls:'neutral',                     icon:null },
    { l:'Completado',   v:`${pct}%`,    sub:`${done} temas`,   cls:'ok',                          icon:'✓' },
    { l:'En curso',     v:inprogress,   sub:'en progreso',      cls:'neutral',                    icon:null },
    { l:'Bloqueados',   v:blocked,      sub:'requieren acción', cls:blocked>0?'warn':'neutral',   icon:blocked>0?'⚠':'null' },
    { l:'Vencidos',     v:overdue,      sub:'fuera de fecha',   cls:overdue>0?'alert':'neutral',  icon:overdue>0?'⚑':null },
    { l:'Próx. 7 días', v:next7,        sub:'fechas límite',    cls:'neutral',                    icon:null },
  ]
  const clsStyle = cls => ({
    alert:   { bg:'#fef2f2', border:'#fecaca', val:'#dc2626', sub:'#dc262688' },
    warn:    { bg:'#fffbeb', border:'#fde68a', val:'#d97706', sub:'#d9770688' },
    ok:      { bg:'#f0fdf4', border:'#bbf7d0', val:'#16a34a', sub:'#16a34a88' },
    neutral: { bg:C.surface, border:C.border, val:C.text,    sub:C.muted },
  }[cls] || { bg:C.surface, border:C.border, val:C.text, sub:C.muted })

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:8, marginBottom:14, marginTop:2 }}>
      {kpis.map((k, i) => {
        const s = clsStyle(k.cls)
        return (
          <div key={i} style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:8, padding:'10px 12px' }}>
            <div style={{ fontSize:10, color:s.sub, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:3, fontWeight:600 }}>{k.l}</div>
            <div style={{ fontSize:20, fontWeight:700, color:s.val, lineHeight:1 }}>{k.v}</div>
            <div style={{ fontSize:10, color:s.sub, marginTop:3 }}>{k.sub}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tablero ──────────────────────────────────────────────────────────────────
const Tablero = ({ items, catF, setCatF, asF, setAsF, owners, setItem, onNextSt, modo, setModo, onNuevo }) => {
  const [search,      setSearch]      = useState('')
  const [priF,        setPriF]        = useState('all')
  const [alertasOnly, setAlertasOnly] = useState(false)
  const [backlogOpen, setBacklogOpen] = useState(true)
  const [activarId,   setActivarId]   = useState(null)
  const [activarSt,   setActivarSt]   = useState('pending')
  const w = useW()
  const kanbanCols = w >= 1024 ? 'repeat(4,1fr)' : w >= 640 ? 'repeat(2,1fr)' : 'repeat(1,1fr)'

  const backlogItems = items.filter(i => i.status === 'backlog')

  const f = items
    .filter(i => i.status !== 'backlog')
    .filter(i => catF==='all'||i.category===catF)
    .filter(i => asF==='all'||norm(i.propietario)===norm(asF))
    .filter(i => priF==='all'||i.prioridad===priF)
    .filter(i => !alertasOnly || i.status==='blocked' || (i.fechaFin && i.status!=='done' && diasRestantes(fdStr(i.fechaFin)) < 0))
    .filter(i => !search.trim() || norm(i.tema + ' ' + (i.objetivo||'')).includes(norm(search)))

  const toggleAlertas = () => {
    setAlertasOnly(p => !p)
    if (!alertasOnly) { setCatF('all'); setAsF('all'); setPriF('all') }
  }

  const hasFilters = catF!=='all'||asF!=='all'||priF!=='all'||alertasOnly||search.trim()

  return (
    <div>
      {/* ── KPI strip ── */}
      <TableroKPIStrip items={f} />

      {/* ── Filter bar ── */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding: w < 768 ? '6px 8px' : '8px 12px', marginBottom:12, display:'flex', gap: w < 768 ? 4 : 8, flexWrap:'wrap', alignItems:'center', fontSize: w < 768 ? 10 : 11 }}>

        {/* Search */}
        <div style={{ display:'flex', alignItems:'center', gap:6, background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:'5px 10px', flex:1, minWidth:160 }}>
          <span style={{ color:C.muted, fontSize:13 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar tema…"
            style={{ border:'none', background:'none', fontSize:12, color:C.text, outline:'none', width:'100%' }} />
          {search && <button onClick={() => setSearch('')} style={{ border:'none', background:'none', color:C.muted, cursor:'pointer', fontSize:12 }}>✕</button>}
        </div>

        {/* Category chips - hidden en móvil */}
        {w >= 768 && [{ id:'all', label:'Todas', color:C.muted }, ...CATS].map(c => {
          const n  = c.id === 'all' ? items.length : items.filter(i => i.category === c.id).length
          const on = catF === c.id && !alertasOnly
          return (
            <button key={c.id} onClick={() => { setCatF(c.id); setAlertasOnly(false) }}
              style={{ padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
                border:on?`1px solid ${c.color}55`:`1px solid ${C.border}`,
                background:on?c.color+'22':C.card, color:on?c.color:C.muted, whiteSpace:'nowrap' }}>
              {c.label} <span style={{ opacity:.65 }}>{n}</span>
            </button>
          )
        })}

        {/* Separator - hidden en móvil */}
        {w >= 768 && <div style={{ width:1, height:18, background:C.border, flexShrink:0 }} />}

        {/* Alertas quick filter - hidden en móvil */}
        {w >= 768 && (
          <button onClick={toggleAlertas}
            style={{ padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
              border:alertasOnly?`1px solid #e11d4877`:`1px solid ${C.border}`,
              background:alertasOnly?'#fef2f2':C.card, color:alertasOnly?'#e11d48':C.muted, whiteSpace:'nowrap' }}>
            ⚠ Alertas {alertasOnly && <span style={{ opacity:.65 }}>{f.length}</span>}
          </button>
        )}

        {/* Right: owner + priority + views + new */}
        <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
          <select value={asF} onChange={e => setAsF(e.target.value)} aria-label="Filtrar por responsable"
            style={{ background:C.card, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'4px 8px', fontSize:11, cursor:'pointer', outline:'none' }}>
            <option value="all">Todos los responsables</option>
            {owners.map(o => <option key={o} value={o}>{o.split(' ')[0]}</option>)}
          </select>
          <select value={priF} onChange={e => setPriF(e.target.value)} aria-label="Filtrar por prioridad"
            style={{ background:C.card, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'4px 8px', fontSize:11, cursor:'pointer', outline:'none' }}>
            <option value="all">Todas las prioridades</option>
            {['P0','P1','P2','P3'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {hasFilters && (
            <button onClick={() => { setCatF('all'); setAsF('all'); setPriF('all'); setSearch(''); setAlertasOnly(false) }}
              style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, padding:'4px 8px', fontSize:11, color:C.muted, cursor:'pointer' }}>
              ✕ Limpiar
            </button>
          )}
          <div style={{ width:1, height:18, background:C.border }} />
          {[{ id:'kanban', l:'⊞' }, { id:'list', l:'☰' }].map(v => (
            <button key={v.id} onClick={() => setModo(v.id)} title={v.id==='kanban'?'Vista Kanban':'Vista Lista'}
              style={{ padding:'4px 8px', borderRadius:6, fontSize:13, border:`1px solid ${C.border}`,
                background:modo===v.id?C.accent+'22':C.card, color:modo===v.id?C.accent:C.muted, cursor:'pointer' }}>{v.l}</button>
          ))}
          <button onClick={onNuevo}
            style={{ padding:'5px 12px', borderRadius:6, fontSize:12, fontWeight:700, border:`1px solid ${C.accent}55`,
              background:C.accent, color:'#fff', cursor:'pointer' }}>
            + Nuevo tema
          </button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {f.length === 0 && (
        <div style={{ textAlign:'center', color:C.muted, padding:'40px 0', fontSize:13 }}>
          {search.trim()
            ? <>Sin resultados para "<b style={{ color:C.text }}>{search}</b>"</>
            : alertasOnly
              ? 'Sin alertas activas. ¡Todo en orden!'
              : 'Sin temas con estos filtros'}
          <button onClick={() => { setCatF('all'); setAsF('all'); setPriF('all'); setSearch(''); setAlertasOnly(false) }}
            style={{ marginLeft:10, background:'none', border:'none', color:C.accent, cursor:'pointer', fontSize:12 }}>
            Limpiar filtros
          </button>
        </div>
      )}

      {/* ── Kanban view ── */}
      {modo === 'kanban' && f.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:kanbanCols, gap:14 }}>
          {ST.filter(st => st.id !== 'backlog').map(st => {
            const col      = f.filter(i => i.status === st.id && !isArchived(i))
            const limit    = WIP_LIMITS[st.id]
            const overLimit = limit && col.length > limit
            const archCount = st.id === 'done' ? f.filter(i => i.status === 'done' && isArchived(i)).length : 0
            return (
              <div key={st.id}>
                {/* Column header */}
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                  <div style={{ width:7, height:7, borderRadius:'50%', background:st.color, flexShrink:0 }} />
                  <span style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.08em', flex:1 }}>{st.label}</span>
                  <span style={{
                    fontSize:10, padding:'2px 7px', borderRadius:10, fontWeight:600,
                    background: overLimit ? '#fef2f2' : st.color+'22',
                    color:      overLimit ? '#dc2626' : st.color,
                    border:     `1px solid ${overLimit ? '#fca5a5' : st.color+'44'}`,
                  }}>
                    {col.length}{limit ? ` / ${limit}` : ''}
                  </span>
                </div>

                {/* WIP over-limit alert */}
                {overLimit && (
                  <div style={{ fontSize:10, color:'#dc2626', background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:5, padding:'5px 8px', marginBottom:8, display:'flex', alignItems:'center', gap:5 }}>
                    ⚠ WIP superado — mueve o bloquea temas
                  </div>
                )}
                {archCount > 0 && (
                  <div style={{ fontSize:10, color:C.muted, background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:'5px 8px', marginBottom:8, display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ color:'#e8243b' }}>⬡</span> {archCount} tema{archCount!==1?'s':''} en Histórico
                  </div>
                )}

                {/* Cards */}
                <div style={{ minHeight:60 }}>
                  {col.length === 0
                    ? <div style={{ border:`2px dashed ${C.border}`, borderRadius:8, padding:'18px 12px', textAlign:'center', color:C.muted, fontSize:11 }}>Vacío</div>
                    : col.map(item => <Tarjeta key={item.id} item={item} onClick={setItem} onNextSt={onNextSt} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}


      {/* ── Backlog section ── */}
      {backlogItems.length > 0 && (
        <div style={{ marginTop:20, border:`1px solid #cbd5e1`, borderRadius:10, overflow:'hidden' }}>
          <div
            onClick={() => setBacklogOpen(p => !p)}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 14px', background:'#f1f5f9', cursor:'pointer', userSelect:'none', borderBottom: backlogOpen ? `1px solid #cbd5e1` : 'none' }}>
            <span style={{ fontSize:14, color:'#64748b', transition:'transform .2s', display:'inline-block', transform: backlogOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            <span style={{ fontSize:13, fontWeight:700, color:'#334155', textTransform:'uppercase', letterSpacing:'.06em' }}>📦 Backlog</span>
            <span style={{ fontSize:11, background:'#cbd5e1', color:'#334155', borderRadius:10, padding:'2px 8px', fontWeight:700 }}>{backlogItems.length}</span>
            <span style={{ fontSize:10, color:'#64748b', marginLeft:4, fontStyle:'italic' }}>pausado · haz clic para activar</span>
          </div>
          {backlogOpen && (
            <div style={{ padding:'10px 14px 14px', display:'flex', flexDirection:'column', gap:6 }}>
              {backlogItems.map(item => {
                const cat = CATS.find(c => c.id === item.category)
                const pc  = priColor(item.prioridad)
                const isActivating = activarId === item.id
                const kanbanST = ST.filter(s => s.id !== 'backlog')
                return (
                  <div key={item.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'#fff', borderRadius:8, border:'1px solid #e2e8f0', cursor:'pointer' }}
                    onClick={() => setItem(item)}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:cat?.color||C.muted, flexShrink:0 }} />
                    <span style={{ flex:1, fontSize:12, color:'#334155', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.tema}</span>
                    {item.prioridad && <span style={{ fontSize:10, fontWeight:700, padding:'1px 5px', borderRadius:4, background:pc.bg, color:pc.color }}>{item.prioridad}</span>}
                    <span style={{ fontSize:11, color:C.muted }}>{(item.propietario||'').split(' ')[0]||'--'}</span>
                    {isActivating ? (
                      <div style={{ display:'flex', alignItems:'center', gap:6 }} onClick={e => e.stopPropagation()}>
                        <select value={activarSt} onChange={e => setActivarSt(e.target.value)}
                          style={{ fontSize:11, padding:'3px 6px', borderRadius:5, border:'1px solid #cbd5e1', background:'#fff', color:'#334155', cursor:'pointer' }}>
                          {kanbanST.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                        <button
                          onClick={e => { e.stopPropagation(); onNextSt(item.id, activarSt); setActivarId(null) }}
                          style={{ fontSize:11, padding:'3px 10px', borderRadius:5, background:C.accent, color:'#fff', border:'none', cursor:'pointer', fontWeight:600 }}>
                          Activar
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setActivarId(null) }}
                          style={{ fontSize:11, padding:'3px 8px', borderRadius:5, background:'none', color:C.muted, border:'1px solid #e2e8f0', cursor:'pointer' }}>
                          X
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setActivarId(item.id); setActivarSt('pending') }}
                        style={{ fontSize:11, padding:'3px 10px', borderRadius:5, background:'#f1f5f9', color:'#475569', border:'1px solid #cbd5e1', cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}>
                        Activar
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── List view ── */}
      {modo === 'list' && f.length > 0 && (
        <div style={{ background:C.card, borderRadius:10, border:`1px solid ${C.border}`, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 90px 110px 110px 80px 60px', padding:'8px 14px', borderBottom:`1px solid ${C.border}`, fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase' }}>
            <span>Tema</span><span>Área</span><span>Estado</span><span>Responsable</span><span>Prioridad</span><span>Fecha fin</span>
          </div>
          {f.map(item => {
            const cat = CATS.find(c => c.id === item.category)
            const st  = ST.find(s => s.id === item.status)
            const ov  = item.fechaFin && item.status !== 'done' && diasRestantes(fdStr(item.fechaFin)) < 0
            const oc  = ownerColor(item.propietario)
            const pc  = priColor(item.prioridad)
            return (
              <div key={item.id} onClick={() => setItem(item)}
                style={{ display:'grid', gridTemplateColumns:'2fr 90px 110px 110px 80px 60px', padding:'9px 14px', borderBottom:`1px solid ${C.border}`, cursor:'pointer', alignItems:'center', fontSize:12 }}
                onMouseEnter={e => e.currentTarget.style.background=C.surface}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, overflow:'hidden' }}>
                  <div style={{ width:3, height:18, borderRadius:2, background:ov?'#dc2626':cat?.color||C.muted, flexShrink:0 }} />
                  <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:C.text }}>{item.tema}</span>
                </div>
                <Tag id={item.category} type="cat" />
                <Tag id={item.status}   type="st" />
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <div style={{ width:16, height:16, borderRadius:'50%', background:oc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, fontWeight:700, color:'#fff' }}>{iniciales(item.propietario)}</div>
                  <span style={{ fontSize:11, color:C.muted }}>{(item.propietario||'').split(' ')[0]||'—'}</span>
                </div>
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 5px', borderRadius:3, background:pc.bg, color:pc.color, width:'fit-content' }}>{item.prioridad||'—'}</span>
                <span style={{ fontSize:11, color:ov?'#f43f5e':C.muted, fontWeight:ov?700:400 }}>
                  {item.fechaFin ? fmtFecha(fdStr(item.fechaFin)) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
const MARIA_NORM = norm('maria garcia')
const JUAN_NORM  = norm('juan rodriguez peisel')
const FRAN_NORM  = norm('francisco toledo')

const Dashboard = ({ allItems }) => {
  const [dashOwn, setDashOwn] = useState(() => localStorage.getItem('obs-dash-own') || 'team')
  const [dashCat, setDashCat] = useState(() => localStorage.getItem('obs-dash-cat') || 'all')
  const w = useW()
  const kpiCols = w >= 1100 ? 'repeat(6,1fr)' : w >= 600 ? 'repeat(3,1fr)' : 'repeat(2,1fr)'

  const setOwn = v => { setDashOwn(v); localStorage.setItem('obs-dash-own', v) }
  const setCat = v => { setDashCat(v); localStorage.setItem('obs-dash-cat', v) }

  const items = allItems.filter(i => {
    const p = norm(i.propietario)
    const ownerOk =
      dashOwn === 'juan'      ? p === JUAN_NORM :
      dashOwn === 'francisco' ? p === FRAN_NORM :
      p !== MARIA_NORM
    const catOk = dashCat === 'all' || i.category === dashCat
    return ownerOk && catOk
  })

  // Team bar always shows Juan vs Francisco (ignores dashOwn filter)
  const teamItems  = allItems.filter(i => norm(i.propietario) !== MARIA_NORM)
  const teamOwners = [
    { key:'juan',      name:'Juan',      full:'juan rodriguez peisel', color:'#60a5fa' },
    { key:'francisco', name:'Francisco', full:'francisco toledo',       color:'#a78bfa' },
  ]

  const bySt   = ST.map(s  => ({ name:s.label,  v:items.filter(i=>i.status===s.id).length,      color:s.color }))
  const byCat  = CATS.map(c => ({ name:c.label,  value:items.filter(i=>i.category===c.id).length, color:c.color }))
  const vencidas = items.filter(i => i.fechaFin && i.status !== 'done' && diasRestantes(fdStr(i.fechaFin)) < 0)

  const kpis = [
    { l:'Total',         v:items.length,                                             c:C.accent },
    { l:'En Curso',      v:items.filter(i=>i.status==='inprogress').length,          c:'#818cf8' },
    { l:'Bloqueados',    v:items.filter(i=>i.status==='blocked').length,             c:'#f43f5e' },
    { l:'Riesgo 🔴',     v:items.filter(i=>i.risk==='red'&&i.status!=='done').length, c:'#f43f5e' },
    { l:'Vencidas ⚠️',  v:vencidas.length,                                           c:'#fbbf24' },
    { l:'Completados ✓', v:items.filter(i=>i.status==='done').length,                c:'#34d399' },
  ]

  const tt = { contentStyle:{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, fontSize:12, color:C.text } }

  const ownerTabs = [
    { v:'team',      l:'👥 Equipo', hint:'Juan · Francisco' },
    { v:'juan',      l:'Juan',      hint:'' },
    { v:'francisco', l:'Francisco', hint:'' },
  ]

  return (
    <div style={{ paddingTop:16 }}>
      {/* Team filter */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:18, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.07em' }}>Ver:</span>
        {ownerTabs.map(t => {
          const on  = dashOwn === t.v
          const col = t.v==='juan'?'#60a5fa':t.v==='francisco'?'#a78bfa':C.accent
          return (
            <button key={t.v} onClick={() => setOwn(t.v)}
              style={{ padding:'5px 14px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer',
                border:`1.5px solid ${on?col:C.border}`, background:on?col+'22':C.card, color:on?col:C.muted }}>
              {t.l}{t.hint && <span style={{ fontSize:10, opacity:.6, marginLeft:4 }}>{t.hint}</span>}
            </button>
          )
        })}
      </div>

      {/* Category filter */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:18, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.07em' }}>Área:</span>
        {[{ id:'all', label:'Todas', color:C.muted }, ...CATS].map(c => {
          const on = dashCat === c.id
          return (
            <button key={c.id} onClick={() => setCat(c.id)}
              style={{ padding:'4px 12px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer',
                border:`1.5px solid ${on?(c.color||C.accent):C.border}`, background:on?(c.color||C.accent)+'22':C.card, color:on?(c.color||C.accent):C.muted }}>
              {c.label}
            </button>
          )
        })}
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:kpiCols, gap:10, marginBottom:18 }}>
        {kpis.map((k,i) => (
          <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:28, fontWeight:700, color:k.c, lineHeight:1 }}>{k.v}</div>
            <div style={{ fontSize:10, color:C.muted, marginTop:5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em' }}>{k.l}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display:'grid', gridTemplateColumns: w < 768 ? '1fr' : '1fr 1fr', gap:14, marginBottom:14 }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:18 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:14 }}>
            Carga del equipo (Juan · Francisco)
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={teamOwners.map(o => ({
              name:       o.name,
              Total:      teamItems.filter(i=>norm(i.propietario)===norm(o.full)).length,
              'En Curso': teamItems.filter(i=>norm(i.propietario)===norm(o.full)&&i.status==='inprogress').length,
              Bloqueados: teamItems.filter(i=>norm(i.propietario)===norm(o.full)&&i.status==='blocked').length,
              color:      o.color,
            }))} barSize={18}>
              <XAxis dataKey="name" tick={{ fill:C.muted, fontSize:12, fontWeight:600 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:C.muted, fontSize:10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...tt} />
              <Legend wrapperStyle={{ fontSize:11, color:C.muted }} />
              <Bar dataKey="Total"      name="Total"      radius={[4,4,0,0]}>
                {teamOwners.map((o,i) => <Cell key={i} fill={o.color+'66'} />)}
              </Bar>
              <Bar dataKey="En Curso"   name="En Curso"   radius={[4,4,0,0]}>
                {teamOwners.map((o,i) => <Cell key={i} fill={o.color} />)}
              </Bar>
              <Bar dataKey="Bloqueados" name="Bloqueados" radius={[4,4,0,0]}>
                {teamOwners.map(() => <Cell fill="#f43f5e" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:18 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:14 }}>Por área</div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={byCat} cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={3} dataKey="value">
                {byCat.map((e,i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip {...tt} />
              <Legend wrapperStyle={{ fontSize:11, color:C.muted }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:18, marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:14 }}>Pipeline por estado</div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={bySt} layout="vertical" barSize={20}>
            <XAxis type="number" tick={{ fill:C.muted, fontSize:10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={88} tick={{ fill:C.muted, fontSize:11 }} axisLine={false} tickLine={false} />
            <Tooltip {...tt} />
            <Bar dataKey="v" name="Temas" radius={[0,4,4,0]}>{bySt.map((e,i) => <Cell key={i} fill={e.color} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {vencidas.length > 0 && (
        <div style={{ background:'#f43f5e11', border:'1px solid #f43f5e33', borderRadius:10, padding:16 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#f43f5e', marginBottom:10 }}>⚠️ Temas vencidos ({vencidas.length})</div>
          {vencidas.map(item => (
            <div key={item.id} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6, flexWrap:'wrap' }}>
              <Tag id={item.category} type="cat" />
              <span style={{ flex:1, fontSize:13, color:C.text }}>{item.tema}</span>
              <span style={{ fontSize:11, color:'#f43f5e', fontWeight:700 }}>
                {Math.abs(diasRestantes(fdStr(item.fechaFin)))}d vencida
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Campañas CVM ──────────────────────────────────────────────────────────────
const CampanasCVM = ({ campanas }) => {
  const [filt,    setFilt]    = useState(() => localStorage.getItem('obs-camp-filt') || 'all')
  const [detalle, setDetalle] = useState(null)
  const [w, setW]             = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  const isMobile = w < 768

  useEffect(() => {
    const h = () => setW(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const setF = v => { setFilt(v); localStorage.setItem('obs-camp-filt', v) }

  const ESTADOS = ['all','Planificado','Enviado','Cancelado']
  const filtered = campanas.filter(c => filt === 'all' || norm(c.estado) === norm(filt))

  if (campanas.length === 0) return (
    <div style={{ paddingTop:isMobile?12:24, maxWidth:isMobile?'100%':600 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:isMobile?20:32, textAlign:'center' }}>
        <div style={{ fontSize:isMobile?32:36, marginBottom:isMobile?10:12 }}>📅</div>
        <h3 style={{ fontSize:isMobile?14:15, fontWeight:700, color:C.text, marginBottom:6 }}>Todavía no hay campañas CVM</h3>
        <p style={{ fontSize:isMobile?12:13, color:C.muted, lineHeight:1.6, marginBottom:16 }}>
          Añade una pestaña al Google Sheet llamada <b style={{ color:C.text }}>Campañas CVM</b> con estas columnas:
        </p>
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:isMobile?10:14,
          fontFamily:'monospace', fontSize:isMobile?11:12, color:C.muted, textAlign:'left', lineHeight:1.8, overflowX:'auto' }}>
          Fecha | PYNAME | Tipo | Audiencia | Volumen | Copy | Canal | Estado
        </div>
        <p style={{ fontSize:isMobile?10:11, color:C.muted, marginTop:10, lineHeight:1.6 }}>
          <b>Tipo:</b> Oferta One Shot / Reminder / BAU &nbsp;·&nbsp;
          <b>Canal:</b> SMS / Push / Email &nbsp;·&nbsp;
          <b>Estado:</b> Planificado / Enviado / Cancelado
        </p>
      </div>
    </div>
  )

  // Group by fecha
  const groups = {}
  for (const c of filtered) {
    const k = c.fecha || 'Sin fecha'
    if (!groups[k]) groups[k] = []
    groups[k].push(c)
  }

  const volTotal = campanas
    .map(c => parseInt((c.volumen || '').replace(/[^\d]/g, '')) || 0)
    .reduce((a, b) => a + b, 0)

  return (
    <div style={{ paddingTop:16 }}>
      {/* Filter bar */}
      <div style={{ display:'flex', alignItems:'center', gap:isMobile?6:8, marginBottom:18, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:isMobile?4:6, flexWrap:'wrap' }}>
          {ESTADOS.map(e => {
            const on  = (e==='all'&&filt==='all') || norm(e)===norm(filt)
            const col = e==='all' ? C.muted : estadoCColor(e)
            const cnt = e==='all' ? campanas.length : campanas.filter(c=>norm(c.estado)===norm(e)).length
            return (
              <button key={e} onClick={() => setF(e)}
                style={{ padding:isMobile?'3px 10px':'4px 12px', borderRadius:20, fontSize:isMobile?11:12, fontWeight:600, cursor:'pointer',
                  border:`1.5px solid ${on?col:C.border}`, background:on?col+'22':C.card, color:on?col:C.muted, whiteSpace:'nowrap' }}>
                {e==='all'?'Todas':e} <span style={{ opacity:.65 }}>{cnt}</span>
              </button>
            )
          })}
        </div>
        {!isMobile && <div style={{ marginLeft:'auto', display:'flex', gap:16, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:C.muted }}><b style={{ color:C.text }}>{campanas.length}</b> campañas</span>
          <span style={{ fontSize:11, color:C.muted }}><b style={{ color:'#34d399' }}>{campanas.filter(c=>norm(c.estado)==='enviado').length}</b> enviadas</span>
          {volTotal > 0 && <span style={{ fontSize:11, color:C.muted }}><b style={{ color:'#06b6d4' }}>{(volTotal/1000).toFixed(0)}k</b> líneas</span>}
        </div>}
      </div>

      {/* Campaign groups */}
      {filtered.length === 0
        ? <div style={{ textAlign:'center', color:C.muted, padding:isMobile?30:40 }}>Sin campañas con este filtro</div>
        : Object.entries(groups).map(([fecha, list]) => (
          <div key={fecha} style={{ marginBottom:isMobile?16:24 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap' }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:'#06b6d4', flexShrink:0 }} />
              <span style={{ fontSize:isMobile?12:13, fontWeight:700, color:C.text }}>{fecha}</span>
              <span style={{ fontSize:isMobile?9:10, color:'#06b6d4', background:'#06b6d422', borderRadius:10, padding:isMobile?'1px 6px':'1px 8px', fontWeight:700 }}>
                {list.length} campaña{list.length!==1?'s':''}
              </span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(280px,1fr))', gap:isMobile?8:10 }}>
              {list.map(c => {
                const tc = tipoColor(c.tipo)
                const ec = estadoCColor(c.estado)
                return (
                  <div key={c.id} onClick={() => setDetalle(c)}
                    style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${tc}`, borderRadius:8, padding:isMobile?10:14, cursor:'pointer' }}
                    onMouseEnter={!isMobile ? (e => e.currentTarget.style.borderColor=tc) : undefined}
                    onMouseLeave={!isMobile ? (e => e.currentTarget.style.borderColor=C.border) : undefined}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:6, marginBottom:6 }}>
                      <span style={{ fontSize:isMobile?11:12, fontWeight:700, color:C.text, fontFamily:'monospace', flex:1, lineHeight:1.3, wordBreak:'break-word' }}>{c.pyname}</span>
                      <span style={{ fontSize:isMobile?9:10, fontWeight:700, padding:isMobile?'1px 5px':'2px 7px', borderRadius:4, background:ec+'22', color:ec, flexShrink:0 }}>{c.estado}</span>
                    </div>
                    <div style={{ display:'flex', gap:4, marginBottom:6, flexWrap:'wrap', alignItems:'center' }}>
                      {c.tipo && <span style={{ fontSize:isMobile?9:10, fontWeight:700, padding:isMobile?'1px 5px':'2px 7px', borderRadius:3, background:tc+'22', color:tc }}>{c.tipo}</span>}
                      {c.canal && <span style={{ fontSize:isMobile?9:10, color:C.muted, background:C.surface, padding:isMobile?'1px 5px':'2px 6px', borderRadius:3, border:`1px solid ${C.border}` }}>{c.canal}</span>}
                      {c.volumen && <span style={{ fontSize:isMobile?9:10, fontWeight:700, color:'#06b6d4' }}>👥 {c.volumen}</span>}
                    </div>
                    {c.audiencia && <p style={{ fontSize:isMobile?10:11, color:C.muted, lineHeight:1.4, marginBottom:3, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{c.audiencia}</p>}
                    {c.copy && <p style={{ fontSize:isMobile?10:11, color:C.muted, fontStyle:'italic', lineHeight:1.4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>"{c.copy.slice(0,90)}{c.copy.length>90?'…':''}"</p>}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      }

      {/* Campaign detail modal */}
      {detalle && (
        <div style={{ position:'fixed', inset:0, background:'#00000099', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:isMobile?12:16 }}
          onClick={e => e.target===e.currentTarget&&setDetalle(null)}>
          <div style={{ background:C.surface, borderRadius:12, border:`1px solid ${C.border}`, width:'100%', maxWidth:isMobile?'100%':560, maxHeight:isMobile?'90vh':'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:isMobile?'10px 14px':'14px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:3, height:20, borderRadius:2, background:tipoColor(detalle.tipo), flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:isMobile?10:11, color:C.muted }}>{detalle.fecha}{detalle.tipo?` · ${detalle.tipo}`:''}</div>
                <h3 style={{ fontSize:isMobile?13:14, fontWeight:700, color:C.text, fontFamily:'monospace', marginTop:2, marginBottom:0 }}>{detalle.pyname}</h3>
              </div>
              <span style={{ fontSize:isMobile?10:11, fontWeight:700, padding:isMobile?'2px 7px':'3px 9px', borderRadius:4, background:estadoCColor(detalle.estado)+'22', color:estadoCColor(detalle.estado), flexShrink:0 }}>{detalle.estado}</span>
              <button onClick={() => setDetalle(null)} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:18, padding:0 }}>✕</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:isMobile?12:18, display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:isMobile?10:14 }}>
              <div><Lbl>Canal</Lbl><span style={{ fontSize:isMobile?12:13, color:C.text }}>{detalle.canal||'—'}</span></div>
              <div><Lbl>Volumen</Lbl><span style={{ fontSize:isMobile?16:18, fontWeight:700, color:'#06b6d4' }}>{detalle.volumen||'—'}</span></div>
              <div style={{ gridColumn:'1/-1' }}>
                <Lbl>Audiencia</Lbl>
                <p style={{ fontSize:isMobile?12:13, color:C.text, lineHeight:1.6, background:C.card, borderRadius:6, padding:isMobile?8:10, marginBottom:0 }}>{detalle.audiencia||'—'}</p>
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <Lbl>Copy</Lbl>
                <div style={{ fontSize:isMobile?11:12, color:C.muted, lineHeight:1.6, background:C.card, borderRadius:8, padding:isMobile?10:12, maxHeight:200, overflowY:'auto', borderLeft:`3px solid #06b6d4`, whiteSpace:'pre-wrap', fontStyle:'italic' }}>
                  {detalle.copy||'—'}
                </div>
              </div>
            </div>
            <div style={{ padding:isMobile?'8px 14px':'10px 18px', borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'flex-end' }}>
              <Btn v="sec" onClick={() => setDetalle(null)}>Cerrar</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── GanttChart ────────────────────────────────────────────────────────────────
const GanttChart = ({ temas }) => {
  const withDates = temas.filter(t => t.fechaFin)
  if (withDates.length === 0) return (
    <div style={{ padding:'36px 0', textAlign:'center', color:C.muted, fontSize:12 }}>
      Ningún tema tiene fecha fin asignada.<br />
      <span style={{ fontSize:11, opacity:.6 }}>Añade fechas en las tarjetas para ver el Gantt.</span>
    </div>
  )

  const allTs = []
  withDates.forEach(t => {
    if (t.fechaInicio) allTs.push(new Date(fdStr(t.fechaInicio) + 'T12:00').getTime())
    allTs.push(new Date(fdStr(t.fechaFin) + 'T12:00').getTime())
  })
  const minTs  = Math.min(...allTs) - 8 * 86400000
  const maxTs  = Math.max(...allTs) + 8 * 86400000
  const span   = maxTs - minTs
  const toPct  = d => Math.max(0, Math.min(100, (new Date(d + 'T12:00').getTime() - minTs) / span * 100))
  const todayP = Math.max(0, Math.min(100, (Date.now() - minTs) / span * 100))

  // Month ticks
  const ticks = []
  const tickD = new Date(minTs); tickD.setDate(1); tickD.setHours(12)
  while (tickD.getTime() <= maxTs) { ticks.push(new Date(tickD)); tickD.setMonth(tickD.getMonth() + 1) }

  return (
    <div style={{ padding:'4px 0 16px', overflowX:'auto' }}>
      <div style={{ minWidth:480 }}>
        {/* Month header */}
        <div style={{ marginLeft:172, position:'relative', height:22, marginBottom:6 }}>
          {ticks.map((t, i) => (
            <span key={i} style={{ position:'absolute', left:`${(t.getTime()-minTs)/span*100}%`, fontSize:9, color:C.muted, transform:'translateX(-50%)', whiteSpace:'nowrap', fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase' }}>
              {t.toLocaleDateString('es-ES',{month:'short', year:'2-digit'})}
            </span>
          ))}
          {todayP >= 0 && todayP <= 100 && (
            <span style={{ position:'absolute', left:`${todayP}%`, fontSize:10, color:'#e8243b', transform:'translateX(-50%)', fontWeight:700 }}>▼</span>
          )}
        </div>

        {/* Rows */}
        {withDates.map((t, i) => {
          const st      = ST.find(s => s.id === t.status) || ST[0]
          const startP  = t.fechaInicio ? toPct(fdStr(t.fechaInicio)) : toPct(fdStr(t.fechaFin)) - 2
          const endP    = toPct(fdStr(t.fechaFin))
          const widthP  = Math.max(endP - startP, 1.5)
          const isLate  = t.status !== 'done' && diasRestantes(fdStr(t.fechaFin)) < 0
          const barCol  = isLate ? '#f43f5e' : st.color
          return (
            <div key={t.id} style={{ display:'flex', alignItems:'center', height:30, marginBottom:4 }}>
              <div style={{ width:168, flexShrink:0, paddingRight:10 }}>
                <span style={{ fontSize:11, color:t.status==='done'?C.muted:C.text, display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textDecoration:t.status==='done'?'line-through':'none' }}>{t.tema}</span>
              </div>
              <div style={{ flex:1, position:'relative', height:22, borderRadius:3, background:i%2===0?'rgba(0,0,0,.025)':'transparent' }}>
                {ticks.map((tk, ti) => (
                  <div key={ti} style={{ position:'absolute', left:`${(tk.getTime()-minTs)/span*100}%`, top:0, bottom:0, width:1, background:C.border+'66' }} />
                ))}
                {todayP >= 0 && todayP <= 100 && (
                  <div style={{ position:'absolute', left:`${todayP}%`, top:0, bottom:0, width:1.5, background:'#e8243b', zIndex:2 }} />
                )}
                <div style={{
                  position:'absolute', left:`${startP}%`, width:`${widthP}%`,
                  top:4, height:14, borderRadius:4,
                  background:barCol+'40', border:`1.5px solid ${barCol}90`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  overflow:'hidden', minWidth:5,
                  transition:'all 400ms cubic-bezier(0.23,1,0.32,1)',
                }}>
                  {widthP > 12 && <span style={{ fontSize:8, color:barCol, fontWeight:700, whiteSpace:'nowrap', padding:'0 4px' }}>{fmtFecha(fdStr(t.fechaFin))}</span>}
                </div>
              </div>
            </div>
          )
        })}

        {/* Legend */}
        <div style={{ marginLeft:172, marginTop:12, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <span style={{ display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ width:14, height:1.5, background:'#e8243b' }} />
            <span style={{ fontSize:9, color:C.muted }}>Hoy</span>
          </span>
          {ST.map(s => (
            <span key={s.id} style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:14, height:10, borderRadius:2, background:s.color+'40', border:`1.5px solid ${s.color}90` }} />
              <span style={{ fontSize:9, color:C.muted }}>{s.label}</span>
            </span>
          ))}
          <span style={{ display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ width:14, height:10, borderRadius:2, background:'#f43f5e40', border:`1.5px solid #f43f5e90` }} />
            <span style={{ fontSize:9, color:C.muted }}>Vencido</span>
          </span>
        </div>
      </div>
    </div>
  )
}

// ── ModalProyecto ─────────────────────────────────────────────────────────────
const ModalProyecto = ({ proyecto: proyectoOrig, allItems, onClose, onAddTema, onOpenItem, onUpdate, lang='es' }) => {
  const [proyecto,     setProyecto]     = useState(proyectoOrig)
  const [tab,          setTab]          = useState('temas')
  const [nc,           setNc]           = useState('')
  const [comments,     setComments]     = useState(() => getProjectComments(norm(proyectoOrig.nombre)))
  const [showAddTema,  setShowAddTema]  = useState(false)
  const [newTema,      setNewTema]      = useState('')
  const [newTemaObj,   setNewTemaObj]   = useState('')
  const [newTemaCat,   setNewTemaCat]   = useState('projects')
  const [newTemaProp,  setNewTemaProp]  = useState(proyectoOrig.propietario || '')
  const [editing,      setEditing]      = useState(false)
  const [editDesc,     setEditDesc]     = useState(proyectoOrig.descripcion || '')
  const [editProp,     setEditProp]     = useState(proyectoOrig.propietario || '')
  const [editIni,      setEditIni]      = useState(proyectoOrig.fechaInicio ? fdStr(proyectoOrig.fechaInicio) : '')
  const [editFin,      setEditFin]      = useState(proyectoOrig.fechaFin ? fdStr(proyectoOrig.fechaFin) : '')
  const [editPrio,     setEditPrio]     = useState(proyectoOrig.prioridad || '')
  const [editStatus,     setEditStatus]     = useState(proyectoOrig.status || 'pending')
  const [editDesarrollo, setEditDesarrollo] = useState(proyectoOrig.desarrollo || '')
  const [editFase,       setEditFase]       = useState(proyectoOrig.fase || '')
  const [editCapex,      setEditCapex]      = useState(proyectoOrig.capex!=null?String(proyectoOrig.capex):'')
  const [editNombreEN,   setEditNombreEN]   = useState(proyectoOrig.nombreEN || '')

  useEffect(() => {
    const h = e => e.key === 'Escape' && (editing ? setEditing(false) : onClose())
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [editing])

  const guardarEdicion = () => {
    const flds = { descripcion:editDesc.trim(), propietario:editProp.trim(), fechaInicio:editIni||null, fechaFin:editFin||null, prioridad:editPrio, status:editStatus,
      desarrollo:editDesarrollo.trim(), fase:editFase, capex:editCapex?parseFloat(editCapex)||null:null, nombreEN:editNombreEN.trim() }
    saveProyOverride(proyecto.nombre, flds)
    const updated = { ...proyecto, ...flds, _hasLocalProy:true }
    setProyecto(updated)
    onUpdate?.(proyecto.nombre, flds)
    setEditing(false)
  }

  const temas   = allItems.filter(i => norm(i.proyecto || '') === norm(proyecto.nombre))
  const done    = temas.filter(t => t.status === 'done').length
  const blocked = temas.filter(t => t.status === 'blocked').length
  const pct     = temas.length > 0 ? Math.round(done / temas.length * 100) : 0
  const oc      = ownerColor(proyecto.propietario)

  const agregarComentario = () => {
    const text = nc.trim()
    if (!text) return
    const c = saveProjectComment(norm(proyecto.nombre), text)
    setComments(prev => [c, ...prev])
    setNc('')
  }

  const crearTema = () => {
    if (!newTema.trim()) return
    onAddTema({
      id: uid(), tema: newTema.trim(), objetivo: newTemaObj.trim(),
      category: newTemaCat, propietario: newTemaProp.trim(),
      prioridad: '', risk: 'green', status: 'pending',
      estadoSheet: 'No iniciado', fechaInicio: null,
      fechaFin: proyecto.fechaFin || null,
      proyecto: proyecto.nombre, archivos: '',
      notas: 'Creado desde panel de proyecto', subtareas: [], _local: true,
    })
    setNewTema(''); setNewTemaObj(''); setShowAddTema(false)
  }

  const TABS = [
    { id:'temas',  l:`Temas (${temas.length})` },
    { id:'gantt',  l:'Gantt' },
    { id:'notas',  l:`Notas${comments.length > 0 ? ` (${comments.length})` : ''}` },
  ]

  const inputSt = { background:C.card, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' }

  return (
    <div style={{ position:'fixed', inset:0, background:'#00000099', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget&&onClose()}>
      <style>{`
        @keyframes modalProjIn{from{opacity:0;transform:scale(0.96) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes rowIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .modal-tab-btn{transition:color 150ms ease-out,border-color 150ms ease-out!important}
        .add-tema-btn{transition:border-color 150ms ease-out,color 150ms ease-out!important}
        .add-tema-btn:hover{border-color:#e8243b!important;color:#e8243b!important}
      `}</style>
      <div style={{
        background:C.surface, borderRadius:14, border:`1px solid ${C.border}`,
        width:'100%', maxWidth:800, maxHeight:'91vh', overflow:'hidden',
        display:'flex', flexDirection:'column',
        animation:'modalProjIn 220ms cubic-bezier(0.23,1,0.32,1) both',
        boxShadow:'0 8px 40px rgba(0,0,0,.15)',
      }}>
        {/* Header */}
        <div style={{ padding:'16px 20px 14px', borderBottom:`1px solid ${C.border}`, background:C.card }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5, flexWrap:'wrap' }}>
                <span style={{ fontSize:16, fontWeight:700, color:C.text, lineHeight:1.2 }}>{proyecto.nombre}</span>
                {!editing && <Tag id={proyecto.status} type="st" />}
                {!editing && proyecto.prioridad && (() => { const pc=priColor(proyecto.prioridad); return <span style={{ fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:3, background:pc.bg, color:pc.color }}>{proyecto.prioridad}</span> })()}
                {proyecto._hasLocalProy && <span style={{ fontSize:9, color:'#fbbf24', background:'#fbbf2411', border:'1px solid #fbbf2433', padding:'1px 5px', borderRadius:3, fontWeight:700 }}>~local</span>}
                {!editing && proyecto.desarrollo && (() => { const vf=norm(proyecto.desarrollo)==='vodafone'; return <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:vf?'#e8001c18':'#1a5fe318', color:vf?'#b30016':'#1244a8' }}>{proyecto.desarrollo}</span> })()}
              </div>
              {!editing && (proyecto.descripcion
                ? <p style={{ fontSize:12, color:C.muted, lineHeight:1.6, margin:'4px 0 0' }}>{proyecto.descripcion}</p>
                : <p style={{ fontSize:12, color:C.border, lineHeight:1.6, margin:'4px 0 0', fontStyle:'italic' }}>Sin descripción</p>)}
              {!editing && proyecto.fase && (() => {
                const curPct = fasePct(proyecto.fase)
                return (
                  <div style={{ marginTop:8 }}>
                    <div style={{ display:'flex', gap:2, marginBottom:3 }}>
                      {FASES.map(f => {
                        const active = norm(f.id)===norm(proyecto.fase)
                        const done   = f.pct <= curPct
                        return (
                          <div key={f.id} style={{ flex:1 }}>
                            <div style={{ height:4, borderRadius:2, background:active?C.accent:done?C.accent+'55':C.border, marginBottom:2 }} />
                            <span style={{ fontSize:8, color:active?C.accent:C.muted, fontWeight:active?700:400, whiteSpace:'nowrap' }}>{lang==='en'?f.labelEN:f.label}</span>
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ fontSize:10, color:C.muted, textAlign:'right', marginTop:2 }}>Avance estimado: <strong style={{ color:C.accent }}>{curPct}%</strong></div>
                  </div>
                )
              })()}
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
              {!editing
                ? <button onClick={() => setEditing(true)} style={{ background:C.surface, border:`1px solid ${C.border}`, color:C.muted, borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>Editar</button>
                : <>
                    <button onClick={guardarEdicion} style={{ background:C.accent, border:'none', color:'#fff', borderRadius:6, padding:'4px 12px', fontSize:11, fontWeight:600, cursor:'pointer' }}>Guardar</button>
                    <button onClick={() => setEditing(false)} style={{ background:'none', border:`1px solid ${C.border}`, color:C.muted, borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer' }}>Cancelar</button>
                  </>}
              <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:20, padding:0, lineHeight:1 }}>✕</button>
            </div>
          </div>

          {/* Edit form */}
          {editing && (() => {
            const iSt = { background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 9px', fontSize:12, outline:'none', width:'100%', boxSizing:'border-box' }
            return (
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:8 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Descripción</div>
                  <textarea value={editDesc} onChange={e=>setEditDesc(e.target.value)} rows={2} placeholder="Descripción del proyecto…" style={{ ...iSt, resize:'vertical', fontFamily:'inherit' }} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8 }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Desarrollo</div>
                    <select value={editDesarrollo} onChange={e=>setEditDesarrollo(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                      <option value="">—</option>
                      <option value="Vodafone">Vodafone</option>
                      <option value="Sercom">Sercom</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Fase</div>
                    <select value={editFase} onChange={e=>setEditFase(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                      <option value="">—</option>
                      <option value="TO DO">TO DO</option>
                      {FASES.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>CAPEX (€)</div>
                    <input type="number" value={editCapex} onChange={e=>setEditCapex(e.target.value)} style={iSt} placeholder="0" min="0" step="1000" />
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Nombre EN</div>
                    <input value={editNombreEN} onChange={e=>setEditNombreEN(e.target.value)} style={iSt} placeholder="English name…" />
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8 }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Responsable</div>
                    <input list="owners-proy-edit" value={editProp} onChange={e=>setEditProp(e.target.value)} style={iSt} placeholder="Nombre…" />
                    <datalist id="owners-proy-edit">{KNOWN_OWNERS.map(o=><option key={o} value={o}/>)}</datalist>
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Estado</div>
                    <select value={editStatus} onChange={e=>setEditStatus(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                      {ST.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Prioridad</div>
                    <select value={editPrio} onChange={e=>setEditPrio(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                      <option value="">Sin prioridad</option>
                      {PRIORIDADES.filter(Boolean).map(p=><option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Fecha inicio</div>
                    <input type="date" value={editIni} onChange={e=>setEditIni(e.target.value)} style={{ ...iSt, colorScheme:'light' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Fecha fin</div>
                    <input type="date" value={editFin} onChange={e=>setEditFin(e.target.value)} style={{ ...iSt, colorScheme:'light' }} />
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Meta row */}
          {!editing && (
          <div style={{ display:'flex', alignItems:'center', gap:14, marginTop:10, flexWrap:'wrap' }}>
            {proyecto.propietario && (
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ width:20, height:20, borderRadius:'50%', background:oc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, fontWeight:700, color:'#fff' }}>{iniciales(proyecto.propietario)}</div>
                <span style={{ fontSize:12, color:C.muted }}>{proyecto.propietario.split(' ')[0]}</span>
              </div>
            )}
            {proyecto.fechaInicio && <span style={{ fontSize:11, color:C.muted }}>Inicio: {fmtFecha(fdStr(proyecto.fechaInicio))}</span>}
            {proyecto.fechaFin && <span style={{ fontSize:11, color:C.muted }}>Fin: <AlertFecha endDate={proyecto.fechaFin} status={proyecto.status} /></span>}
            {proyecto.capex!=null && <span style={{ fontSize:11, color:C.muted }}>CAPEX: <strong style={{ color:C.text }}>{Number(proyecto.capex).toLocaleString('es')} €</strong></span>}
            {lang==='en' && proyecto.nombreEN && <span style={{ fontSize:10, color:C.muted, fontStyle:'italic' }}>{proyecto.nombreEN}</span>}
            <span style={{ fontSize:11, color:C.muted, marginLeft:'auto' }}>
              {temas.length} tema{temas.length!==1?'s':''} · {done} completado{done!==1?'s':''}
              {blocked>0&&<span style={{ color:'#f43f5e' }}> · {blocked} bloq.</span>}
            </span>
          </div>
          )}

          {/* Progress bar */}
          {temas.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <div style={{ display:'flex', gap:8 }}>
                  {ST.map(s => { const n=temas.filter(t=>t.status===s.id).length; return n?<span key={s.id} style={{ fontSize:9, color:s.color, fontWeight:600 }}>{n} {s.label}</span>:null })}
                </div>
                <span style={{ fontSize:10, fontWeight:700, color:C.accent }}>{pct}%</span>
              </div>
              <div style={{ height:5, background:C.bg, borderRadius:3, overflow:'hidden', display:'flex', gap:1 }}>
                {ST.map(s => { const n=temas.filter(t=>t.status===s.id).length; const w=temas.length>0?n/temas.length*100:0; return w>0?<div key={s.id} style={{ width:`${w}%`, background:s.color, transition:'width .5s cubic-bezier(0.23,1,0.32,1)' }}/>:null })}
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:`1px solid ${C.border}`, padding:'0 20px', background:C.surface }}>
          {TABS.map(t => {
            const on = tab === t.id
            return (
              <button key={t.id} className="modal-tab-btn" onClick={() => setTab(t.id)}
                style={{ padding:'10px 16px', background:'none', border:'none', borderBottom:`2px solid ${on?C.accent:'transparent'}`, fontSize:12, fontWeight:on?700:500, color:on?C.accent:C.muted, cursor:'pointer' }}>
                {t.l}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex:1, overflowY:'auto', padding:20 }}>

          {/* ── TEMAS ── */}
          {tab === 'temas' && (
            <div>
              {temas.length === 0 && !showAddTema && (
                <div style={{ textAlign:'center', color:C.muted, padding:'28px 0 20px', fontSize:13 }}>Sin temas vinculados todavía.</div>
              )}
              {temas.map((t, i) => {
                const st  = ST.find(s => s.id === t.status)
                const cat = CATS.find(c => c.id === t.category)
                return (
                  <div key={t.id}
                    onClick={() => onOpenItem?.(t)}
                    style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 12px', background:C.card, borderRadius:7, marginBottom:6, border:`1px solid ${C.border}`, borderLeft:`3px solid ${cat?.color||C.muted}`, animation:`rowIn 240ms cubic-bezier(0.23,1,0.32,1) ${i*35}ms both`, cursor:onOpenItem?'pointer':'default', transition:'background 120ms ease-out' }}
                    onMouseEnter={e => onOpenItem && (e.currentTarget.style.background=C.surface)}
                    onMouseLeave={e => onOpenItem && (e.currentTarget.style.background=C.card)}>
                    <Dot risk={t.risk} />
                    <span style={{ flex:1, fontSize:13, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.tema}</span>
                    <Tag id={t.category} type="cat" />
                    <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3, background:st?.color+'22', color:st?.color, flexShrink:0 }}>{st?.label}</span>
                    <span style={{ fontSize:10, color:C.muted, flexShrink:0, minWidth:36 }}>{(t.propietario||'').split(' ')[0]||'—'}</span>
                    {t.fechaFin && <AlertFecha endDate={t.fechaFin} status={t.status} />}
                    {onOpenItem && <span style={{ fontSize:10, color:C.muted, flexShrink:0 }}>↗</span>}
                  </div>
                )
              })}

              {/* Inline add form */}
              {showAddTema ? (
                <div style={{ background:C.card, border:`1px solid ${C.accent}55`, borderRadius:8, padding:14, marginTop:6 }}>
                  <input value={newTema} onChange={e=>setNewTema(e.target.value)} placeholder="Nombre del tema…" autoFocus
                    onKeyDown={e=>e.key==='Enter'&&crearTema()}
                    style={{ ...inputSt, marginBottom:8 }} />
                  <TA value={newTemaObj} onChange={setNewTemaObj} placeholder="Objetivo (opcional)…" rows={2} style={{ marginBottom:8 }} />
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
                    <div>
                      <Lbl>Categoría</Lbl>
                      <Sel value={newTemaCat} onChange={setNewTemaCat} opts={CATS.map(c=>({v:c.id,l:c.label}))} style={{ width:'100%' }} />
                    </div>
                    <div>
                      <Lbl>Propietario</Lbl>
                      <input list="owners-modal-proy" value={newTemaProp} onChange={e=>setNewTemaProp(e.target.value)} placeholder="Nombre…" style={inputSt} />
                      <datalist id="owners-modal-proy">{KNOWN_OWNERS.map(o=><option key={o} value={o}/>)}</datalist>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <Btn onClick={crearTema} disabled={!newTema.trim()} style={{ fontSize:12, padding:'6px 14px' }}>➕ Crear tema</Btn>
                    <Btn v="sec" onClick={() => { setShowAddTema(false); setNewTema(''); setNewTemaObj('') }} style={{ fontSize:12, padding:'6px 14px' }}>Cancelar</Btn>
                  </div>
                </div>
              ) : (
                <button className="add-tema-btn" onClick={() => setShowAddTema(true)}
                  style={{ display:'flex', alignItems:'center', gap:6, width:'100%', background:'transparent', border:`1.5px dashed ${C.border}`, borderRadius:7, padding:'9px 12px', cursor:'pointer', color:C.muted, fontSize:12, marginTop:8, outline:'none' }}>
                  ＋ Añadir tema al proyecto
                </button>
              )}
            </div>
          )}

          {/* ── GANTT ── */}
          {tab === 'gantt' && <GanttChart temas={temas} />}

          {/* ── NOTAS ── */}
          {tab === 'notas' && (
            <div>
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:18 }}>
                <TA value={nc} onChange={setNc} placeholder="Añade una nota o actualización del proyecto…" rows={3}
                  onKeyDown={e=>{ if(e.ctrlKey&&e.key==='Enter'){ agregarComentario(); e.preventDefault() } }} />
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <Btn onClick={agregarComentario} disabled={!nc.trim()} style={{ fontSize:12, padding:'6px 14px' }}>💬 Guardar nota</Btn>
                  <span style={{ fontSize:11, color:C.muted }}>Ctrl+Enter</span>
                </div>
              </div>
              {comments.length === 0
                ? <div style={{ textAlign:'center', color:C.muted, padding:'24px 0', fontSize:12 }}>Sin notas todavía.</div>
                : comments.map((c, i) => (
                  <div key={c.id} style={{ background:C.card, borderRadius:7, padding:'10px 14px', marginBottom:8, borderLeft:`3px solid ${C.accent}`, animation:`rowIn 200ms ease-out ${i*25}ms both` }}>
                    <div style={{ fontSize:10, color:C.accent, fontWeight:700, marginBottom:4 }}>[{c.ts}]</div>
                    <div style={{ fontSize:13, color:C.text, lineHeight:1.6, whiteSpace:'pre-wrap' }}>{c.text}</div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ProjectDetailView (Nueva vista detallada de proyecto) ──────────────────────
const ProjectDetailView = ({ proyecto, allItems, onClose, onSave }) => {
  const [tabActive, setTabActive] = useState('resumen')
  const [hitos, setHitos] = useState([])
  const [comentarios, setComentarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [newHitoName, setNewHitoName] = useState('')
  const [newHitoDate, setNewHitoDate] = useState('')
  const [newComment, setNewComment] = useState('')
  const [editando, setEditando] = useState(false)
  const [proyForm, setProyForm] = useState({ nombre: proyecto.nombre, descripcion: proyecto.descripcion, fechaInicio: fdStr(proyecto.fecha_inicio), fechaFin: fdStr(proyecto.fecha_fin) })

  const temas = allItems.filter(i => norm(i.proyecto||'') === norm(proyecto.nombre))
  const temasCompletados = temas.filter(t => t.status === 'done').length
  const temaBloqueados = temas.filter(t => t.status === 'blocked').length
  const pct = temas.length > 0 ? Math.round(temasCompletados / temas.length * 100) : 0

  // Cargar datos iniciales
  useEffect(() => {
    const cargar = async () => {
      try {
        const h = await fetchHitos(proyecto.id)
        const c = await fetchProyectoComments(proyecto.id)
        setHitos(h)
        setComentarios(c)
      } catch (e) {
        console.error('Error loading proyecto details:', e)
      } finally {
        setLoading(false)
      }
    }
    cargar()
  }, [proyecto.id])

  const agregarHito = async () => {
    if (!newHitoName.trim()) return
    try {
      const hito = await addHito(proyecto.id, newHitoName, newHitoDate || null)
      setHitos([...hitos, hito])
      setNewHitoName('')
      setNewHitoDate('')
    } catch (e) {
      console.error('Error adding hito:', e)
    }
  }

  const toggleHito = async (hito) => {
    try {
      await updateHito(hito.id, { completado: !hito.completado })
      setHitos(hitos.map(h => h.id === hito.id ? { ...h, completado: !h.completado } : h))
    } catch (e) {
      console.error('Error updating hito:', e)
    }
  }

  const eliminarHito = async (id) => {
    try {
      await deleteHito(id)
      setHitos(hitos.filter(h => h.id !== id))
    } catch (e) {
      console.error('Error deleting hito:', e)
    }
  }

  const agregarComentario = async () => {
    if (!newComment.trim()) return
    try {
      const comentario = await addProyectoComment(proyecto.id, newComment)
      setComentarios([comentario, ...comentarios])
      setNewComment('')
    } catch (e) {
      console.error('Error adding comment:', e)
    }
  }

  const guardarProyecto = async () => {
    try {
      await sbUpdateProyecto(proyecto.id, {
        nombre: proyForm.nombre,
        descripcion: proyForm.descripcion,
        fecha_inicio: proyForm.fechaInicio || null,
        fecha_fin: proyForm.fechaFin || null,
      })
      setEditando(false)
      onSave?.()
    } catch (e) {
      console.error('Error saving proyecto:', e)
    }
  }

  const moverAlBacklog = async () => {
    try {
      await sbUpdateProyecto(proyecto.id, { status: 'backlog' })
      onClose()
      onSave?.()
    } catch (e) {
      console.error('Error moving to backlog:', e)
    }
  }

  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:C.card, borderRadius:14, maxWidth:1200, width:'90%', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.3)' }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'20px 24px', borderBottom:`1px solid ${C.border}` }}>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:C.muted }}>←</button>
          <div style={{ flex:1 }}>
            <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>{proyecto.nombre}</h2>
            {proyecto.descripcion && <p style={{ fontSize:12, color:C.muted, margin:'4px 0 0', marginTop:4 }}>{proyecto.descripcion}</p>}
          </div>
          <button onClick={() => setEditando(!editando)} title="Editar proyecto" style={{ padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:600, border:`1px solid ${C.border}`, background:editando?C.accent+'22':C.card, color:editando?C.accent:C.text, cursor:'pointer' }}>
            ✎ {editando?'Cancelar':'Editar'}
          </button>
          <button onClick={moverAlBacklog} title="Mover al Backlog" style={{ padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:600, border:'1px solid #cbd5e1', background:'#f1f5f9', color:'#475569', cursor:'pointer' }}>
            ⊞ Backlog
          </button>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:C.muted }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:1, padding:'0 24px', borderBottom:`1px solid ${C.border}`, background:C.surface }}>
          {[
            { id:'resumen', label:'📋 Resumen', icon:'📋' },
            { id:'timeline', label:'🗓️ Timeline', icon:'🗓️' },
            { id:'temas', label:'✅ Temas', icon:'✅' },
            { id:'comentarios', label:'💬 Chat', icon:'💬' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setTabActive(tab.id)}
              style={{ padding:'12px 16px', fontSize:12, fontWeight:600, background:'none', border:'none', cursor:'pointer', borderBottom:`2px solid ${tabActive===tab.id?C.accent:'transparent'}`, color:tabActive===tab.id?C.accent:C.muted, transition:'all 150ms ease' }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
          {loading ? (
            <div style={{ textAlign:'center', color:C.muted, padding:'40px 0' }}>Cargando...</div>
          ) : (
            <>
              {/* TAB: RESUMEN */}
              {tabActive === 'resumen' && (
                <div>
                  {editando ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:20, padding:'16px', background:C.surface, borderRadius:8, border:`1px solid ${C.border}` }}>
                      <div>
                        <label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', display:'block', marginBottom:6 }}>Nombre</label>
                        <input type="text" value={proyForm.nombre} onChange={e => setProyForm({...proyForm, nombre:e.target.value})} style={{ width:'100%', padding:'8px 12px', border:`1px solid ${C.border}`, borderRadius:6, fontSize:12, background:C.card, color:C.text, outline:'none' }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', display:'block', marginBottom:6 }}>Descripción</label>
                        <textarea value={proyForm.descripcion} onChange={e => setProyForm({...proyForm, descripcion:e.target.value})} style={{ width:'100%', padding:'8px 12px', border:`1px solid ${C.border}`, borderRadius:6, fontSize:12, background:C.card, color:C.text, outline:'none', minHeight:80, fontFamily:'inherit', resize:'vertical' }} />
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                        <div>
                          <label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', display:'block', marginBottom:6 }}>Fecha Inicio</label>
                          <input type="date" value={proyForm.fechaInicio} onChange={e => setProyForm({...proyForm, fechaInicio:e.target.value})} style={{ width:'100%', padding:'8px 12px', border:`1px solid ${C.border}`, borderRadius:6, fontSize:12, background:C.card, color:C.text, outline:'none' }} />
                        </div>
                        <div>
                          <label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', display:'block', marginBottom:6 }}>Fecha Fin</label>
                          <input type="date" value={proyForm.fechaFin} onChange={e => setProyForm({...proyForm, fechaFin:e.target.value})} style={{ width:'100%', padding:'8px 12px', border:`1px solid ${C.border}`, borderRadius:6, fontSize:12, background:C.card, color:C.text, outline:'none' }} />
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:8 }}>
                        <button onClick={guardarProyecto} style={{ padding:'8px 16px', background:C.accent, color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>Guardar</button>
                        <button onClick={() => setEditando(false)} style={{ padding:'8px 16px', background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>Cancelar</button>
                      </div>
                    </div>
                  ) : null}

                  <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:20 }}>
                  {[
                    { l:'Estado', v:proyecto.status || '—', c:C.accent },
                    { l:'Propietario', v:proyecto.propietario || '—', c:C.muted },
                    { l:'Fase', v:proyecto.fase || '—', c:C.muted },
                    { l:'Capex', v:proyecto.capex ? '$' + proyecto.capex.toLocaleString('es') : '—', c:C.muted },
                    { l:'Temas', v:temas.length, c:'#818cf8' },
                    { l:'Completados', v:`${temasCompletados}/${temas.length}`, c:'#34d399' },
                    { l:'Bloqueados', v:temaBloqueados, c:'#f43f5e' },
                    { l:'Progreso', v:`${pct}%`, c:C.accent },
                  ].map((item, i) => (
                    <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'12px 16px' }}>
                      <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>{item.l}</div>
                      <div style={{ fontSize:16, fontWeight:700, color:item.c }}>{item.v}</div>
                    </div>
                  ))}
                  <div style={{ gridColumn:'1/-1', paddingTop:12, borderTop:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.muted, marginBottom:8, textTransform:'uppercase' }}>Fechas</div>
                    <div style={{ display:'flex', gap:16 }}>
                      <div>
                        <div style={{ fontSize:10, color:C.muted, marginBottom:2 }}>Inicio</div>
                        <div style={{ fontSize:13, color:C.text }}>{proyecto.fecha_inicio ? fmtFecha(fdStr(proyecto.fecha_inicio)) : '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:10, color:C.muted, marginBottom:2 }}>Fin</div>
                        <div style={{ fontSize:13, color:C.text }}>{proyecto.fecha_fin ? fmtFecha(fdStr(proyecto.fecha_fin)) : '—'}</div>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              )}

              {/* TAB: TIMELINE */}
              {tabActive === 'timeline' && (
                <div>
                  <div style={{ marginBottom:20 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>📌 Hitos del Proyecto</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      {hitos.map(h => (
                        <div key={h.id} style={{ display:'flex', alignItems:'center', gap:10, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px' }}>
                          <button onClick={() => toggleHito(h)} style={{ width:20, height:20, borderRadius:4, border:`2px solid ${h.completado?C.accent:C.border}`, background:h.completado?C.accent:'transparent', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#fff', cursor:'pointer', flexShrink:0 }}>
                            {h.completado && '✓'}
                          </button>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:12, color:h.completado?C.muted:C.text, textDecoration:h.completado?'line-through':'none' }}>{h.nombre}</div>
                            {h.descripcion && <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{h.descripcion}</div>}
                          </div>
                          {h.fecha_prevista && <div style={{ fontSize:10, color:C.muted, flexShrink:0 }}>{fmtFecha(fdStr(h.fecha_prevista))}</div>}
                          <button onClick={() => eliminarHito(h.id)} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:12 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop:16, padding:'14px', background:C.surface, border:`1px solid ${C.border}`, borderRadius:8 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.muted, marginBottom:10, textTransform:'uppercase' }}>➕ Nuevo hito</div>
                    <div style={{ display:'flex', gap:8 }}>
                      <input type="text" placeholder="Nombre del hito" value={newHitoName} onChange={e => setNewHitoName(e.target.value)} style={{ flex:1, border:`1px solid ${C.border}`, borderRadius:6, padding:'8px 12px', fontSize:12, background:C.card, color:C.text, outline:'none' }} />
                      <input type="date" value={newHitoDate} onChange={e => setNewHitoDate(e.target.value)} style={{ border:`1px solid ${C.border}`, borderRadius:6, padding:'8px 12px', fontSize:12, background:C.card, color:C.text, outline:'none' }} />
                      <button onClick={agregarHito} style={{ padding:'8px 14px', background:C.accent, color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>Agregar</button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: TEMAS */}
              {tabActive === 'temas' && (
                <div>
                  {temas.length === 0 ? (
                    <div style={{ textAlign:'center', color:C.muted, padding:'40px 0' }}>
                      <p>No hay temas vinculados a este proyecto</p>
                    </div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      {temas.map(t => {
                        const st = ST.find(s => s.id === t.status)
                        const pc = priColor(t.prioridad)
                        return (
                          <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', cursor:'pointer' }} onClick={() => { onClose(); onSave?.(); }}>
                            <div style={{ width:4, height:4, borderRadius:'50%', background:st?.color || C.muted, flexShrink:0 }} />
                            <span style={{ flex:1, fontSize:12, color:C.text, fontWeight:500 }}>{t.tema}</span>
                            {t.prioridad && <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3, background:pc.bg, color:pc.color }}>{t.prioridad}</span>}
                            <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3, background:st?.color+'22', color:st?.color }}>{st?.label}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB: COMENTARIOS */}
              {tabActive === 'comentarios' && (
                <div>
                  <div style={{ marginBottom:20, padding:'12px 14px', background:C.surface, border:`1px solid ${C.border}`, borderRadius:8 }}>
                    <textarea placeholder="Añade un comentario..." value={newComment} onChange={e => setNewComment(e.target.value)} style={{ width:'100%', border:'none', background:'none', fontSize:12, color:C.text, outline:'none', resize:'vertical', minHeight:60, fontFamily:'inherit' }} />
                    <button onClick={agregarComentario} disabled={!newComment.trim()} style={{ marginTop:8, padding:'6px 14px', background:C.accent, color:'#fff', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', opacity:newComment.trim()?1:0.5 }}>Enviar</button>
                  </div>

                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {comentarios.length === 0 ? (
                      <div style={{ textAlign:'center', color:C.muted, padding:'40px 0', fontSize:12 }}>Sin comentarios aún</div>
                    ) : (
                      comentarios.map(c => (
                        <div key={c.id} style={{ padding:'12px 14px', background:C.surface, border:`1px solid ${C.border}`, borderRadius:8 }}>
                          <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>{c.ts || new Date(c.created_at).toLocaleString('es-ES')}</div>
                          <div style={{ fontSize:12, color:C.text, lineHeight:1.5 }}>{c.texto}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Proyectos ─────────────────────────────────────────────────────────────────
const Proyectos = ({ proyectos, allItems, onAddTema, onOpenItem, onUpdate, lang='es' }) => {
  const [filtSt,          setFiltSt]          = useState('all')
  const [showSinProyecto, setShowSinProyecto] = useState(false)
  const [showBacklog,     setShowBacklog]     = useState(false)
  const [activarProyId,   setActivarProyId]   = useState(null)
  const [activarProySt,   setActivarProySt]   = useState('pending')
  const [modalProy,       setModalProy]       = useState(null)
  const [modo,            setModo]            = useState('cards')
  const [w, setW]         = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  const isMobile = w < 768

  useEffect(() => {
    const h = () => setW(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const temasOf  = nombre => allItems.filter(i => norm(i.proyecto||'') === norm(nombre))

  // Separar proyectos activos y backlog
  const backlogProyectos = proyectos.filter(p => p.status === 'backlog')
  const activeProyectos = proyectos.filter(p => p.status !== 'backlog')

  const filtered = [...activeProyectos.filter(p => filtSt === 'all' || p.status === filtSt)]
    .sort((a, b) => {
      const aDone = a.status === 'done', bDone = b.status === 'done'
      if (aDone !== bDone) return aDone ? 1 : -1
      const aD = a.fechaFin ? new Date(fdStr(a.fechaFin)).getTime() : Infinity
      const bD = b.fechaFin ? new Date(fdStr(b.fechaFin)).getTime() : Infinity
      return aD - bD
    })

  if (proyectos.length === 0) return (
    <div style={{ paddingTop:24, maxWidth:600 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:32, textAlign:'center' }}>
        <div style={{ fontSize:36, marginBottom:12 }}>🗂️</div>
        <h3 style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:8 }}>No hay proyectos todavía</h3>
        <p style={{ fontSize:13, color:C.muted, lineHeight:1.7 }}>
          Pulsa el botón <b style={{ color:C.text }}>⬆ Migrar Proyectos</b> arriba para importar los proyectos del Sheet,
          o créalos directamente desde el panel de administración de Supabase.
        </p>
      </div>
    </div>
  )

  const totalTemas    = allItems.filter(i => i.proyecto && i.proyecto.trim()).length
  const totalCapex    = proyectos.reduce((s,p) => s+(p.capex||0), 0)
  const sinProyecto = allItems.filter(i => !i.proyecto || !i.proyecto.trim()).length

  return (
    <div style={{ paddingTop:16 }}>
      <style>{`
        @keyframes cardIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes rowIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .proj-card{transition:transform 180ms cubic-bezier(0.23,1,0.32,1),box-shadow 180ms ease-out,border-color 180ms ease-out}
        .proj-card:hover{transform:translateY(-3px)!important;box-shadow:0 8px 24px rgba(0,0,0,.12)!important}
        .proj-card:active{transform:scale(0.98) translateY(0)!important;transition-duration:80ms!important}
      `}</style>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(4,1fr)', gap:10, marginBottom:18 }}>
        {[
          { l:'Proyectos',    v:proyectos.length,                              c:C.accent },
          { l:'Temas vinc.',  v:totalTemas,                                    c:'#818cf8' },
          { l:'Sin proyecto', v:sinProyecto,                                   c:C.muted  },
          { l:'Completados',  v:proyectos.filter(p=>p.status==='done').length, c:'#34d399' },
        ].map((k,i) => (
          <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:isMobile?'10px 12px':'12px 14px' }}>
            <div style={{ fontSize:isMobile?22:26, fontWeight:700, color:k.c, lineHeight:1 }}>{k.v}</div>
            <div style={{ fontSize:isMobile?9:10, color:C.muted, marginTop:4, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em' }}>{k.l}</div>
          </div>
        ))}
      </div>

      {/* Filtros + toggle vista */}
      <div style={{ display:'flex', gap:isMobile?4:6, marginBottom:18, flexWrap:'wrap', alignItems:'center', overflow:'auto' }}>
        {[{id:'all',label:'Todos',color:C.muted},...ST].map(s => {
          const on  = filtSt === s.id
          const col = s.color || C.muted
          const cnt = s.id==='all' ? proyectos.length : proyectos.filter(p=>p.status===s.id).length
          return (
            <button key={s.id} onClick={() => setFiltSt(s.id)}
              style={{ padding:isMobile?'3px 10px':'4px 12px', borderRadius:20, fontSize:isMobile?11:12, fontWeight:600, cursor:'pointer',
                border:`1.5px solid ${on?col:C.border}`, background:on?col+'22':C.card, color:on?col:C.muted,
                transition:'all 150ms ease-out', whiteSpace:'nowrap' }}>
              {s.label} <span style={{ opacity:.65 }}>{cnt}</span>
            </button>
          )
        })}
        <div style={{ marginLeft:'auto', display:'flex', gap:4, flexShrink:0 }}>
          {[{id:'cards',l:'⊞'},{id:'list',l:'☰'}].map(v => (
            <button key={v.id} onClick={() => setModo(v.id)} title={v.id==='cards'?'Vista Cards':'Vista Lista'}
              style={{ padding:isMobile?'3px 7px':'4px 9px', borderRadius:6, fontSize:isMobile?12:13, border:`1px solid ${C.border}`,
                background:modo===v.id?C.accent+'22':C.card, color:modo===v.id?C.accent:C.muted, cursor:'pointer' }}>{v.l}</button>
          ))}
        </div>
      </div>

      {/* Sin proyecto collapsible */}
      {(() => {
        const sinProy = allItems.filter(i => !i.proyecto || !i.proyecto.trim())
        if (sinProy.length === 0) return null
        return (
          <div style={{ marginBottom:18 }}>
            <button onClick={() => setShowSinProyecto(p => !p)}
              style={{ display:'flex', alignItems:'center', gap:8, width:'100%', background:C.card, border:`1px solid ${C.border}`, borderRadius:showSinProyecto?'10px 10px 0 0':10, padding:'12px 16px', cursor:'pointer', color:C.text, fontSize:13, fontWeight:600, outline:'none', transition:'background 150ms ease-out' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:C.muted, display:'inline-block', flexShrink:0 }} />
              <span style={{ flex:1, textAlign:'left' }}>Sin proyecto asignado</span>
              <span style={{ fontSize:11, color:C.muted, background:C.surface, padding:'2px 8px', borderRadius:10 }}>{sinProy.length} tema{sinProy.length!==1?'s':''}</span>
              <span style={{ color:C.muted, fontSize:11, display:'inline-block', transition:'transform 200ms ease-out', transform:showSinProyecto?'rotate(180deg)':'rotate(0deg)' }}>▼</span>
            </button>
            {showSinProyecto && (
              <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:'none', borderRadius:'0 0 10px 10px', overflow:'hidden' }}>
                {sinProy.map((t, i) => {
                  const st  = ST.find(s=>s.id===t.status)
                  const cat = CATS.find(c=>c.id===t.category)
                  return (
                    <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 16px', borderBottom:`1px solid ${C.border}44`, fontSize:12, animation:`rowIn 220ms ease-out ${i*20}ms both` }}>
                      <div style={{ width:3, height:16, borderRadius:2, background:cat?.color||C.muted, flexShrink:0 }} />
                      <span style={{ flex:1, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.tema}</span>
                      <Tag id={t.category} type="cat" />
                      <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3, background:st?.color+'22', color:st?.color, flexShrink:0 }}>{st?.label}</span>
                      <span style={{ fontSize:10, color:C.muted, flexShrink:0 }}>{(t.propietario||'').split(' ')[0]}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* Backlog de Proyectos */}
      {(() => {
        if (backlogProyectos.length === 0) return null
        return (
          <div style={{ marginBottom:18 }}>
            <button onClick={() => setShowBacklog(p => !p)}
              style={{ display:'flex', alignItems:'center', gap:8, width:'100%', background:C.card, border:`1px solid ${C.border}`, borderRadius:showBacklog?'10px 10px 0 0':10, padding:'12px 16px', cursor:'pointer', color:C.text, fontSize:13, fontWeight:600, outline:'none', transition:'background 150ms ease-out' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:'#94a3b8', display:'inline-block', flexShrink:0 }} />
              <span style={{ flex:1, textAlign:'left' }}>📦 Backlog de Proyectos</span>
              <span style={{ fontSize:11, color:C.muted, background:C.surface, padding:'2px 8px', borderRadius:10 }}>{backlogProyectos.length}</span>
              <span style={{ color:C.muted, fontSize:11, display:'inline-block', transition:'transform 200ms ease-out', transform:showBacklog?'rotate(180deg)':'rotate(0deg)' }}>▼</span>
            </button>
            {showBacklog && (
              <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:'none', borderRadius:'0 0 10px 10px', overflow:'hidden' }}>
                {backlogProyectos.map((p, i) => {
                  const temas     = temasOf(p.nombre)
                  const isActivating = activarProyId === p.id
                  return (
                    <div key={p.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 16px', borderBottom:`1px solid ${C.border}44`, fontSize:12, animation:`rowIn 220ms ease-out ${i*20}ms both`, cursor:'pointer' }} onClick={() => setModalProy(p)}>
                      <div style={{ width:3, height:16, borderRadius:2, background:'#94a3b8', flexShrink:0 }} />
                      <span style={{ flex:1, color:C.text, fontWeight:500 }}>{p.nombre}</span>
                      <span style={{ fontSize:10, color:C.muted }}>{temas.length} temas</span>
                      {isActivating ? (
                        <div style={{ display:'flex', alignItems:'center', gap:6 }} onClick={e => e.stopPropagation()}>
                          <select value={activarProySt} onChange={e => setActivarProySt(e.target.value)}
                            style={{ fontSize:11, padding:'3px 6px', borderRadius:5, border:'1px solid #cbd5e1', background:'#fff', color:'#334155', cursor:'pointer' }}>
                            {ST.filter(s => s.id !== 'backlog').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                          <button
                            onClick={e => { e.stopPropagation(); sbUpdateProyecto(p.id, { status:activarProySt }); setActivarProyId(null); window.location.reload() }}
                            style={{ fontSize:11, padding:'3px 10px', borderRadius:5, background:C.accent, color:'#fff', border:'none', cursor:'pointer', fontWeight:600 }}>
                            Activar
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setActivarProyId(null) }}
                            style={{ fontSize:11, padding:'3px 8px', borderRadius:5, background:'none', color:C.muted, border:'1px solid #e2e8f0', cursor:'pointer' }}>
                            X
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setActivarProyId(p.id); setActivarProySt('pending') }}
                          style={{ fontSize:11, padding:'3px 10px', borderRadius:5, background:'#f1f5f9', color:'#475569', border:'1px solid #cbd5e1', cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}>
                          Activar
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Cards / Lista (toggle) ── */}
      {(() => {
        const projRows = filtered.map(p => {
          const temas     = temasOf(p.nombre)
          const done      = temas.filter(t => t.status==='done').length
          const blocked   = temas.filter(t => t.status==='blocked').length
          const pct       = temas.length > 0 ? Math.round(done/temas.length*100) : 0
          const oc        = ownerColor(p.propietario)
          const catCounts = CATS.map(c => ({ c, n:temas.filter(t=>t.category===c.id).length })).sort((a,b)=>b.n-a.n)
          const accentCol = catCounts[0]?.n > 0 ? catCounts[0].c.color : C.accent
          const stData    = ST.find(s=>s.id===p.status)
          const pc        = priColor(p.prioridad)
          const dias      = p.fechaFin && p.status!=='done' ? diasRestantes(fdStr(p.fechaFin)) : null
          const diasColor = dias === null ? C.muted : dias < 0 ? '#dc2626' : dias <= 7 ? '#d97706' : C.muted
          const diasLabel = dias === null ? null : dias < 0 ? `Vencido ${Math.abs(dias)}d` : dias === 0 ? 'Vence hoy' : `${dias}d`
          return { p, temas, done, blocked, pct, oc, accentCol, stData, pc, dias, diasColor, diasLabel }
        })

        if (modo === 'cards') return (
          <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(320px,1fr))', gap:isMobile?10:14 }}>
            {projRows.map(({ p, temas, blocked, pct, oc, accentCol, stData, pc, dias, diasColor, diasLabel }, i) => (
              <div key={p.id} className="proj-card" onClick={() => setModalProy(p)}
                style={{ background:C.card, border:`1px solid ${dias!==null&&dias<0?'#fca5a555':C.border}`, borderRadius:10, overflow:'hidden', cursor:'pointer', animation:`cardIn 300ms cubic-bezier(0.23,1,0.32,1) ${i*45}ms both` }}>
                <div style={{ height:3, background:`linear-gradient(90deg,${accentCol},${stData?.color||C.muted})` }} />
                <div style={{ padding:isMobile?'10px 12px 12px':'14px 16px 16px' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:6 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:isMobile?13:14, fontWeight:700, color:C.text, lineHeight:1.3, marginBottom:2 }}>{p.nombre}</div>
                      {p.descripcion && <div style={{ fontSize:isMobile?10:11, color:C.muted, lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{p.descripcion}</div>}
                    </div>
                    <Tag id={p.status} type="st" />
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:isMobile?5:7, marginBottom:8, flexWrap:'wrap', fontSize:isMobile?9:10 }}>
                    {p.propietario && (
                      <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                        <div style={{ width:16, height:16, borderRadius:'50%', background:oc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:6, fontWeight:700, color:'#fff' }}>{iniciales(p.propietario)}</div>
                        <span style={{ color:C.muted }}>{p.propietario.split(' ')[0]}</span>
                      </div>
                    )}
                    {p.prioridad && <span style={{ fontSize:8, fontWeight:700, padding:'1px 4px', borderRadius:2, background:pc.bg, color:pc.color }}>{p.prioridad}</span>}
                    {p.desarrollo && (() => { const isVF=norm(p.desarrollo)==='vodafone'; return <span style={{ fontSize:8, fontWeight:700, padding:'1px 4px', borderRadius:2, background:isVF?'#e8001c18':'#1a5fe318', color:isVF?'#b30016':'#1244a8' }}>{p.desarrollo}</span> })()}
                    {p.fechaInicio && <span style={{ color:C.muted }}>Inicio: {fmtFecha(fdStr(p.fechaInicio))}</span>}
                    {diasLabel && <span style={{ fontWeight:dias!==null&&dias<=7?700:400, color:diasColor }}>{diasLabel}</span>}
                    <span style={{ color:C.muted, marginLeft:'auto' }}>
                      {temas.length}t{blocked>0&&<span style={{ color:'#f43f5e' }}>·{blocked}b</span>}
                    </span>
                  </div>
                  {p.fase && (() => {
                    const pct = fasePct(p.fase)
                    return (
                      <div style={{ marginBottom:6 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                          <span style={{ fontSize:isMobile?8:9, color:C.muted }}>{lang==='en'?faseLabel(p.fase,'en'):p.fase}</span>
                          <span style={{ fontSize:isMobile?8:9, fontWeight:700, color:C.accent }}>{pct}%</span>
                        </div>
                        <div style={{ height:2, background:C.border, borderRadius:1 }}>
                          <div style={{ height:'100%', width:`${pct}%`, background:C.accent, borderRadius:1 }} />
                        </div>
                      </div>
                    )
                  })()}
                  {temas.length > 0 ? (
                    <div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                          {ST.map(s => { const n=temas.filter(t=>t.status===s.id).length; return n?<span key={s.id} style={{ fontSize:9, color:s.color, fontWeight:600 }}>{n} {s.label}</span>:null })}
                        </div>
                        <span style={{ fontSize:11, fontWeight:700, color:accentCol }}>{pct}%</span>
                      </div>
                      <div style={{ height:6, background:C.surface, borderRadius:3, overflow:'hidden', display:'flex', gap:1 }}>
                        {ST.map(s => { const n=temas.filter(t=>t.status===s.id).length; const w=temas.length>0?n/temas.length*100:0; return w>0?<div key={s.id} style={{ width:`${w}%`, background:s.color, transition:'width .5s cubic-bezier(0.23,1,0.32,1)' }}/>:null })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize:11, color:C.muted, fontStyle:'italic', display:'flex', alignItems:'center', gap:6 }}>
                      <span>Sin temas vinculados</span>
                      <span style={{ fontSize:10, color:C.accent, background:C.accent+'22', padding:'1px 6px', borderRadius:4, fontStyle:'normal', fontWeight:600 }}>+ Añadir</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )

        /* Vista Lista */
        if (isMobile) {
          // Mobile: simplified list layout
          return (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {projRows.length === 0
                ? <div style={{ padding:24, textAlign:'center', color:C.muted, fontSize:13, background:C.card, borderRadius:10 }}>Sin proyectos</div>
                : projRows.map(({ p, temas, blocked, pct, oc, accentCol, pc, dias, diasColor, diasLabel }) => (
                  <div key={p.id} onClick={() => setModalProy(p)}
                    style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'12px 14px', cursor:'pointer' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:8 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>{p.nombre}</div>
                        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', fontSize:11 }}>
                          <Tag id={p.status} type="st" />
                          {p.prioridad && <span style={{ fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:3, background:pc.bg, color:pc.color }}>{p.prioridad}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, color:C.muted, marginBottom:8 }}>
                      {p.propietario && (
                        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <div style={{ width:16, height:16, borderRadius:'50%', background:oc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:6, fontWeight:700, color:'#fff' }}>{iniciales(p.propietario)}</div>
                          <span>{p.propietario.split(' ')[0]}</span>
                        </div>
                      )}
                      <span>•</span>
                      <span>{temas.length} tema{temas.length!==1?'s':''}</span>
                      {blocked > 0 && <span style={{ color:'#f43f5e' }}> · {blocked}b</span>}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div style={{ flex:1, height:4, background:C.surface, borderRadius:2, overflow:'hidden' }}>
                        <div style={{ width:`${pct}%`, height:'100%', background:accentCol }} />
                      </div>
                      <span style={{ fontSize:10, fontWeight:700, color:accentCol }}>{pct}%</span>
                    </div>
                    {diasLabel && <div style={{ fontSize:10, fontWeight:dias!==null&&dias<=7?700:400, color:diasColor, marginTop:6 }}>{diasLabel}</div>}
                  </div>
                ))
              }
            </div>
          )
        }

        // Desktop: full table layout
        return (
          <div style={{ background:C.card, borderRadius:10, border:`1px solid ${C.border}`, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 100px 70px 130px 80px 80px 100px', padding:'8px 14px', borderBottom:`1px solid ${C.border}`, fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.05em' }}>
              <span>Proyecto</span><span>Estado</span><span>Prio.</span><span>Responsable</span><span>Progreso</span><span>Temas</span><span>Plazo</span>
            </div>
            {projRows.length === 0
              ? <div style={{ padding:24, textAlign:'center', color:C.muted, fontSize:13 }}>Sin proyectos</div>
              : projRows.map(({ p, temas, blocked, pct, oc, accentCol, pc, dias, diasColor, diasLabel }) => (
                <div key={p.id} onClick={() => setModalProy(p)}
                  style={{ display:'grid', gridTemplateColumns:'2fr 100px 70px 130px 80px 80px 100px', padding:'10px 14px', borderBottom:`1px solid ${C.border}`, cursor:'pointer', alignItems:'center', fontSize:12 }}
                  onMouseEnter={e => e.currentTarget.style.background=C.surface}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, overflow:'hidden' }}>
                    <div style={{ width:3, height:18, borderRadius:2, background:accentCol, flexShrink:0 }} />
                    <div style={{ overflow:'hidden' }}>
                      <div style={{ fontSize:13, fontWeight:600, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.nombre}</div>
                      {blocked > 0 && <div style={{ fontSize:10, color:'#f43f5e', fontWeight:600 }}>{blocked} bloqueado{blocked!==1?'s':''}</div>}
                    </div>
                  </div>
                  <Tag id={p.status} type="st" />
                  <span>{p.prioridad ? <span style={{ fontSize:10, fontWeight:700, padding:'2px 5px', borderRadius:3, background:pc.bg, color:pc.color }}>{p.prioridad}</span> : <span style={{ color:C.muted }}>—</span>}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:16, height:16, borderRadius:'50%', background:oc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:6, fontWeight:700, color:'#fff', flexShrink:0 }}>{iniciales(p.propietario)}</div>
                    <span style={{ fontSize:11, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(p.propietario||'—').split(' ')[0]}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <div style={{ flex:1, height:5, background:C.surface, borderRadius:3, overflow:'hidden', minWidth:28 }}>
                      <div style={{ width:`${pct}%`, height:'100%', background:accentCol }} />
                    </div>
                    <span style={{ fontSize:10, fontWeight:700, color:accentCol }}>{pct}%</span>
                  </div>
                  <span style={{ fontSize:11, color:C.muted }}>
                    {temas.length}{blocked>0&&<span style={{ color:'#f43f5e' }}> · {blocked}b</span>}
                  </span>
                  <span style={{ fontSize:11, fontWeight:dias!==null&&dias<=7?700:400, color:diasColor }}>
                    {diasLabel || (p.fechaFin ? fmtFecha(fdStr(p.fechaFin)) : '—')}
                  </span>
                </div>
              ))
            }
          </div>
        )
      })()}

      {/* Project Detail View (NEW) */}
      {modalProy && (
        <ProjectDetailView
          proyecto={modalProy}
          allItems={allItems}
          onClose={() => setModalProy(null)}
          onSave={() => { setModalProy(null) }}
        />
      )}
    </div>
  )
}

// ── IA Intake ─────────────────────────────────────────────────────────────────
// Fuzzy title similarity (client-side, zero API cost)
const _tokensOf = s => s.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter(w => w.length > 3)

const _similarity = (a, b) => {
  const ta = new Set(_tokensOf(a)), tb = _tokensOf(b)
  if (!ta.size || !tb.length) return 0
  return tb.filter(w => ta.has(w)).length / Math.max(ta.size, tb.length)
}

const findSimilar = (title, existingItems) =>
  existingItems
    .filter(i => i.status !== 'done' && !i._deleted)
    .map(i => ({ item:i, score:_similarity(title, i.tema) }))
    .filter(x => x.score >= 0.38)
    .sort((a,b) => b.score - a.score)
    .slice(0, 2)
    .map(x => x.item)

const IAIntake = ({ onAdd, allItems = [] }) => {
  const [txt, setTxt]         = useState('')
  const [busy, setBusy]       = useState(false)
  const [pending, setPending] = useState(null)
  const [err, setErr]         = useState('')
  const [w, setW]             = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  const isMobile = w < 768

  useEffect(() => {
    const h = () => setW(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const run = async () => {
    if (!txt.trim()) return
    setBusy(true); setErr(''); setPending(null)
    try {
      const inputText = txt.length > 4000 ? txt.slice(0, 4000) + '\n[texto truncado]' : txt
      const raw = await callClaude({
        model:'claude-haiku-4-5-20251001', max_tokens:4096,
        system:'Extrae tareas del texto. Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni bloques de código markdown. Máximo 10 items y 4 subtareas por item. Sé conciso en los textos. Formato exacto:\n{"items":[{"category":"projects|product|tools|cvm","title":"string","description":"string (max 120 chars)","subtasks":["string"],"risk":"green|yellow|red","endDate":"YYYY-MM-DD or null"}]}',
        messages:[{ role:'user', content:inputText }],
      })
      if (!raw.trim()) { setErr('La API devolvió una respuesta vacía. Comprueba la CLAUDE_API_KEY en Vercel.'); setBusy(false); return }
      const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
      const clean = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw.trim()
      let p
      try { p = JSON.parse(clean) }
      catch(e) { setErr(`JSON inválido: ${e.message}\n\nRespuesta (primeros 400 chars):\n${raw.slice(0,400)}`); setBusy(false); return }
      if (!p.items?.length) { setErr('La IA no detectó tareas en el texto. Prueba con un texto más descriptivo.'); setBusy(false); return }
      setPending((p.items||[]).map(i => ({
        ...i, assignee:'',
        similar: findSimilar(i.title, allItems),
        skip: false,
      })))
    } catch(e) { setErr(`Error llamando a la API: ${e.message}`) }
    setBusy(false)
  }

  const toggleSkip = idx =>
    setPending(prev => prev.map((it,i) => i===idx ? {...it, skip:!it.skip} : it))

  const confirmar = () => {
    const toAdd = pending.filter(ai => !ai.skip)
    if (!toAdd.length) { setPending(null); return }
    const ni = toAdd.map(ai => ({
      id:uid(), category:ai.category||'projects', tema:ai.title,
      objetivo:ai.description||'', propietario:'', status:'pending',
      estadoSheet:'No iniciado', risk:ai.risk||'green', prioridad:'',
      fechaInicio:null, fechaFin:ai.endDate?new Date(ai.endDate):null,
      archivos:'', notas:'Creado desde IA Intake',
      subtareas:(ai.subtasks||[]).map(s=>({id:uid(),title:s,prop:'',status:'pending',risk:'green',fechaFin:null,notas:''})),
      _local:true,
    }))
    onAdd(ni); setTxt(''); setPending(null)
  }

  const dupCount  = pending?.filter(i => i.similar?.length > 0).length || 0
  const skipCount = pending?.filter(i => i.skip).length || 0
  const addCount  = (pending?.length || 0) - skipCount

  return (
    <div style={{ paddingTop:isMobile?8:16, maxWidth:isMobile?'100%':760 }}>
      <h2 style={{ fontSize:isMobile?15:16, fontWeight:700, color:C.text, marginBottom:3 }}>✨ IA Intake</h2>
      <p style={{ fontSize:isMobile?12:13, color:C.muted, marginBottom:isMobile?10:14 }}>Pega un email, nota o acta. La IA detecta las tareas automáticamente.</p>
      <TA value={txt} onChange={setTxt} placeholder="Pega aquí el texto..." rows={isMobile?5:6} style={{ marginBottom:10, fontSize:isMobile?14:16 }} />
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        <Btn onClick={run} disabled={busy||!txt.trim()}>{busy?'⏳ Analizando…':'✨ Detectar tareas'}</Btn>
        {txt && <Btn v="sec" onClick={() => { setTxt(''); setPending(null) }}>Limpiar</Btn>}
      </div>
      {err && <div style={{ color:'#f43f5e', fontSize:isMobile?12:13, marginBottom:12, whiteSpace:'pre-wrap', lineHeight:1.4 }}>{err}</div>}
      {pending && (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:isMobile?6:10, marginBottom:12, flexWrap:'wrap' }}>
            <span style={{ fontSize:isMobile?10:11, fontWeight:700, color:C.muted }}>
              {pending.length} tarea{pending.length!==1?'s':''} detectada{pending.length!==1?'s':''}
            </span>
            {dupCount > 0 && (
              <span style={{ fontSize:isMobile?10:11, color:'#92400e', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:4, padding:isMobile?'1px 6px':'1px 7px', fontWeight:600 }}>
                ⚠ {dupCount} posible{dupCount!==1?'s':''} duplicado{dupCount!==1?'s':''}
              </span>
            )}
          </div>
          {pending.map((item,idx) => {
            const cat    = CATS.find(c => c.id === item.category)
            const hasDup = item.similar?.length > 0
            const bdColor = item.skip ? '#d1d5db' : hasDup ? '#fbbf24' : (cat?.color || C.muted)
            return (
              <div key={idx} style={{
                background: item.skip ? C.surface : C.card,
                borderLeft:`3px solid ${bdColor}`,
                borderRadius:8, padding:isMobile?10:14, marginBottom:8,
                border:`1px solid ${item.skip ? '#e5e7eb' : hasDup ? '#fde68a' : C.border}`,
                opacity: item.skip ? 0.45 : 1,
                transition:'opacity 150ms',
              }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:isMobile?6:9 }}>
                  <input type="checkbox" checked={!item.skip} onChange={() => toggleSkip(idx)}
                    title={item.skip ? 'Incluir' : 'Omitir este item'}
                    style={{ marginTop:2, cursor:'pointer', accentColor:C.accent, flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3, flexWrap:'wrap' }}>
                      <Tag id={item.category} type="cat" />
                      <span style={{ fontSize:isMobile?12.5:13.5, fontWeight:600, color: item.skip ? C.muted : C.text }}>{item.title}</span>
                      <Dot risk={item.risk} />
                    </div>
                    {item.description && !item.skip && (
                      <p style={{ fontSize:isMobile?11:12, color:C.muted, margin:0, marginBottom: hasDup ? 6 : 0, lineHeight:1.4 }}>{item.description}</p>
                    )}
                    {hasDup && !item.skip && (
                      <div style={{ display:'flex', alignItems:'flex-start', gap:4, marginTop:5,
                        background:'#fffbeb', border:'1px solid #fde68a', borderRadius:4, padding:isMobile?'4px 6px':'5px 8px' }}>
                        <span style={{ fontSize:isMobile?11:12, flexShrink:0 }}>⚠</span>
                        <div style={{ fontSize:isMobile?10.5:11.5, color:'#92400e', lineHeight:1.4 }}>
                          <span style={{ fontWeight:600 }}>Ya existe algo similar: </span>
                          {item.similar.map((s,si) => (
                            <span key={si}>
                              <span style={{ fontStyle:'italic' }}>"{s.tema}"</span>
                              <span style={{ color:'#b45309' }}> ({ST.find(st=>st.id===s.status)?.label||s.status})</span>
                              {si < item.similar.length-1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div style={{ display:'flex', gap:8, marginTop:14, alignItems:'center', flexWrap:'wrap' }}>
            <Btn onClick={confirmar} disabled={addCount===0}>✓ Añadir {addCount} al tablero</Btn>
            <Btn v="sec" onClick={() => setPending(null)}>Cancelar</Btn>
            {skipCount > 0 && <span style={{ fontSize:isMobile?10:11, color:C.muted }}>{skipCount} omitida{skipCount!==1?'s':''}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reporte Semanal ───────────────────────────────────────────────────────────
const Reporte = ({ items, proyectos=[], lang='es' }) => {
  const [txt, setTxt]       = useState('')
  const [busy, setBusy]     = useState(false)
  const [fmt, setFmt]       = useState('email')
  const [copied, setCopied] = useState(false)
  const [rpTab, setRpTab]   = useState('tracking')

  // Convert any date value (Date object OR "YYYY-MM-DD" string OR "DD/MM/YYYY" string) to a local midnight Date
  const toLocalDate = d => {
    if (!d) return null
    if (d instanceof Date) {
      // Re-create using local Y/M/D to avoid UTC timezone shift from toISOString()
      return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    }
    const s = String(d).trim()
    // YYYY-MM-DD (from date inputs / localStorage overrides)
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (iso) return new Date(+iso[1], +iso[2]-1, +iso[3])
    // DD/MM/YYYY (from sheet FORMATTED_VALUE)
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (dmy) return new Date(+dmy[3], +dmy[2]-1, +dmy[1])
    return null
  }

  // Build MONTH_STARTS dynamically from actual project date range so the Gantt
  // always covers whatever dates the projects have (not a hardcoded 12-month window)
  const ganttRange = (() => {
    const dates = proyectos.flatMap(p => [toLocalDate(p.fechaInicio), toLocalDate(p.fechaFin)]).filter(Boolean)
    if (!dates.length) {
      // fallback: current year ± 6 months
      const now = new Date()
      return { y0: now.getFullYear(), m0: 0, y1: now.getFullYear()+1, m1: 11 }
    }
    const minD = new Date(Math.min(...dates))
    const maxD = new Date(Math.max(...dates))
    return { y0: minD.getFullYear(), m0: minD.getMonth(), y1: maxD.getFullYear(), m1: maxD.getMonth() }
  })()

  // Generate one entry per month spanning the range
  const MONTH_STARTS = (() => {
    const res = []
    let y = ganttRange.y0, m = ganttRange.m0
    while (y < ganttRange.y1 || (y === ganttRange.y1 && m <= ganttRange.m1)) {
      res.push(new Date(y, m, 1))
      m++; if (m > 11) { m = 0; y++ }
      if (res.length > 36) break // safety cap: max 3 years
    }
    return res
  })()
  const MONTH_ENDS = MONTH_STARTS.map((_,i) => {
    const n = MONTH_STARTS[i+1] || new Date(ganttRange.y1, ganttRange.m1+1, 1)
    return new Date(n-1)
  })
  const MONTHS_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const MONTHS = MONTH_STARTS.map(d => {
    const mo = lang==='en' ? MONTHS_EN[d.getMonth()] : MONTHS_ES[d.getMonth()]
    return `${mo}-${String(d.getFullYear()).slice(2)}`
  })

  const monthActive = (p, mi) => {
    const e = toLocalDate(p.fechaFin)
    if (!e || isNaN(e)) return false
    const s = toLocalDate(p.fechaInicio) || e
    return s <= MONTH_ENDS[mi] && e >= MONTH_STARTS[mi]
  }
  const VF='#e8001c', SC='#1a5fe3'
  const barCol = p => norm(p.desarrollo||'')==='sercom' ? SC : VF
  const totalCapex = proyectos.reduce((s,p)=>s+(p.capex||0),0)
  const ST_ES = { pending:'No iniciado', inprogress:'En curso', blocked:'En riesgo', done:'Completado' }
  const ST_EN = { pending:'Not started', inprogress:'In progress', blocked:'At risk', done:'Completed' }
  const stLabel = st => lang==='en'?(ST_EN[st]||st):(ST_ES[st]||st)
  const stCol   = st => st==='done'?'#10b981':st==='inprogress'?'#3b82f6':st==='blocked'?'#f59e0b':'#94a3b8'

  const generar = async () => {
    setBusy(true); setTxt('')
    const stats = {
      fecha:      new Date().toLocaleDateString('es-ES',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}),
      total:      items.length,
      porEstado:  ST.map(s => ({ estado:s.label, n:items.filter(i=>i.status===s.id).length })),
      porArea:    CATS.map(c => ({ area:c.label, n:items.filter(i=>i.category===c.id).length })),
      enRiesgo:   items.filter(i=>i.risk==='red'&&i.status!=='done').map(i=>i.tema),
      bloqueados: items.filter(i=>i.status==='blocked').map(i=>({ tema:i.tema, prop:i.propietario })),
      completados:items.filter(i=>i.status==='done').map(i=>i.tema),
      vencidos:   items.filter(i=>i.fechaFin&&i.status!=='done'&&diasRestantes(fdStr(i.fechaFin))<0).map(i=>i.tema),
      equipo:     [...new Set(items.map(i=>i.propietario).filter(Boolean))].map(p=>({
        nombre:p, total:items.filter(i=>i.propietario===p).length,
        enCurso:items.filter(i=>i.propietario===p&&i.status==='inprogress').length,
      })),
    }
    const SYSTEM_EJECUTIVO = `Actúa como un Director de PMO, Program Manager senior y consultor de comunicación ejecutiva especializado en reporting para dirección.
Tu objetivo es transformar información operativa desordenada proveniente de un OpsBoard semanal en un resumen ejecutivo claro, estratégico y orientado a negocio.
Tu trabajo NO es copiar tareas. Tu trabajo es interpretar la información y convertirla en un resumen ejecutivo de alto nivel que transmita: control, avance real, capacidad de ejecución, gestión de riesgos y foco en impacto negocio.
Reglas importantes:
- NO hagas listas infinitas de tareas.
- NO copies literalmente textos del OpsBoard salvo que sea necesario.
- NO uses lenguaje excesivamente técnico.
- Resume y agrupa iniciativas relacionadas.
- Prioriza impacto y avance por encima de actividad.
- Si detectas riesgos, dependencias o bloqueos, destácalos claramente.
- Si algo parece importante para dirección aunque no esté explícitamente indicado, interprétalo y destácalo.
- El tono debe ser ejecutivo, profesional, claro y directo.
- Evita frases vacías o demasiado "corporativas".
- El resultado debe poder leerse en menos de 3 minutos.

Estructura obligatoria de salida:

## Resumen Ejecutivo Semanal

### Estado General
Indica el estado global: 🟢 En línea / 🟡 Con riesgos controlados / 🔴 Requiere atención
Añade un párrafo ejecutivo de 3-5 líneas resumiendo la situación general, foco principal de la semana y percepción global del avance.

### Principales avances de la semana
Resume únicamente los avances relevantes para negocio, operación, cliente, despliegue o experiencia usuario. Agrupa por iniciativas. Cada punto debe explicar qué se avanzó, por qué es importante y cuál es el impacto.

### Riesgos / Bloqueos / Dependencias
Detalla riesgos detectados, dependencias con terceros, posibles impactos, retrasos o validaciones pendientes. Indica si están controlados o requieren escalado.

### Próximos pasos
Resume los focos principales de la próxima semana de forma ejecutiva. No pongas micro tareas operativas.

### Decisiones o soporte requerido
Incluye solo si aplica: decisiones pendientes, validaciones necesarias, aprobaciones o soporte requerido por dirección.

### Logros destacados *(opcional)*
Incluye solo si hubo hitos reales: cierres, desbloqueos relevantes, mejoras de experiencia, avances estratégicos o hitos de despliegue.

Formato: muy limpio, fácil de escanear, orientado a dirección, máximo 1 página.`

    const SYSTEM_BULLETS = `Eres un Program Manager senior. Prepara un resumen para standup o reunión de 5 minutos.
Formato bullets concisos, máximo 20 bullets agrupados por: Estado general, Avances clave, Riesgos/bloqueos, Próximos pasos.
Sin tecnicismos, orientado a impacto negocio, directo.`

    try {
      const r = await callClaude({
        model:'claude-sonnet-4-6', max_tokens:1800,
        system: fmt==='email' ? SYSTEM_EJECUTIVO : SYSTEM_BULLETS,
        messages:[{ role:'user', content:`Datos del OpsBoard semanal:
${JSON.stringify(stats,null,2)}` }],
      })
      setTxt(r)
    } catch { setTxt('Error al generar.') }
    setBusy(false)
  }

  const copiar = () => { navigator.clipboard?.writeText(txt); setCopied(true); setTimeout(()=>setCopied(false),2000) }

  const thSt = { padding:'7px 6px', borderBottom:`1px solid ${C.border}`, fontWeight:600, color:C.muted, fontSize:10, textAlign:'center', whiteSpace:'nowrap' }
  const tdSt = { padding:'6px 6px', fontSize:11 }

  return (
    <div style={{ padding:'0 24px 32px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:C.text }}>📋 Reporte Semanal</h2>
          {totalCapex>0 && <p style={{ margin:'2px 0 0', fontSize:12, color:C.muted }}>FY2627 · CAPEX total: <strong style={{ color:C.text }}>{Number(totalCapex).toLocaleString('es')} €</strong></p>}
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          {[{id:'tracking',l:'📊 Tracking'},{id:'ia',l:'🤖 Reporte IA'}].map(t => (
            <button key={t.id} onClick={()=>setRpTab(t.id)} style={{ padding:'5px 14px', borderRadius:6, fontSize:12, fontWeight:600, border:`1px solid ${C.border}`, background:rpTab===t.id?C.accent:C.card, color:rpTab===t.id?'#fff':C.muted, cursor:'pointer' }}>{t.l}</button>
          ))}
        </div>
      </div>

      {rpTab==='tracking' && (
        <div>
          <div style={{ overflowX:'auto', borderRadius:8, border:`1px solid ${C.border}` }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ background:C.surface }}>
                  <th style={{ ...thSt, textAlign:'left', minWidth:170, padding:'7px 10px' }}>{lang==='en'?'Project':'Proyecto'}</th>
                  <th style={thSt}>{lang==='en'?'Dev.':'Desarro.'}</th>
                  <th style={{ ...thSt, minWidth:90 }}>{lang==='en'?'Phase':'Fase'}</th>
                  <th style={{ ...thSt, minWidth:80 }}>{lang==='en'?'Status':'Estado'}</th>
                  <th style={thSt}>%</th>
                  <th style={{ ...thSt, minWidth:72 }}>{lang==='en'?'Start':'Inicio'}</th>
                  <th style={{ ...thSt, minWidth:72 }}>{lang==='en'?'End':'Fin'}</th>
                  <th style={{ ...thSt, minWidth:72 }}>CAPEX (€)</th>
                  {MONTHS.map(m => <th key={m} style={{ ...thSt, minWidth:26, fontSize:8, padding:'4px 2px' }}>{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {proyectos.map((p,i) => {
                  const pct  = p.status==='done'?100:fasePct(p.fase)
                  const bc   = barCol(p)
                  const nom  = lang==='en'&&p.nombreEN ? p.nombreEN : p.nombre
                  const bg   = i%2===0?'transparent':C.surface+'55'
                  return (
                    <tr key={p.id||i} style={{ borderBottom:`0.5px solid ${C.border}`, background:bg }}>
                      <td style={{ ...tdSt, padding:'6px 10px', fontWeight:500, color:C.text, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={nom}>{nom}</td>
                      <td style={{ ...tdSt, textAlign:'center' }}>
                        {p.desarrollo && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:bc+'22', color:bc }}>{p.desarrollo}</span>}
                      </td>
                      <td style={{ ...tdSt, color:C.muted, whiteSpace:'nowrap', textAlign:'center' }}>{lang==='en'?faseLabel(p.fase,'en'):(p.fase||'—')}</td>
                      <td style={{ ...tdSt, textAlign:'center' }}>
                        <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:stCol(p.status)+'22', color:stCol(p.status) }}>{stLabel(p.status)}</span>
                      </td>
                      <td style={{ ...tdSt, textAlign:'center', fontWeight:700, color:C.accent }}>{pct?`${pct}%`:''}</td>
                      <td style={{ ...tdSt, color:C.muted, whiteSpace:'nowrap', textAlign:'center' }}>{p.fechaInicio?fmtFecha(fdStr(p.fechaInicio)):''}</td>
                      <td style={{ ...tdSt, color:p.fechaFin&&diasRestantes(fdStr(p.fechaFin))<0&&p.status!=='done'?'#e8001c':C.muted, whiteSpace:'nowrap', textAlign:'center' }}>{p.fechaFin?fmtFecha(fdStr(p.fechaFin)):''}</td>
                      <td style={{ ...tdSt, textAlign:'right', fontWeight:600 }}>{p.capex?Number(p.capex).toLocaleString('es'):''}</td>
                      {MONTH_STARTS.map((_,mi) => (
                        <td key={mi} style={{ padding:'2px 1px' }}>
                          {monthActive(p,mi) && <div style={{ height:12, borderRadius:2, background:bc+'55', border:`1px solid ${bc}88` }} />}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                <tr style={{ borderTop:`2px solid ${C.border}`, background:C.surface }}>
                  <td colSpan={7} style={{ padding:'7px 10px', fontWeight:700, color:C.text, fontSize:11 }}>TOTAL CAPEX</td>
                  <td style={{ padding:'7px 6px', textAlign:'right', fontWeight:700, color:C.accent, fontSize:12 }}>{totalCapex?Number(totalCapex).toLocaleString('es'):'—'}</td>
                  <td colSpan={12} />
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:C.muted }}>
              <div style={{ width:14, height:8, background:VF+'55', border:`1px solid ${VF}`, borderRadius:2 }} /> Vodafone
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:C.muted }}>
              <div style={{ width:14, height:8, background:SC+'55', border:`1px solid ${SC}`, borderRadius:2 }} /> Sercom
            </div>
            <button onClick={()=>window.print()} style={{ marginLeft:'auto', padding:'4px 12px', borderRadius:6, fontSize:11, background:'none', border:`1px solid ${C.border}`, color:C.muted, cursor:'pointer' }}>🖨 Imprimir</button>
          </div>
        </div>
      )}

      {rpTab==='ia' && (
        <div style={{ maxWidth:800 }}>
          <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center' }}>
            <span style={{ fontSize:12, color:C.muted }}>Formato:</span>
            {[{ id:'email', l:'📊 Ejecutivo dirección' },{ id:'bullets', l:'• Bullets standup' }].map(f => (
              <button key={f.id} onClick={() => setFmt(f.id)}
                style={{ padding:'5px 12px', borderRadius:6, fontSize:12, fontWeight:600, border:`1px solid ${C.border}`,
                  background:fmt===f.id?C.accent+'22':C.card, color:fmt===f.id?C.accent:C.muted, cursor:'pointer' }}>{f.l}</button>
            ))}
          </div>
          <Btn onClick={generar} disabled={busy} style={{ marginBottom:20 }}>{busy?'⏳ Generando…':'📋 Generar reporte'}</Btn>
          {txt && (
            <div>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:22, marginBottom:12,
                whiteSpace:'pre-wrap', fontSize:13, lineHeight:1.85, color:C.text, maxHeight:480, overflowY:'auto' }}>{txt}</div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn v="sec" onClick={copiar}>{copied?'✓ Copiado':'📋 Copiar'}</Btn>
                <Btn v="ghost" onClick={generar} disabled={busy}>↻ Regenerar</Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Histórico ─────────────────────────────────────────────────────────────────
const Historico = ({ items }) => {
  const [q, setQ] = useState('')
  const [prioF, setPrioF] = useState('')
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  const isMobile = w < 768

  useEffect(() => {
    const h = () => setW(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const archived = items.filter(i => isArchived(i))
  const filtered = archived.filter(i => {
    const mq = !q || norm(i.tema).includes(norm(q)) || norm(i.propietario||'').includes(norm(q))
    const mp = !prioF || i.prioridad === prioF
    return mq && mp
  }).sort((a,b) => getDoneTs(b.id) - getDoneTs(a.id))

  const byMonth = {}
  filtered.forEach(i => {
    const d   = new Date(getDoneTs(i.id))
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    const lbl = d.toLocaleString('es', { month:'long', year:'numeric' })
    if (!byMonth[key]) byMonth[key] = { lbl, items:[] }
    byMonth[key].items.push(i)
  })

  const inputSt = { background:C.surface, border:`1px solid ${C.border}`, color:C.text, borderRadius:7, padding:'6px 10px', fontSize:12, outline:'none' }

  return (
    <div style={{ padding:isMobile?'0 12px 24px':'0 24px 32px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:isMobile?8:12, marginBottom:16, flexWrap:'wrap' }}>
        <div>
          <h2 style={{ margin:0, fontSize:isMobile?16:18, fontWeight:700, color:C.text }}>⧆ Histórico</h2>
          <p style={{ margin:0, fontSize:isMobile?11:12, color:C.muted, marginTop:2 }}>Temas completados hace más de 7 días · {archived.length} total</p>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:isMobile?6:8, flexWrap:'wrap' }}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar…" style={{ ...inputSt, width:isMobile?'100%':180, fontSize:isMobile?14:12 }} />
          <select value={prioF} onChange={e=>setPrioF(e.target.value)} style={{ ...inputSt, cursor:'pointer', fontSize:isMobile?14:12 }}>
            <option value="">Todas las prioridades</option>
            {PRIORIDADES.filter(Boolean).map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign:'center', padding:isMobile?'40px 0':'60px 0', color:C.muted }}>
          <div style={{ fontSize:isMobile?32:36, marginBottom:10 }}>📭</div>
          <div style={{ fontSize:isMobile?13:14, fontWeight:600, marginBottom:3 }}>Sin items en el histórico</div>
          <div style={{ fontSize:isMobile?11:12 }}>Los temas completados aparecerán aquí tras 7 días en "Completados"</div>
        </div>
      )}

      {Object.keys(byMonth).sort((a,b) => b.localeCompare(a)).map(key => (
        <div key={key} style={{ marginBottom:isMobile?16:24 }}>
          <div style={{ fontSize:isMobile?10:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6, paddingBottom:4, borderBottom:`1px solid ${C.border}` }}>
            {byMonth[key].lbl} · {byMonth[key].items.length} tema{byMonth[key].items.length!==1?'s':''}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:isMobile?3:4 }}>
            {byMonth[key].items.map(item => {
              const pc = priColor(item.prioridad)
              const oc = ownerColor(item.propietario)
              const doneDate = new Date(getDoneTs(item.id)).toLocaleDateString('es', { day:'numeric', month:'short' })
              return (
                <div key={item.id} style={{ display:'flex', alignItems:'center', gap:isMobile?6:10, background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:isMobile?'6px 10px':'8px 12px', opacity:0.85 }}>
                  <div style={{ width:14, height:14, borderRadius:'50%', background:'#10b98122', border:'1.5px solid #10b981', display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, color:'#10b981', flexShrink:0 }}>✓</div>
                  {item.prioridad && <span style={{ fontSize:8, fontWeight:700, padding:'1px 4px', borderRadius:2, background:pc.bg, color:pc.color, flexShrink:0 }}>{item.prioridad}</span>}
                  <span style={{ fontSize:isMobile?12:13, color:C.text, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.tema}</span>
                  {!isMobile && item.proyecto && <span style={{ fontSize:11, color:C.muted, flexShrink:0, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.proyecto}</span>}
                  {item.propietario && (
                    <div style={{ width:18, height:18, borderRadius:'50%', background:oc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:6, fontWeight:700, color:'#fff', flexShrink:0 }} title={item.propietario}>
                      {iniciales(item.propietario)}
                    </div>
                  )}
                  <span style={{ fontSize:isMobile?9:10, color:C.muted, flexShrink:0 }}>✓ {doneDate}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Cristina (Reporte Ejecutivo) ───────────────────────────────────────────────
const Cristina = ({ items = [], proyectos = [], idioma = 'ES' }) => {
  // Filtrar solo items de Juangas
  const juanItems = items.filter(i =>
    i.propietario?.includes('Juan') || i.propietario?.includes('Juangas')
  );

  // ────────────────────────────────────────────────────────────────
  // CÁLCULOS BÁSICOS
  // ────────────────────────────────────────────────────────────────

  const hoy = new Date();
  const inicioSemana = new Date(hoy);
  inicioSemana.setDate(hoy.getDate() - hoy.getDay()); // Lunes

  // Status rápido
  const onTrack = juanItems.filter(i => i.estado === 'inprogress').length;
  const enPeligro = juanItems.filter(i => i.estado === 'blocked').length;
  const completados = juanItems.filter(i => i.estado === 'done').length;
  const total = juanItems.length;

  // Lo que cerró esta semana (estado === done Y completedAt >= lunes)
  const cerradosEstaSemana = juanItems.filter(i => {
    if (i.estado !== 'done') return false;
    // Si tienes timestamp de completado, usarlo; si no, aproximar por notas
    return true; // TODO: ajustar con tu lógica de timestamps
  });

  // Riesgos y blockers (estado bloqueado + P0/P1)
  const riesgos = juanItems.filter(i =>
    i.estado === 'blocked' || (i.estado === 'inprogress' && (i.prioridad === 'P0' || i.prioridad === 'P1'))
  );

  // Próximos 7 días (estado !== done Y fechaFin < hoy+7d)
  const proximosSieteDias = juanItems.filter(i => {
    if (i.estado === 'done') return false;
    if (!i.fechaFin) return false;
    const fecha = new Date(i.fechaFin);
    return fecha >= hoy && fecha <= new Date(hoy.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  // Temas P0/P1 en curso o bloqueados
  const temasAltos = juanItems.filter(i =>
    (i.prioridad === 'P0' || i.prioridad === 'P1') &&
    (i.estado === 'inprogress' || i.estado === 'blocked')
  );

  // ────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────

  const labels = {
    ES: {
      titulo: 'Reporte para Cristina',
      statusRapido: 'STATUS RÁPIDO',
      onTrack: 'En curso',
      enPeligro: 'En peligro',
      completados: 'Completados',
      estaSemana: 'ESTA SEMANA',
      cerrado: 'Cerrado',
      riesgos: 'RIESGOS / BLOCKERS',
      proximaSemana: 'PRÓXIMA SEMANA (TOP 3)',
      noData: 'Sin datos',
      sinRiesgos: 'Sin riesgos identificados ✅',
      sincronizando: 'Datos de Supabase en tiempo real',
    },
    EN: {
      titulo: 'Report for Cristina',
      statusRapido: 'QUICK STATUS',
      onTrack: 'In progress',
      enPeligro: 'At risk',
      completados: 'Completed',
      estaSemana: 'THIS WEEK',
      cerrado: 'Completed',
      riesgos: 'RISKS / BLOCKERS',
      proximaSemana: 'NEXT WEEK (TOP 3)',
      noData: 'No data',
      sinRiesgos: 'No risks identified ✅',
      sincronizando: 'Real-time data from Supabase',
    }
  };

  const t = labels[idioma] || labels.ES;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div style={{
      padding: isMobile ? '1rem' : '2rem',
      maxWidth: '100%',
      width: '100%',
      margin: '0 auto',
      fontFamily: '"Inter", -apple-system, sans-serif',
      color: '#1f2937',
      background: '#f9fafb',
      minHeight: '100vh',
      boxSizing: 'border-box'
    }}>

      {/* HEADER */}
      <div style={{ marginBottom: isMobile ? '1.5rem' : '2rem', paddingBottom: isMobile ? '0.75rem' : '1rem', borderBottom: '1px solid #e5e7eb' }}>
        <h1 style={{
          fontSize: isMobile ? '1.5rem' : '2rem',
          fontWeight: '700',
          margin: '0 0 0.25rem 0',
          color: '#000',
          lineHeight: '1.2'
        }}>
          {t.titulo}
        </h1>
        <p style={{
          fontSize: isMobile ? '0.75rem' : '0.875rem',
          color: '#6b7280',
          margin: 0,
          wordBreak: 'break-word'
        }}>
          📊 {t.sincronizando} • {hoy.toLocaleTimeString(idioma === 'ES' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* GRID PRINCIPAL - Mobile: 1 col, Tablet: 2 col, Desktop: 3 col */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : window.innerWidth < 1024 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
        gap: isMobile ? '1rem' : '1.5rem',
        marginBottom: isMobile ? '1.5rem' : '2rem'
      }}>

        {/* CARD 1: STATUS RÁPIDO */}
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
          padding: isMobile ? '1rem' : '1.5rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}>
          <h2 style={{
            fontSize: isMobile ? '0.75rem' : '0.875rem',
            fontWeight: '600',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            margin: '0 0 0.75rem 0'
          }}>
            {t.statusRapido}
          </h2>
          <div style={{ display: 'flex', gap: isMobile ? '0.75rem' : '1rem', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#6b7280', fontSize: isMobile ? '0.75rem' : '0.875rem' }}>{t.onTrack}</span>
              <span style={{
                fontSize: isMobile ? '1.5rem' : '1.875rem',
                fontWeight: '700',
                color: '#3b82f6'
              }}>
                {onTrack}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#6b7280', fontSize: isMobile ? '0.75rem' : '0.875rem' }}>{t.enPeligro}</span>
              <span style={{
                fontSize: isMobile ? '1.5rem' : '1.875rem',
                fontWeight: '700',
                color: enPeligro > 0 ? '#ef4444' : '#10b981'
              }}>
                {enPeligro}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#6b7280', fontSize: isMobile ? '0.75rem' : '0.875rem' }}>{t.completados}</span>
              <span style={{
                fontSize: isMobile ? '1.5rem' : '1.875rem',
                fontWeight: '700',
                color: '#10b981'
              }}>
                {completados}
              </span>
            </div>
            <div style={{
              marginTop: isMobile ? '0.5rem' : '0.75rem',
              paddingTop: isMobile ? '0.5rem' : '0.75rem',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: isMobile ? '0.75rem' : '0.875rem'
            }}>
              <span style={{ fontWeight: '600', color: '#000' }}>Total</span>
              <span style={{ fontWeight: '600', color: '#000' }}>{total}</span>
            </div>
          </div>
        </div>

        {/* CARD 2: ESTA SEMANA */}
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
          padding: isMobile ? '1rem' : '1.5rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}>
          <h2 style={{
            fontSize: isMobile ? '0.75rem' : '0.875rem',
            fontWeight: '600',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            margin: '0 0 0.75rem 0'
          }}>
            {t.estaSemana}
          </h2>
          {cerradosEstaSemana.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {cerradosEstaSemana.slice(0, isMobile ? 2 : 3).map(item => (
                <li key={item.id} style={{
                  fontSize: isMobile ? '0.75rem' : '0.875rem',
                  padding: '0.5rem 0',
                  color: '#374151',
                  display: 'flex',
                  gap: '0.5rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  <span style={{ color: '#10b981', flexShrink: 0 }}>✓</span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.tema}</span>
                </li>
              ))}
              {cerradosEstaSemana.length > (isMobile ? 2 : 3) && (
                <li style={{
                  fontSize: '0.65rem',
                  color: '#9ca3af',
                  borderTop: '1px solid #e5e7eb',
                  marginTop: '0.5rem',
                  paddingTop: '0.5rem'
                }}>
                  +{cerradosEstaSemana.length - (isMobile ? 2 : 3)} más
                </li>
              )}
            </ul>
          ) : (
            <p style={{ color: '#9ca3af', fontSize: isMobile ? '0.75rem' : '0.875rem', margin: 0 }}>
              {t.noData}
            </p>
          )}
        </div>

        {/* CARD 3: PRÓXIMA SEMANA */}
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
          padding: isMobile ? '1rem' : '1.5rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}>
          <h2 style={{
            fontSize: isMobile ? '0.75rem' : '0.875rem',
            fontWeight: '600',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            margin: '0 0 0.75rem 0'
          }}>
            {t.proximaSemana}
          </h2>
          {proximosSieteDias.length > 0 ? (
            <ol style={{ margin: 0, padding: isMobile ? '0 0 0 1rem' : '0 0 0 1.5rem', fontSize: isMobile ? '0.75rem' : '0.875rem' }}>
              {proximosSieteDias.slice(0, isMobile ? 2 : 3).map((item, idx) => (
                <li key={item.id} style={{
                  padding: '0.5rem 0',
                  color: '#374151',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.tema}</strong>
                  <span style={{ fontSize: isMobile ? '0.65rem' : '0.75rem', color: '#6b7280' }}>
                    🎯 {item.prioridad || '—'}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p style={{ color: '#9ca3af', fontSize: isMobile ? '0.75rem' : '0.875rem', margin: 0 }}>
              {t.noData}
            </p>
          )}
        </div>

      </div>

      {/* SECCIÓN RIESGOS (ANCHO COMPLETO) */}
      <div style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '0.5rem',
        padding: isMobile ? '1rem' : '1.5rem',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}>
        <h2 style={{
          fontSize: isMobile ? '0.75rem' : '0.875rem',
          fontWeight: '600',
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: '0 0 0.75rem 0'
        }}>
          ⚠️  {t.riesgos}
        </h2>
        {riesgos.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))', gap: isMobile ? '0.75rem' : '1rem' }}>
            {riesgos.slice(0, isMobile ? 3 : undefined).map(item => (
              <div key={item.id} style={{
                background: item.estado === 'blocked' ? '#fef2f2' : '#fffbeb',
                border: `1px solid ${item.estado === 'blocked' ? '#fecaca' : '#fde68a'}`,
                borderLeft: `4px solid ${item.prioridad === 'P0' ? '#dc2626' : '#f59e0b'}`,
                borderRadius: '0.375rem',
                padding: isMobile ? '0.75rem' : '1rem',
                fontSize: isMobile ? '0.75rem' : '0.875rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem', gap: '0.5rem' }}>
                  <strong style={{ color: '#1f2937', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-word' }}>{item.tema}</strong>
                  <span style={{
                    fontSize: isMobile ? '0.65rem' : '0.75rem',
                    fontWeight: '600',
                    color: item.prioridad === 'P0' ? '#dc2626' : '#d97706',
                    background: item.prioridad === 'P0' ? '#fee2e2' : '#fef3c7',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '0.25rem',
                    flexShrink: 0,
                    whiteSpace: 'nowrap'
                  }}>
                    {item.prioridad}
                  </span>
                </div>
                {item.notas && (
                  <p style={{ margin: '0.5rem 0 0 0', color: '#6b7280', fontSize: isMobile ? '0.7rem' : '0.8125rem', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {item.notas}
                  </p>
                )}
                {item.fechaFin && (
                  <p style={{ margin: '0.5rem 0 0 0', color: '#9ca3af', fontSize: isMobile ? '0.65rem' : '0.75rem' }}>
                    📅 {new Date(item.fechaFin).toLocaleDateString(idioma === 'ES' ? 'es-ES' : 'en-US')}
                  </p>
                )}
              </div>
            ))}
            {isMobile && riesgos.length > 3 && (
              <div style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.75rem', textAlign: 'center', borderTop: '1px solid #e5e7eb' }}>
                +{riesgos.length - 3} riesgos más
              </div>
            )}
          </div>
        ) : (
          <div style={{
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '0.375rem',
            padding: isMobile ? '0.75rem' : '1rem',
            color: '#166534',
            textAlign: 'center',
            fontSize: isMobile ? '0.75rem' : '0.875rem'
          }}>
            {t.sinRiesgos}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{
        marginTop: isMobile ? '1.5rem' : '2rem',
        paddingTop: isMobile ? '0.75rem' : '1rem',
        borderTop: '1px solid #e5e7eb',
        fontSize: isMobile ? '0.65rem' : '0.75rem',
        color: '#9ca3af',
        textAlign: 'center',
        overflow: 'hidden'
      }}>
        <p style={{ margin: 0, wordBreak: 'break-word' }}>
          👤 {idioma === 'ES' ? 'Datos de' : 'Data from'} Juan Rodriguez • {idioma === 'ES' ? 'Realtime' : 'Real-time'}
        </p>
      </div>
    </div>
  );
};

// ── Main App ──────────────────────────────────────────────────────────────────

// ── NuevoTema ─────────────────────────────────────────────────────────────────
const NuevoTema = ({ onAdd, onClose, proyectoNames = [] }) => {
  const [tema,   setTema]   = useState('')
  const [obj,    setObj]    = useState('')
  const [cat,    setCat]    = useState('projects')
  const [prop,   setProp]   = useState('')
  const [prio,   setPrio]   = useState('')
  const [proy,   setProy]   = useState('')

  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  const crear = () => {
    if (!tema.trim()) return
    const newItem = {
      id: uid(), tema: tema.trim(), objetivo: obj.trim(),
      category: cat, propietario: prop.trim(),
      prioridad: prio, risk: mapRisk(prio),
      status: 'pending', estadoSheet: 'No iniciado',
      fechaInicio: null, fechaFin: null,
      archivos: '', notas: '', proyecto: proy,
      subtareas: [], _local: true,
    }
    onAdd(newItem)
    // Notify assigned user (fire-and-forget)
    if (prop.trim()) notifyAssignment({
      tema: newItem.tema, propietario: prop.trim(),
      descripcion: obj.trim(),
      categoria: CATS.find(c => c.id === cat)?.label || cat,
      prioridad: prio,
    })
    onClose()
  }

  const iSt = { background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:6,
    padding:'7px 10px', fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' }

  return (
    <div style={{ position:'fixed', inset:0, background:'#00000099', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`,
        width:'100%', maxWidth:520, boxShadow:'0 8px 40px rgba(0,0,0,.15)',
        animation:'modalProjIn 200ms cubic-bezier(0.23,1,0.32,1) both' }}>
        <style>{`@keyframes modalProjIn{from{opacity:0;transform:scale(0.96) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
        {/* Header */}
        <div style={{ padding:'16px 20px 14px', borderBottom:`1px solid ${C.border}`, background:C.card,
          borderRadius:'14px 14px 0 0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:15, fontWeight:700, color:C.text }}>+ Nuevo tema</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:20 }}>✕</button>
        </div>
        {/* Body */}
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <Lbl>Tema *</Lbl>
            <input value={tema} onChange={e=>setTema(e.target.value)}
              placeholder="Nombre del tema…" autoFocus
              onKeyDown={e => e.key==='Enter' && !e.shiftKey && crear()}
              style={iSt} />
          </div>
          <div>
            <Lbl>Objetivo</Lbl>
            <textarea value={obj} onChange={e=>setObj(e.target.value)}
              placeholder="¿Qué se quiere conseguir?" rows={2}
              style={{ ...iSt, resize:'vertical', fontFamily:'inherit' }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <Lbl>Categoría</Lbl>
              <select value={cat} onChange={e=>setCat(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                {CATS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <Lbl>Prioridad</Lbl>
              <select value={prio} onChange={e=>setPrio(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                <option value="">Sin prioridad</option>
                {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <Lbl>Responsable</Lbl>
              <input list="owners-nuevo" value={prop} onChange={e=>setProp(e.target.value)}
                placeholder="Nombre…" style={iSt} />
              <datalist id="owners-nuevo">{KNOWN_OWNERS.map(o=><option key={o} value={o}/>)}</datalist>
            </div>
            <div>
              <Lbl>Proyecto</Lbl>
              <select value={proy} onChange={e=>setProy(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                <option value="">Sin proyecto</option>
                {proyectoNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>
        {/* Footer */}
        <div style={{ padding:'12px 20px', borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'flex-end', gap:8 }}>
          <Btn v="sec" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={crear} disabled={!tema.trim()}>Crear tema</Btn>
        </div>
      </div>
    </div>
  )
}

// ── ModalItem ─────────────────────────────────────────────────────────────────
const ModalItem = ({ item: itemOrig, onClose, onItemChange, proyectoNames = [], onToast }) => {
  const [item,    setItem]    = useState(itemOrig)
  const [editing, setEditing] = useState(false)
  const [nc,      setNc]      = useState('')
  const [comments, setComments] = useState(() => getComments(norm(itemOrig.tema)))

  // Edit state
  const [eTema,  setETema]  = useState(itemOrig.tema || '')
  const [eObj,   setEObj]   = useState(itemOrig.objetivo || '')
  const [eSt,    setESt]    = useState(itemOrig.status || 'pending')
  const [eProp,  setEProp]  = useState(itemOrig.propietario || '')
  const [ePrio,  setEPrio]  = useState(itemOrig.prioridad || '')
  const [eFin,   setEFin]   = useState(itemOrig.fechaFin ? fdStr(itemOrig.fechaFin) : '')
  const [eNotas, setENotas] = useState(itemOrig.notas || '')
  const [eProy,  setEProy]  = useState(itemOrig.proyecto || '')
  const [eCat,   setECat]   = useState(itemOrig.category || 'projects')
  const [subtareas, setSubtareas] = useState(Array.isArray(itemOrig.subtareas) ? itemOrig.subtareas : [])
  const [newSub, setNewSub] = useState('')

  useEffect(() => {
    const h = e => e.key === 'Escape' && (editing ? setEditing(false) : onClose())
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [editing])

  const guardar = () => {
    const fechaFinParsed = eFin ? new Date(eFin + 'T12:00') : null
    const fields = {
      tema:       eTema.trim(),
      objetivo:   eObj.trim(),
      status:     eSt,
      estadoSheet: ST_TO_SHEET[eSt] || 'No iniciado',
      propietario: eProp.trim(),
      prioridad:  ePrio,
      risk:       mapRisk(ePrio),
      fechaFin:   fechaFinParsed,
      notas:      eNotas.trim(),
      proyecto:   eProy,
      category:   eCat,
      subtareas,
    }
    onItemChange(item.id, fields)
    if (eSt === 'done') saveDoneTs(item.id)
    const updated = { ...item, ...fields, _hasLocal: true }
    setItem(updated)
    onItemChange(item.id, fields, true)
    setEditing(false)
    onToast?.('Cambios guardados')
    // Notify if propietario was just assigned or changed
    const prevProp = norm(item.propietario || '')
    const newProp  = norm(eProp.trim())
    if (newProp && newProp !== prevProp) {
      notifyAssignment({
        tema: eTema.trim(), propietario: eProp.trim(),
        descripcion: eObj.trim(),
        categoria: CATS.find(c => c.id === eCat)?.label || eCat,
        prioridad: ePrio,
      })
    }
  }

  const agregarComentario = () => {
    const text = nc.trim()
    if (!text) return
    const c = saveComment(norm(item.tema), text)
    setComments(prev => [c, ...prev])
    setNc('')
  }

  const cat     = CATS.find(c => c.id === item.category)
  const stInfo  = ST.find(s => s.id === item.status)
  const pc      = priColor(item.prioridad)
  const oc      = ownerColor(item.propietario)

  const iSt = { background:C.card, color:C.text, border:`1px solid ${C.border}`, borderRadius:6,
    padding:'6px 9px', fontSize:12, outline:'none', width:'100%', boxSizing:'border-box' }

  return (
    <div style={{ position:'fixed', inset:0, background:'#00000099', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <style>{`
        @keyframes modalItemIn{from{opacity:0;transform:scale(0.96) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
        .mi-tab-btn{transition:color 150ms,border-color 150ms}
      `}</style>
      <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`,
        width:'100%', maxWidth:640, maxHeight:'92vh', overflow:'hidden',
        display:'flex', flexDirection:'column',
        animation:'modalItemIn 200ms cubic-bezier(0.23,1,0.32,1) both',
        boxShadow:'0 8px 40px rgba(0,0,0,.15)' }}>

        {/* Header */}
        <div style={{ padding:'14px 18px 12px', borderBottom:`1px solid ${C.border}`,
          background:C.card, borderRadius:'14px 14px 0 0' }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:4 }}>
                {cat && <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:3,
                  background:cat.bg, color:cat.color, textTransform:'uppercase' }}>{cat.label}</span>}
                {stInfo && <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:3,
                  background:stInfo.color+'22', color:stInfo.color, textTransform:'uppercase' }}>{stInfo.label}</span>}
                {item.prioridad && <span style={{ fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:3,
                  background:pc.bg, color:pc.color }}>{item.prioridad}</span>}
                {item._hasLocal && <span style={{ fontSize:9, color:'#fbbf24', background:'#fbbf2411',
                  border:'1px solid #fbbf2433', padding:'1px 5px', borderRadius:3, fontWeight:700 }}>~local</span>}
              </div>
              <h3 style={{ fontSize:15, fontWeight:700, color:C.text, margin:0, lineHeight:1.3 }}>{item.tema}</h3>
              {item.proyecto && <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>📁 {item.proyecto}</div>}
            </div>
            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
              {!editing
                ? <button onClick={() => setEditing(true)}
                    style={{ background:C.surface, border:`1px solid ${C.border}`, color:C.muted,
                      borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>Editar</button>
                : <>
                    <button onClick={guardar}
                      style={{ background:C.accent, border:'none', color:'#fff',
                        borderRadius:6, padding:'4px 12px', fontSize:11, fontWeight:600, cursor:'pointer' }}>Guardar</button>
                    <button onClick={() => setEditing(false)}
                      style={{ background:'none', border:`1px solid ${C.border}`, color:C.muted,
                        borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer' }}>Cancelar</button>
                  </>}
              <button onClick={onClose}
                style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:20, padding:0 }}>✕</button>
            </div>
          </div>

          {/* Meta row - view mode */}
          {!editing && (
            <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:8, flexWrap:'wrap' }}>
              {item.propietario && (
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <div style={{ width:18, height:18, borderRadius:'50%', background:oc,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:7, fontWeight:700, color:'#fff' }}>{iniciales(item.propietario)}</div>
                  <span style={{ fontSize:11, color:C.muted }}>{item.propietario.split(' ')[0]}</span>
                </div>
              )}
              {item.fechaFin && <span style={{ fontSize:11, color:C.muted }}>
                Fin: <AlertFecha endDate={item.fechaFin} status={item.status} /></span>}
              {item.archivos && <span style={{ fontSize:11, color:C.accent, cursor:'pointer' }}>📎 Archivos</span>}
            </div>
          )}

          {/* Edit form */}
          {editing && (
            <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:8 }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Tema</div>
                <input value={eTema} onChange={e=>setETema(e.target.value)} style={iSt} />
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Objetivo</div>
                <textarea value={eObj} onChange={e=>setEObj(e.target.value)} rows={2}
                  style={{ ...iSt, resize:'vertical', fontFamily:'inherit' }} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Estado</div>
                  <select value={eSt} onChange={e=>setESt(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                    {ST.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Prioridad</div>
                  <select value={ePrio} onChange={e=>setEPrio(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                    <option value="">Sin prioridad</option>
                    {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Fecha fin</div>
                  <input type="date" value={eFin} onChange={e=>setEFin(e.target.value)}
                    style={{ ...iSt, colorScheme:'light' }} />
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Categoría</div>
                  <select value={eCat} onChange={e=>setECat(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                    {CATS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Responsable</div>
                  <input list="owners-mi-edit" value={eProp} onChange={e=>setEProp(e.target.value)}
                    placeholder="Nombre…" style={iSt} />
                  <datalist id="owners-mi-edit">{KNOWN_OWNERS.map(o=><option key={o} value={o}/>)}</datalist>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Proyecto</div>
                  <select value={eProy} onChange={e=>setEProy(e.target.value)} style={{ ...iSt, cursor:'pointer' }}>
                    <option value="">Sin proyecto</option>
                    {proyectoNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', marginBottom:3 }}>Notas</div>
                <textarea value={eNotas} onChange={e=>setENotas(e.target.value)} rows={2}
                  style={{ ...iSt, resize:'vertical', fontFamily:'inherit' }} />
              </div>
            </div>
          )}
        </div>

        {/* Body - view mode */}
        {!editing && (
          <div style={{ flex:1, overflowY:'auto', padding:18 }}>
            {item.objetivo && (
              <div style={{ marginBottom:14 }}>
                <Lbl>Objetivo</Lbl>
                <p style={{ fontSize:13, color:C.text, lineHeight:1.7, margin:0,
                  background:C.card, borderRadius:8, padding:10 }}>{item.objetivo}</p>
              </div>
            )}
            {item.notas && (
              <div style={{ marginBottom:14 }}>
                <Lbl>Notas</Lbl>
                <p style={{ fontSize:13, color:C.text, lineHeight:1.7, margin:0,
                  background:C.card, borderRadius:8, padding:10, whiteSpace:'pre-wrap' }}>{item.notas}</p>
              </div>
            )}

            {/* Subtareas */}
            <div style={{ marginBottom:14 }}>
              <Lbl>Subtareas ({subtareas.length})</Lbl>
              <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:6 }}>
                {subtareas.map(sub => {
                  const done = sub.status === 'done'
                  return (
                    <div key={sub.id} style={{ display:'flex', alignItems:'center', gap:8, background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 10px' }}>
                      <button
                        onClick={() => {
                          const updated = subtareas.map(s => s.id===sub.id ? {...s, status: done?'pending':'done'} : s)
                          setSubtareas(updated)
                          onItemChange(item.id, { subtareas: updated })
                        }}
                        style={{ width:16, height:16, borderRadius:4, border:`2px solid ${done?'#10b981':C.border}`, background: done?'#10b981':'transparent', cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>
                        {done && <span style={{ color:'#fff', fontSize:10, fontWeight:700 }}>✓</span>}
                      </button>
                      <span style={{ fontSize:12, flex:1, color: done?C.muted:C.text, textDecoration: done?'line-through':'none' }}>{sub.title}</span>
                      {sub.prop && <span style={{ fontSize:10, color:C.muted }}>{sub.prop.split(' ')[0]}</span>}
                      <button onClick={() => {
                          const updated = subtareas.filter(s => s.id !== sub.id)
                          setSubtareas(updated)
                          onItemChange(item.id, { subtareas: updated })
                        }}
                        style={{ background:'none', border:'none', color:'#fca5a5', cursor:'pointer', fontSize:14, lineHeight:1, padding:'0 2px', flexShrink:0 }}>✕</button>
                    </div>
                  )
                })}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <input value={newSub} onChange={e => setNewSub(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newSub.trim()) {
                    const updated = [...subtareas, { id:uid(), title:newSub.trim(), status:'pending', prop:'', risk:'green', fechaFin:null, notas:'' }]
                    setSubtareas(updated); setNewSub(''); onItemChange(item.id, { subtareas: updated })
                  }}}
                  placeholder="Nueva subtarea… (Enter para añadir)"
                  style={{ flex:1, background:C.card, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 10px', fontSize:12, outline:'none' }} />
                <button onClick={() => {
                    if (!newSub.trim()) return
                    const updated = [...subtareas, { id:uid(), title:newSub.trim(), status:'pending', prop:'', risk:'green', fechaFin:null, notas:'' }]
                    setSubtareas(updated); setNewSub(''); onItemChange(item.id, { subtareas: updated })
                  }}
                  style={{ padding:'6px 12px', borderRadius:6, background:C.surface, border:`1px solid ${C.border}`, color:C.muted, fontSize:12, cursor:'pointer', fontWeight:600 }}>+ Add</button>
              </div>
            </div>

            {/* Comments */}
            <div>
              <Lbl>Comentarios ({comments.length})</Lbl>
              <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                <input value={nc} onChange={e=>setNc(e.target.value)}
                  placeholder="Añadir comentario…"
                  onKeyDown={e => e.key==='Enter' && agregarComentario()}
                  style={{ flex:1, background:C.card, color:C.text, border:`1px solid ${C.border}`,
                    borderRadius:6, padding:'7px 10px', fontSize:12, outline:'none' }} />
                <Btn v="sec" onClick={agregarComentario} style={{ padding:'7px 12px', fontSize:12 }}>Enviar</Btn>
              </div>
              {comments.map(c => (
                <div key={c.id} style={{ background:C.card, border:`1px solid ${C.border}`,
                  borderRadius:8, padding:'8px 12px', marginBottom:6 }}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:3 }}>{c.ts}</div>
                  <div style={{ fontSize:12, color:C.text, lineHeight:1.6 }}>{c.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding:'10px 18px', borderTop:`1px solid ${C.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <button
            onClick={() => {
              if (!window.confirm('¿Eliminar este tema del tablero local?')) return
              onItemChange(item.id, { status:'done', _deleted:true })
              onItemChange(item.id, { status:'done', _deleted:true })
              onClose()
            }}
            style={{ background:'none', border:'none', color:'#f43f5e', fontSize:12,
              cursor:'pointer', padding:'4px 0', fontWeight:600 }}>
            Eliminar local
          </button>
          <Btn v="sec" onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Intake Modal ────────────────────────────────────────────────────────────
const IntakeModal = ({ onClose, onExecute, onToast }) => {
  const [processing, setProcessing] = useState(false)

  const handleExecute = async () => {
    setProcessing(true)
    try {
      // Ejecutar comando npm run process-intake
      // En desarrollo, mostramos instrucciones
      onToast('📂 Para procesar archivos, ejecuta en terminal: npm run process-intake')
      onExecute()
    } catch (e) {
      onToast('⚠ Error: ' + e.message)
    } finally {
      setProcessing(false)
      onClose()
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#00000099', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, maxWidth:500, width:'100%', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:20 }}>🔄</span>
          <h2 style={{ fontSize:16, fontWeight:700, color:C.text, margin:0, flex:1 }}>Procesar Carpeta de Intake</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:C.muted }}>✕</button>
        </div>

        <div style={{ padding:'20px', fontSize:13, lineHeight:1.7 }}>
          <p style={{ color:C.text, marginBottom:12, fontWeight:600 }}>📂 Ubicación de archivos:</p>
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:12, fontFamily:'monospace', fontSize:11, color:C.muted, marginBottom:16, wordBreak:'break-all', lineHeight:1.5 }}>
            C:\Users\Juan Rodriguez\OneDrive - Sercom Soluciones S.L\Escritorio\Pendientes Juan - Seguimiento NO borrar
          </div>

          <p style={{ color:C.text, marginBottom:8, fontWeight:600 }}>📋 Formatos soportados:</p>
          <div style={{ color:C.muted, marginBottom:16 }}>
            ✓ .eml (emails exportados)<br/>
            ✓ .md (notas markdown)<br/>
            ✓ .txt (texto plano)<br/>
            (PDF y Excel requieren config adicional)
          </div>

          <p style={{ color:C.text, marginBottom:8, fontWeight:600 }}>⚙️ Ejecución:</p>
          <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:12, color:'#166534', fontSize:11, fontFamily:'monospace', marginBottom:16, lineHeight:1.6 }}>
            npm run process-intake
          </div>

          <p style={{ color:C.muted, fontSize:12, marginBottom:0 }}>
            💡 El script leerá la carpeta, analizará cada archivo con Claude y actualizará automáticamente los temas/proyectos correspondientes en OpsBoard.
          </p>
        </div>

        <div style={{ padding:'12px 20px', borderTop:`1px solid ${C.border}`, display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Btn v="sec" onClick={onClose}>Cerrar</Btn>
          <Btn onClick={handleExecute} disabled={processing}>
            {processing ? '⏳ Procesando...' : '▶ Ejecutar ahora'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

export default function OpsBoard() {
  const [vista,       setVista]      = useState('Dashboard')
  const [lang,        setLang]       = useState('es')
  const [items,       setItems]      = useState([])
  const [campanas,    setCampanas]   = useState([])
  const [proyectos,   setProyectos]  = useState([])
  const realtimeSub = useRef(null)
  const [loading,     setLoading]    = useState(true)
  const [error,       setError]      = useState(null)
  const [lastUpd,     setLastUpd]    = useState(null)
  const [itemActivo,  setItemActivo] = useState(null)
  const [showNuevo,   setShowNuevo]  = useState(false)
  const [catF,        setCatF]       = useState('all')
  const [asF,         setAsF]        = useState('all')
  const [modo,        setModo]       = useState('kanban')
  const [toast,       setToast]      = useState(null)
  const [showIntake,  setShowIntake] = useState(false)
  const [intakeLog,   setIntakeLog]  = useState(null)

  const allItems = items.filter(i => !i._deleted)
  const owners   = [...new Set(allItems.map(i => i.propietario).filter(Boolean))]

  const loadData = async () => {
    setLoading(true); setError(null)
    try {
      const { items: fetched, campanas: fetchedCamps, proyectos: fetchedProys } = await fetchAll()
      setItems(fetched)
      setCampanas(fetchedCamps)
      setProyectos(fetchedProys)
      setLastUpd(new Date())
    } catch (e) {
      setError(e.message || String(e))
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // Real-time subscription — any change in Supabase updates all users instantly
    const sub = supabase
      .channel('items-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, payload => {
        if (payload.eventType === 'INSERT') {
          setItems(prev => [dbToItem(payload.new), ...prev.filter(i => i.id !== payload.new.id)])
        } else if (payload.eventType === 'UPDATE') {
          setItems(prev => prev.map(i => i.id === payload.new.id ? dbToItem(payload.new) : i))
        } else if (payload.eventType === 'DELETE') {
          setItems(prev => prev.filter(i => i.id !== payload.old.id))
        }
      })
      .subscribe()
    realtimeSub.current = sub
    return () => { supabase.removeChannel(sub) }
  }, [])

  const addLocalItem = async item => {
    const { error } = await supabase.from('items').insert([itemToDb(item)])
    if (error) { setToast('⚠ Error al guardar: ' + error.message); return }
    setItems(prev => [item, ...prev])
    setToast('✓ Tarea guardada')
  }
  const addLocalItems = async newItems => {
    const rows = newItems.map(itemToDb)
    const { error } = await supabase.from('items').insert(rows)
    if (error) { setToast('⚠ Error al guardar: ' + error.message); return }
    setItems(prev => [...newItems, ...prev])
    setToast('✓ ' + newItems.length + ' tarea(s) guardadas')
  }

  const onItemChange = (id, fields) => {
    // Optimistic update
    setItems(prev => prev.map(i => i.id===id ? {...i, ...fields} : i))
    // Persist to Supabase (map camelCase to snake_case for DB columns)
    const dbFields = {}
    if (fields.status       !== undefined) dbFields.status       = fields.status
    if (fields.estadoSheet  !== undefined) dbFields.estado_sheet = fields.estadoSheet
    if (fields.propietario  !== undefined) dbFields.propietario  = fields.propietario
    if (fields.prioridad    !== undefined) dbFields.prioridad    = fields.prioridad
    if (fields.risk         !== undefined) dbFields.risk         = fields.risk
    if (fields.fechaFin     !== undefined) dbFields.fecha_fin    = fields.fechaFin instanceof Date ? fields.fechaFin.toISOString() : fields.fechaFin
    if (fields.fechaInicio  !== undefined) dbFields.fecha_inicio = fields.fechaInicio instanceof Date ? fields.fechaInicio.toISOString() : fields.fechaInicio
    if (fields.notas        !== undefined) dbFields.notas        = fields.notas
    if (fields.objetivo     !== undefined) dbFields.objetivo     = fields.objetivo
    if (fields.tema         !== undefined) dbFields.tema         = fields.tema
    if (fields.propietario  !== undefined) dbFields.propietario  = fields.propietario
    if (fields.category     !== undefined) dbFields.category     = fields.category
    if (fields.proyecto     !== undefined) dbFields.proyecto     = fields.proyecto
    if (fields.subtareas    !== undefined) dbFields.subtareas    = fields.subtareas
    if (Object.keys(dbFields).length) sbUpdate(id, dbFields).catch(e => console.error('[onItemChange]', e))
  }

  const onNextSt = (id, newSt) => {
    if (newSt === 'done') saveDoneTs(id)
    onItemChange(id, { status:newSt, estadoSheet:ST_TO_SHEET[newSt]||'No iniciado' })
  }

  const proyectosConOv = proyectos.map(p => {
    const ov = getProyOverrides()[norm(p.nombre)] || {}
    return Object.keys(ov).length > 0 ? { ...p, ...ov, _hasLocalProy:true } : p
  })
  const onProyUpdate = (nombre, fields) =>
    setProyectos(prev => prev.map(p => norm(p.nombre)===norm(nombre) ? {...p,...fields,_hasLocalProy:true} : p))

  useEffect(() => {
    // Items ya completados en el sheet → timestamp de hace 8 días → van directo a Histórico
    const OLD_TS = Date.now() - 8 * 86400000
    allItems.filter(i => i.status === 'done').forEach(i => {
      try { if (!localStorage.getItem(DONE_TS_KEY(i.id))) localStorage.setItem(DONE_TS_KEY(i.id), OLD_TS.toString()) } catch {}
    })
  }, [items.length])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  const VISTAS = ['Dashboard','Tablero','🗂️ Proyectos','📋 Reporte Semanal','📅 Campañas CVM','✨ IA Intake','⧆ Histórico']

  const VIEW_LABELS = {
    'Dashboard':          'Dashboard Operativo',
    'Tablero':            'Tablero de Temas',
    '🗂️ Proyectos':      'Proyectos',
    '📋 Reporte Semanal': 'Reporte Semanal Ejecutivo',
    '📅 Campañas CVM':   'Campañas CVM',
    '✨ IA Intake':       'IA Intake',
    '⧆ Histórico':       'Histórico',
  }

  // Nav icon map for sidebar
  const NAV_ICONS = {
    'Dashboard':          '◈',
    'Tablero':            '⊞',
    '🗂️ Proyectos':      '◫',
    '📋 Reporte Semanal': '≡',
    '📅 Campañas CVM':   '◷',
    '✨ IA Intake':       '✦',
    '⧆ Histórico':       '⊙',
  }

  return (
    <div style={{ display:'flex', height:'100vh', background:C.bg, color:C.text, fontFamily:"'Geist',system-ui,sans-serif", overflow:'hidden' }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes cardIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#d6d1c8;border-radius:4px}

        /* Mobile responsive globals */
        @media (max-width: 767px) {
          * { box-sizing: border-box; }
          button { min-height: 44px; }
          input, select, textarea { font-size: 16px; }
        }
      `}</style>

      {/* ── Sidebar (Desktop: fixed, Mobile: overlay) ──────────────────── */}
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', zIndex:99 }} />
      )}

      <div style={{
        position: isMobile ? 'fixed' : 'relative',
        left: isMobile && !sidebarOpen ? '-100%' : 0,
        width: isMobile ? '80vw' : 240,
        maxWidth: isMobile ? '280px' : 240,
        background:'#fff',
        borderRight:`1px solid ${C.border}`,
        display:'flex',
        flexDirection:'column',
        flexShrink: isMobile ? 0 : 0,
        overflow:'hidden',
        height: '100vh',
        zIndex: isMobile ? 100 : 'auto',
        transition: isMobile ? 'left 300ms ease' : 'none'
      }}>
        {/* Logo */}
        <div style={{ padding:'20px 20px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <div style={{ width:30, height:30, borderRadius:8, background:'linear-gradient(135deg,#e8243b,#c4001a)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'#fff', flexShrink:0 }}>⬡</div>
            <div>
              <div style={{ fontSize:14, fontWeight:700, letterSpacing:'-.02em', color:C.text, lineHeight:1 }}>Ops<span style={{ color:C.accent }}>Board</span></div>
              <div style={{ fontSize:10, color:'#9b978f', marginTop:2, letterSpacing:'.01em' }}>Gestión operativa</div>
            </div>
          </div>
        </div>

        <div style={{ height:1, background:C.border, margin:'0 16px 8px' }} />

        {/* Nav items */}
        <nav style={{ flex:1, padding:'0 10px', display:'flex', flexDirection:'column', gap:2, overflowY:'auto' }}>
          {VISTAS.map(v => {
            const on = vista === v
            return (
              <button key={v} onClick={() => setVista(v)}
                style={{ width:'100%', padding:'9px 10px', borderRadius:8, border:'none',
                  background: on ? '#fef2f2' : 'transparent',
                  color: on ? C.accent : '#6b6862',
                  fontSize:13, fontWeight: on ? 600 : 500,
                  cursor:'pointer', textAlign:'left', letterSpacing:'-.003em',
                  display:'flex', alignItems:'center', gap:9,
                  transition:'background 120ms, color 120ms' }}
                onMouseEnter={e => { if(!on) e.currentTarget.style.background='#f5f3f0' }}
                onMouseLeave={e => { if(!on) e.currentTarget.style.background='transparent' }}>
                <span style={{ fontSize:12, opacity:.7, width:14, textAlign:'center', flexShrink:0 }}>{NAV_ICONS[v]}</span>
                {VIEW_LABELS[v] || v.replace(/^[^\w]+/, '')}
              </button>
            )
          })}
        </nav>

        {/* Bottom: lang toggle + last update + refresh */}
        <div style={{ padding:'12px 14px 16px', borderTop:`1px solid ${C.border}` }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ display:'flex', border:`1px solid ${C.border}`, borderRadius:6, overflow:'hidden', flex:1 }}>
              {['es','en'].map(l => (
                <button key={l} onClick={() => setLang(l)}
                  style={{ flex:1, padding:'4px 0', background:lang===l?C.accent:'transparent', color:lang===l?'#fff':'#9b978f',
                    border:'none', cursor:'pointer', fontWeight:lang===l?700:400, textTransform:'uppercase', fontSize:10, letterSpacing:'.04em' }}>
                  {l}
                </button>
              ))}
            </div>
            {lastUpd && (
              <span style={{ fontSize:10, color:'#9b978f', fontFamily:"'Geist Mono',monospace" }}>
                {pad(lastUpd.getHours())}:{pad(lastUpd.getMinutes())}
              </span>
            )}
            <button onClick={loadData} disabled={loading} title="Actualizar datos"
              style={{ background:'none', border:`1px solid ${C.border}`, color:'#9b978f', borderRadius:6, padding:'4px 9px', fontSize:12, cursor:'pointer', lineHeight:1 }}>
              {loading ? '⏳' : '↺'}
            </button>
          </div>

        </div>
      </div>

      {/* ── Main column ──────────────────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', width: isMobile ? '100%' : 'auto', minWidth: 0 }}>

        {/* Topbar */}
        <div style={{ height: isMobile ? 52 : 56, background:'#fff', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', padding: isMobile ? '0 12px' : '0 24px', gap: isMobile ? 8 : 16, flexShrink:0 }}>
          {isMobile && (
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', padding:'4px 8px', color:C.text }}>
              ☰
            </button>
          )}
          <h1 style={{ flex:1, fontSize: isMobile ? 12 : 14, fontWeight:600, color:C.text, letterSpacing:'-.005em', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {VIEW_LABELS[vista] || vista}
          </h1>
          {vista === 'Tablero' && (
            <>
              <button onClick={() => setShowNuevo(true)}
                style={{ padding: isMobile ? '6px 10px' : '7px 14px', background:C.accent, color:'#fff', border:'none', borderRadius:8, fontSize: isMobile ? 11 : 12, fontWeight:600, cursor:'pointer', letterSpacing:'-.01em', transition:'background 120ms', whiteSpace:'nowrap' }}
                onMouseEnter={e => e.currentTarget.style.background='#d41c2f'}
                onMouseLeave={e => e.currentTarget.style.background=C.accent}>
                {isMobile ? '+ Tema' : '+ Nuevo tema'}
              </button>
              <button onClick={() => setShowIntake(true)}
                title="Procesar carpeta de intake"
                style={{ padding: isMobile ? '6px 10px' : '7px 14px', background:'#10b981', color:'#fff', border:'none', borderRadius:8, fontSize: isMobile ? 11 : 12, fontWeight:600, cursor:'pointer', letterSpacing:'-.01em', transition:'background 120ms', whiteSpace:'nowrap' }}
                onMouseEnter={e => e.currentTarget.style.background='#059669'}
                onMouseLeave={e => e.currentTarget.style.background='#10b981'}>
                {isMobile ? '🔄' : '🔄 Procesar'}
              </button>
            </>
          )}
          {(items.length === 0 || proyectos.length === 0) && !loading && (
            <button onClick={async () => {
              setToast('⏳ Migrando desde Google Sheets…')
              try {
                const r = await fetch('/api/data')
                if (!r.ok) throw new Error('HTTP ' + r.status)
                const { values } = await r.json()
                const tables = parseSheetValues(values)
                let migratedItems = 0, migratedProys = 0
                // Only migrate items if none exist yet
                if (items.length === 0) {
                  const sheetItems = buildItems(tables)
                  if (sheetItems.length) {
                    const { error: e1 } = await supabase.from('items').insert(sheetItems.map(itemToDb))
                    if (e1) throw new Error('items: ' + e1.message)
                    migratedItems = sheetItems.length
                  }
                }
                // Only migrate proyectos if none exist yet
                if (proyectos.length === 0) {
                  const sheetProys = parseProyectos(tables)
                  const proyRows = sheetProys.map(p => ({
                    id: uid(), nombre: p.nombre||'Sin nombre', descripcion: p.descripcion||'',
                    propietario: p.propietario||'', prioridad: p.prioridad||'',
                    estado: p.estado||'', status: p.status||'pending', desarrollo: p.desarrollo||'',
                    fecha_inicio: p.fechaInicio instanceof Date ? p.fechaInicio.toISOString() : null,
                    fecha_fin:    p.fechaFin    instanceof Date ? p.fechaFin.toISOString()    : null,
                    notas: p.notas||'', fase: p.fase||'',
                    capex: p.capex||null, nombre_en: p.nombreEN||'',
                  }))
                  if (proyRows.length) {
                    const { error: e2 } = await supabase.from('proyectos').insert(proyRows)
                    if (e2) throw new Error('proyectos: ' + e2.message)
                    migratedProys = proyRows.length
                  } else {
                    setToast('⚠ No se encontraron proyectos en el Sheet')
                    loadData(); return
                  }
                }
                setToast('✓ Migradas ' + migratedItems + ' tareas + ' + migratedProys + ' proyectos')
                loadData()
              } catch(e) { setToast('⚠ Error migrando: ' + e.message) }
            }}
              style={{ padding:'7px 14px', background:'#1e40af', color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              ⬆ {proyectos.length === 0 && items.length > 0 ? 'Migrar Proyectos' : 'Migrar Sheets → Supabase'}
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ flex:1, overflow:'auto', padding: isMobile ? '8px' : '24px', width: '100%', boxSizing: 'border-box' }}>
          {loading && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:280, gap:12, color:C.muted }}>
              <div style={{ width:32, height:32, borderRadius:'50%', border:`3px solid ${C.border}`, borderTopColor:C.accent, animation:'spin .8s linear infinite' }} />
              <span style={{ fontSize:13 }}>Cargando desde Seguimiento…</span>
            </div>
          )}
          {!loading && error && (
            <div style={{ marginTop:40, textAlign:'center', color:'#f43f5e' }}>
              <p style={{ fontWeight:700, marginBottom:8 }}>⚠️ Error cargando datos</p>
              <p style={{ fontSize:12, color:C.muted, marginBottom:16 }}>{error}</p>
              <Btn onClick={loadData}>Reintentar</Btn>
            </div>
          )}
          {!loading && !error && (
            <>
              {vista === 'Tablero' && (
                <Tablero items={allItems} catF={catF} setCatF={setCatF} asF={asF} setAsF={setAsF}
                  owners={owners} setItem={setItemActivo} onNextSt={onNextSt} modo={modo} setModo={setModo}
                  onNuevo={() => setShowNuevo(true)} />
              )}
              {vista === '🗂️ Proyectos'        && <Proyectos proyectos={proyectosConOv} allItems={allItems} onAddTema={addLocalItem} onOpenItem={item => setItemActivo(item)} onUpdate={onProyUpdate} lang={lang} />}
              {vista === 'Dashboard'          && <Dashboard allItems={allItems} />}
              {vista === '📅 Campañas CVM'    && <CampanasCVM campanas={campanas} />}
              {vista === '✨ IA Intake'        && <IAIntake onAdd={addLocalItems} allItems={allItems} />}
              {vista === '📋 Reporte Semanal' && <Cristina items={allItems} proyectos={proyectos} idioma={lang} />}
              {vista === '⧆ Histórico'        && <Historico items={allItems} />}
            </>
          )}
        </div>
      </div>

      {showNuevo && (
        <NuevoTema
          onAdd={addLocalItem}
          onClose={() => setShowNuevo(false)}
          proyectoNames={proyectos.map(p => p.nombre)} />
      )}
      {itemActivo && (
        <ModalItem item={itemActivo} onClose={() => setItemActivo(null)}
          onItemChange={(id, fields, keepOpen = false) => {
            onItemChange(id, fields)
            if (keepOpen) setItemActivo(prev => prev && prev.id===id ? { ...prev, ...fields } : prev)
            else setItemActivo(null)
          }}
          proyectoNames={proyectos.map(p => p.nombre)}
          onToast={msg => setToast(msg)} />
      )}
      {showIntake && (
        <IntakeModal
          onClose={() => setShowIntake(false)}
          onExecute={() => {
            setToast('⏳ Procesando carpeta de intake...')
            setShowIntake(false)
          }}
          onToast={msg => setToast(msg)} />
      )}
      {toast && <Toast msg={toast} onHide={() => setToast(null)} />}
    </div>
  )
}
