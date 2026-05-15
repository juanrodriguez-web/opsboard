import { useState, useEffect } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { parseSheetValues, buildItems, parseCampanas, norm } from './parser.js'

// ── Constants ────────────────────────────────────────────────────────────────
const CATS = [
  { id:'projects', label:'Proyectos',    color:'#60a5fa', bg:'#1a2740' },
  { id:'product',  label:'Producto',     color:'#a78bfa', bg:'#211a40' },
  { id:'tools',    label:'Herramientas', color:'#fbbf24', bg:'#3d2e0a' },
  { id:'cvm',      label:'CVM',          color:'#06b6d4', bg:'#0c2a33' },
]
const ST = [
  { id:'pending',    label:'Pendiente',  color:'#64748b' },
  { id:'inprogress', label:'En Curso',   color:'#818cf8' },
  { id:'blocked',    label:'Bloqueado',  color:'#f43f5e' },
  { id:'done',       label:'Completado', color:'#34d399' },
]
const RK = [
  { id:'green',  label:'Normal',   color:'#34d399' },
  { id:'yellow', label:'Atención', color:'#fbbf24' },
  { id:'red',    label:'Riesgo',   color:'#f43f5e' },
]
const ST_TO_SHEET = {
  pending:'No iniciado', inprogress:'Según lo planificado',
  blocked:'En peligro',  done:'Hecho',
}
const C = {
  bg:'#0b0d17', surface:'#13162a', card:'#1a1e35',
  border:'#242843', text:'#e2e8f0', muted:'#5a6485', accent:'#818cf8',
}
const OV_KEY       = 'obs-status-overrides'
const COMMENTS_KEY = 'obs-comments'

// Owner colors
const OWN_COLORS = {
  'juan rodriguez peisel': '#60a5fa',
  'francisco toledo':      '#a78bfa',
  'nacho cruz':            '#fbbf24',
  'maria garcia':          '#06b6d4',
}
const ownerColor = name => OWN_COLORS[norm(name || '')] || '#64748b'

// CVM campaign helpers
const TIPO_COLORS = {
  'oferta one shot':'#fbbf24', 'oferta':'#fbbf24',
  'reminder':'#818cf8', 'bau':'#64748b',
  'reactivacion':'#f43f5e', 'reactivación':'#f43f5e',
}
const ESTADO_CAMP_COLORS = {
  'planificado':'#818cf8', 'enviado':'#34d399', 'cancelado':'#f43f5e',
}
const tipoColor   = t => TIPO_COLORS[norm(t)]   || '#06b6d4'
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

const lsGet = (k, def = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def } catch { return def } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

const getOverrides = ()          => lsGet(OV_KEY, {})
const saveOverride = (k, st, sh) => { const ov = getOverrides(); ov[k] = { status:st, estadoSheet:sh, ts:new Date().toISOString() }; lsSet(OV_KEY, ov) }
const getComments  = k           => (lsGet(COMMENTS_KEY, []) || []).filter(c => c.k === k)
const saveComment  = (k, text)   => {
  const all = lsGet(COMMENTS_KEY, []) || []
  const now = new Date()
  const ts  = `${pad(now.getDate())}/${pad(now.getMonth()+1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const item = { k, ts, text, id:uid(), iso:now.toISOString() }
  lsSet(COMMENTS_KEY, [item, ...all].slice(0, 300))
  return item
}

function applyOverrides(items) {
  const ov = getOverrides()
  return items.map(item => {
    const k = norm(item.tema)
    const o = ov[k]
    if (!o) return item
    if (item.status === o.status) {
      const fresh = getOverrides(); delete fresh[k]; lsSet(OV_KEY, fresh)
      return item
    }
    return { ...item, status:o.status, estadoSheet:o.estadoSheet }
  })
}

// ── API calls ────────────────────────────────────────────────────────────────
async function fetchAll() {
  const res = await fetch('/api/data')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { values } = await res.json()
  const tables  = parseSheetValues(values)
  const items   = applyOverrides(buildItems(tables))
  const campanas = parseCampanas(tables)
  return { items, campanas }
}

async function apiUpdate(tema, estado, notas) {
  await fetch('/api/update', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ tema, ...(estado && { estado }), ...(notas && { notas }) }),
  })
}

async function callClaude(body) {
  const res  = await fetch('/api/claude', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const data = await res.json()
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
const Lbl  = ({ children }) => <div style={{ fontSize:10, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:5 }}>{children}</div>
const AlertFecha = ({ endDate, status }) => {
  if (!endDate || status === 'done') return null
  const dl    = diasRestantes(fdStr(endDate))
  const color = dl < 0 ? '#f43f5e' : dl <= 3 ? '#fbbf24' : C.muted
  const txt   = dl < 0 ? `Vencida ${Math.abs(dl)}d` : dl === 0 ? 'Hoy' : dl <= 3 ? `${dl}d` : fmtFecha(fdStr(endDate))
  return <span style={{ fontSize:10, color, fontWeight:dl<=3?700:400, background:dl<=3?color+'22':'transparent', padding:dl<=3?'2px 5px':'0', borderRadius:4 }}>{txt}</span>
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────
const Tarjeta = ({ item, onClick, onNextSt }) => {
  const cat    = CATS.find(c => c.id === item.category)
  const nextId = ST[(ST.findIndex(s => s.id === item.status) + 1) % ST.length].id
  const stOk   = (item.subtareas || []).filter(s => s.status === 'done').length
  const stTot  = (item.subtareas || []).length
  const dl     = item.fechaFin && item.status !== 'done' ? diasRestantes(fdStr(item.fechaFin)) : null
  const oc     = ownerColor(item.propietario)
  return (
    <div onClick={() => onClick(item)}
      style={{ background:C.card, borderRadius:8, padding:12, marginBottom:8,
        border:`1px solid ${dl!==null&&dl<0?'#f43f5e55':C.border}`, borderLeft:`3px solid ${cat?.color||C.muted}`, cursor:'pointer' }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:6 }}>
        <Dot risk={item.risk} />
        <span style={{ flex:1, fontSize:13, fontWeight:600, color:C.text, lineHeight:1.35 }}>{item.tema}</span>
      </div>
      {item.objetivo && <p style={{ fontSize:11, color:C.muted, marginBottom:8, lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{item.objetivo}</p>}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, flex:1, flexWrap:'wrap' }}>
          <div style={{ width:20, height:20, borderRadius:'50%', background:oc+'28', border:`1.5px solid ${oc}66`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, fontWeight:700, color:oc, fontFamily:'monospace', flexShrink:0 }}>{iniciales(item.propietario)}</div>
          <AlertFecha endDate={item.fechaFin} status={item.status} />
          {item.prioridad && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:RK.find(r=>r.id===item.risk)?.color+'22', color:RK.find(r=>r.id===item.risk)?.color }}>{item.prioridad}</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          {stTot > 0 && <span style={{ fontSize:10, color:C.muted }}>{stOk}/{stTot}</span>}
          <button onClick={e => { e.stopPropagation(); onNextSt(item.id, nextId) }}
            style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:4, padding:'2px 6px', fontSize:10, cursor:'pointer', color:C.muted }}>→</button>
        </div>
      </div>
    </div>
  )
}

// ── Tablero ──────────────────────────────────────────────────────────────────
const Tablero = ({ items, catF, setCatF, asF, setAsF, owners, setItem, onNextSt, modo, setModo }) => {
  const f = items.filter(i => catF==='all'||i.category===catF).filter(i => asF==='all'||norm(i.propietario)===norm(asF))
  return (
    <div>
      <div style={{ display:'flex', gap:8, paddingTop:16, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        {[{ id:'all', label:'Todas', color:C.muted }, ...CATS].map(c => {
          const n  = c.id === 'all' ? items.length : items.filter(i => i.category === c.id).length
          const on = catF === c.id
          return (
            <button key={c.id} onClick={() => setCatF(c.id)}
              style={{ padding:'5px 12px', borderRadius:20, fontSize:12, fontWeight:700, cursor:'pointer',
                border:on?`1px solid ${c.color}55`:`1px solid ${C.border}`,
                background:on?c.color+'22':C.card, color:on?c.color:C.muted }}>
              {c.label} ({n})
            </button>
          )
        })}
        <div style={{ width:1, height:20, background:C.border }} />
        <select value={asF} onChange={e => setAsF(e.target.value)}
          style={{ background:C.card, color:C.text, border:`1px solid ${C.border}`, borderRadius:20, padding:'5px 12px', fontSize:12, cursor:'pointer', outline:'none' }}>
          <option value="all">Todos</option>
          {owners.map(o => <option key={o} value={o}>{o.split(' ')[0]}</option>)}
        </select>
        <div style={{ display:'flex', gap:4, marginLeft:'auto' }}>
          {[{ id:'kanban', l:'⊞ Kanban' }, { id:'list', l:'☰ Lista' }].map(v => (
            <button key={v.id} onClick={() => setModo(v.id)}
              style={{ padding:'5px 10px', borderRadius:6, fontSize:12, border:`1px solid ${C.border}`,
                background:modo===v.id?C.accent+'22':C.card, color:modo===v.id?C.accent:C.muted, cursor:'pointer' }}>{v.l}</button>
          ))}
        </div>
      </div>
      {modo === 'kanban' ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
          {ST.map(st => {
            const col = f.filter(i => i.status === st.id)
            return (
              <div key={st.id}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
                  <div style={{ width:7, height:7, borderRadius:'50%', background:st.color }} />
                  <span style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.08em' }}>{st.label}</span>
                  <span style={{ fontSize:10, color:st.color, background:st.color+'22', borderRadius:10, padding:'1px 6px' }}>{col.length}</span>
                </div>
                <div style={{ minHeight:60 }}>
                  {col.length === 0
                    ? <div style={{ border:`2px dashed ${C.border}`, borderRadius:8, padding:'18px 12px', textAlign:'center', color:C.muted, fontSize:11 }}>Vacío</div>
                    : col.map(item => <Tarjeta key={item.id} item={item} onClick={setItem} onNextSt={onNextSt} />)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ background:C.card, borderRadius:10, border:`1px solid ${C.border}`, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 100px 120px 130px 90px', padding:'8px 14px', borderBottom:`1px solid ${C.border}`, fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase' }}>
            <span>Tema</span><span>Área</span><span>Estado</span><span>Responsable</span><span>Fecha fin</span>
          </div>
          {f.length === 0
            ? <div style={{ padding:24, textAlign:'center', color:C.muted, fontSize:13 }}>Sin temas</div>
            : f.map(item => {
              const cat = CATS.find(c => c.id === item.category)
              const st  = ST.find(s => s.id === item.status)
              const ov  = item.fechaFin && item.status !== 'done' && diasRestantes(fdStr(item.fechaFin)) < 0
              return (
                <div key={item.id} onClick={() => setItem(item)}
                  style={{ display:'grid', gridTemplateColumns:'2fr 100px 120px 130px 90px', padding:'10px 14px', borderBottom:`1px solid ${C.border}`, cursor:'pointer', alignItems:'center', fontSize:13 }}
                  onMouseEnter={e => e.currentTarget.style.background=C.surface}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, overflow:'hidden' }}>
                    <div style={{ width:3, height:18, borderRadius:2, background:cat?.color||C.muted, flexShrink:0 }} />
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:C.text }}>{item.tema}</span>
                  </div>
                  <Tag id={item.category} type="cat" />
                  <Tag id={item.status}   type="st" />
                  <span style={{ fontSize:12, color:C.muted }}>{(item.propietario||'').split(' ')[0]}</span>
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

  const setOwn = v => { setDashOwn(v); localStorage.setItem('obs-dash-own', v) }

  const items = allItems.filter(i => {
    const p = norm(i.propietario)
    if (dashOwn === 'juan')      return p === JUAN_NORM
    if (dashOwn === 'francisco') return p === FRAN_NORM
    return p !== MARIA_NORM  // 'team' = Juan + Francisco
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

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:18 }}>
        {kpis.map((k,i) => (
          <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:28, fontWeight:700, color:k.c, lineHeight:1 }}>{k.v}</div>
            <div style={{ fontSize:10, color:C.muted, marginTop:5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em' }}>{k.l}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
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

  const setF = v => { setFilt(v); localStorage.setItem('obs-camp-filt', v) }

  const ESTADOS = ['all','Planificado','Enviado','Cancelado']
  const filtered = campanas.filter(c => filt === 'all' || norm(c.estado) === norm(filt))

  if (campanas.length === 0) return (
    <div style={{ paddingTop:24, maxWidth:600 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:32, textAlign:'center' }}>
        <div style={{ fontSize:36, marginBottom:12 }}>📅</div>
        <h3 style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:8 }}>Todavía no hay campañas CVM</h3>
        <p style={{ fontSize:13, color:C.muted, lineHeight:1.7, marginBottom:20 }}>
          Añade una pestaña al Google Sheet llamada <b style={{ color:C.text }}>Campañas CVM</b> con estas columnas:
        </p>
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:14,
          fontFamily:'monospace', fontSize:12, color:C.muted, textAlign:'left', lineHeight:2, overflowX:'auto' }}>
          Fecha | PYNAME | Tipo | Audiencia | Volumen | Copy | Canal | Estado
        </div>
        <p style={{ fontSize:11, color:C.muted, marginTop:12, lineHeight:1.7 }}>
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
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:18, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {ESTADOS.map(e => {
            const on  = (e==='all'&&filt==='all') || norm(e)===norm(filt)
            const col = e==='all' ? C.muted : estadoCColor(e)
            const cnt = e==='all' ? campanas.length : campanas.filter(c=>norm(c.estado)===norm(e)).length
            return (
              <button key={e} onClick={() => setF(e)}
                style={{ padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer',
                  border:`1.5px solid ${on?col:C.border}`, background:on?col+'22':C.card, color:on?col:C.muted }}>
                {e==='all'?'Todas':e} <span style={{ opacity:.65 }}>{cnt}</span>
              </button>
            )
          })}
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:16, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:C.muted }}><b style={{ color:C.text }}>{campanas.length}</b> campañas</span>
          <span style={{ fontSize:11, color:C.muted }}><b style={{ color:'#34d399' }}>{campanas.filter(c=>norm(c.estado)==='enviado').length}</b> enviadas</span>
          {volTotal > 0 && <span style={{ fontSize:11, color:C.muted }}><b style={{ color:'#06b6d4' }}>{(volTotal/1000).toFixed(0)}k</b> líneas</span>}
        </div>
      </div>

      {/* Campaign groups */}
      {filtered.length === 0
        ? <div style={{ textAlign:'center', color:C.muted, padding:40 }}>Sin campañas con este filtro</div>
        : Object.entries(groups).map(([fecha, list]) => (
          <div key={fecha} style={{ marginBottom:24 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:'#06b6d4' }} />
              <span style={{ fontSize:13, fontWeight:700, color:C.text }}>{fecha}</span>
              <span style={{ fontSize:10, color:'#06b6d4', background:'#06b6d422', borderRadius:10, padding:'1px 8px', fontWeight:700 }}>
                {list.length} campaña{list.length!==1?'s':''}
              </span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:10 }}>
              {list.map(c => {
                const tc = tipoColor(c.tipo)
                const ec = estadoCColor(c.estado)
                return (
                  <div key={c.id} onClick={() => setDetalle(c)}
                    style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${tc}`, borderRadius:8, padding:14, cursor:'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor=tc}
                    onMouseLeave={e => e.currentTarget.style.borderColor=C.border}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:8 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:C.text, fontFamily:'monospace', flex:1, lineHeight:1.3 }}>{c.pyname}</span>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:ec+'22', color:ec, flexShrink:0 }}>{c.estado}</span>
                    </div>
                    <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap', alignItems:'center' }}>
                      {c.tipo && <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:tc+'22', color:tc }}>{c.tipo}</span>}
                      {c.canal && <span style={{ fontSize:10, color:C.muted, background:C.surface, padding:'2px 6px', borderRadius:4, border:`1px solid ${C.border}` }}>{c.canal}</span>}
                      {c.volumen && <span style={{ fontSize:10, fontWeight:700, color:'#06b6d4' }}>👥 {c.volumen}</span>}
                    </div>
                    {c.audiencia && <p style={{ fontSize:11, color:C.muted, lineHeight:1.4, marginBottom:4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{c.audiencia}</p>}
                    {c.copy && <p style={{ fontSize:11, color:C.muted, fontStyle:'italic', lineHeight:1.4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>"{c.copy.slice(0,90)}{c.copy.length>90?'…':''}"</p>}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      }

      {/* Campaign detail modal */}
      {detalle && (
        <div style={{ position:'fixed', inset:0, background:'#00000099', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => e.target===e.currentTarget&&setDetalle(null)}>
          <div style={{ background:C.surface, borderRadius:12, border:`1px solid ${C.border}`, width:'100%', maxWidth:560, maxHeight:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'14px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:3, height:22, borderRadius:2, background:tipoColor(detalle.tipo), flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, color:C.muted }}>{detalle.fecha}{detalle.tipo?` · ${detalle.tipo}`:''}</div>
                <h3 style={{ fontSize:14, fontWeight:700, color:C.text, fontFamily:'monospace' }}>{detalle.pyname}</h3>
              </div>
              <span style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:5, background:estadoCColor(detalle.estado)+'22', color:estadoCColor(detalle.estado) }}>{detalle.estado}</span>
              <button onClick={() => setDetalle(null)} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:18, display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div><Lbl>Canal</Lbl><span style={{ fontSize:13, color:C.text }}>{detalle.canal||'—'}</span></div>
              <div><Lbl>Volumen</Lbl><span style={{ fontSize:18, fontWeight:700, color:'#06b6d4' }}>{detalle.volumen||'—'}</span></div>
              <div style={{ gridColumn:'1/-1' }}>
                <Lbl>Audiencia</Lbl>
                <p style={{ fontSize:13, color:C.text, lineHeight:1.6, background:C.card, borderRadius:6, padding:10 }}>{detalle.audiencia||'—'}</p>
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <Lbl>Copy</Lbl>
                <div style={{ fontSize:12, color:C.muted, lineHeight:1.7, background:C.card, borderRadius:8, padding:12, maxHeight:200, overflowY:'auto', borderLeft:`3px solid #06b6d4`, whiteSpace:'pre-wrap', fontStyle:'italic' }}>
                  {detalle.copy||'—'}
                </div>
              </div>
            </div>
            <div style={{ padding:'10px 18px', borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'flex-end' }}>
              <Btn v="sec" onClick={() => setDetalle(null)}>Cerrar</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── IA Intake ─────────────────────────────────────────────────────────────────
const IAIntake = ({ onAdd }) => {
  const [txt, setTxt]         = useState('')
  const [busy, setBusy]       = useState(false)
  const [pending, setPending] = useState(null)
  const [err, setErr]         = useState('')

  const run = async () => {
    if (!txt.trim()) return
    setBusy(true); setErr(''); setPending(null)
    try {
      const raw = await callClaude({
        model:'claude-sonnet-4-20250514', max_tokens:1000,
        system:'Extrae tareas del texto. SOLO JSON:\n{"items":[{"category":"projects|product|tools|cvm","title":"string","description":"string","subtasks":["string"],"risk":"green|yellow|red","endDate":"YYYY-MM-DD|null"}]}',
        messages:[{ role:'user', content:txt }],
      })
      const p = JSON.parse(raw.replace(/```json|```/g,'').trim())
      setPending((p.items||[]).map(i => ({ ...i, assignee:'' })))
    } catch { setErr('Error procesando el texto.') }
    setBusy(false)
  }

  const confirmar = () => {
    const ni = pending.map(ai => ({
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

  return (
    <div style={{ paddingTop:16, maxWidth:760 }}>
      <h2 style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:4 }}>✨ IA Intake</h2>
      <p style={{ fontSize:13, color:C.muted, marginBottom:14 }}>Pega un email, nota o acta. La IA detecta las tareas automáticamente.</p>
      <TA value={txt} onChange={setTxt} placeholder="Pega aquí el texto..." rows={6} style={{ marginBottom:10 }} />
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        <Btn onClick={run} disabled={busy||!txt.trim()}>{busy?'⏳ Analizando…':'✨ Detectar tareas'}</Btn>
        {txt && <Btn v="sec" onClick={() => { setTxt(''); setPending(null) }}>Limpiar</Btn>}
      </div>
      {err && <div style={{ color:'#f43f5e', fontSize:13, marginBottom:12 }}>{err}</div>}
      {pending && (
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:C.muted, marginBottom:12 }}>{pending.length} tarea{pending.length!==1?'s':''} detectada{pending.length!==1?'s':''}:</div>
          {pending.map((item,idx) => {
            const cat = CATS.find(c => c.id === item.category)
            return (
              <div key={idx} style={{ background:C.card, borderLeft:`3px solid ${cat?.color||C.muted}`, borderRadius:8, padding:14, marginBottom:10, border:`1px solid ${C.border}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                  <Tag id={item.category} type="cat" />
                  <span style={{ fontSize:14, fontWeight:600, color:C.text, flex:1 }}>{item.title}</span>
                  <Dot risk={item.risk} />
                </div>
                {item.description && <p style={{ fontSize:12, color:C.muted }}>{item.description}</p>}
              </div>
            )
          })}
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <Btn onClick={confirmar}>✓ Añadir al tablero</Btn>
            <Btn v="sec" onClick={() => setPending(null)}>Cancelar</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reporte Semanal ───────────────────────────────────────────────────────────
const Reporte = ({ items }) => {
  const [txt, setTxt]       = useState('')
  const [busy, setBusy]     = useState(false)
  const [fmt, setFmt]       = useState('email')
  const [copied, setCopied] = useState(false)

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
        model:'claude-sonnet-4-20250514', max_tokens:1800,
        system: fmt === 'email' ? SYSTEM_EJECUTIVO : SYSTEM_BULLETS,
        messages:[{ role:'user', content:`Datos del OpsBoard semanal:\n${JSON.stringify(stats,null,2)}` }],
      })
      setTxt(r)
    } catch { setTxt('Error al generar.') }
    setBusy(false)
  }

  const copiar = () => { navigator.clipboard?.writeText(txt); setCopied(true); setTimeout(()=>setCopied(false),2000) }

  return (
    <div style={{ paddingTop:16, maxWidth:800 }}>
      <h2 style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:4 }}>📋 Reporte Semanal</h2>
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
  )
}

// ── Modal item ────────────────────────────────────────────────────────────────
const ModalItem = ({ item, onClose, onStatusChange }) => {
  const [newSt, setNewSt]   = useState(item.status)
  const [nc, setNc]         = useState('')
  const [saving, setSaving] = useState(false)
  const cat          = CATS.find(c => c.id === item.category)
  const localComments = getComments(norm(item.tema))
  const rc           = RK.find(r => r.id === item.risk)?.color || '#94a3b8'
  const dl           = item.fechaFin ? diasRestantes(fdStr(item.fechaFin)) : null

  const guardarEstado = async () => {
    if (newSt === item.status) { onClose(); return }
    setSaving(true)
    try { await apiUpdate(item.tema, ST_TO_SHEET[newSt]) } catch {}
    saveOverride(norm(item.tema), newSt, ST_TO_SHEET[newSt])
    onStatusChange(item.id, newSt)
    setSaving(false); onClose()
  }

  const guardarComentario = async () => {
    const text = nc.trim()
    if (!text) return
    setSaving(true)
    const c = saveComment(norm(item.tema), text)
    try { await apiUpdate(item.tema, undefined, `[${c.ts}] ${text}`) } catch {}
    setNc(''); setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#00000099', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget&&onClose()}>
      <div style={{ background:C.surface, borderRadius:12, border:`1px solid ${C.border}`, width:'100%', maxWidth:680, maxHeight:'92vh', overflow:'hidden', display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'14px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:3, height:22, borderRadius:2, background:cat?.color||C.muted, flexShrink:0 }} />
          <h3 style={{ flex:1, fontSize:15, fontWeight:700, color:C.text, lineHeight:1.3 }}>{item.tema}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:18 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
            <div><Lbl>Área</Lbl><Tag id={item.category} type="cat" /></div>
            <div>
              <Lbl>Estado</Lbl>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Sel value={newSt} onChange={setNewSt} opts={ST.map(s=>({v:s.id,l:s.label}))} style={{ flex:1 }} />
                <Btn onClick={guardarEstado} disabled={saving} style={{ padding:'6px 12px', fontSize:12, flexShrink:0 }}>{saving?'…':'Guardar'}</Btn>
              </div>
            </div>
            <div><Lbl>Propietario</Lbl><span style={{ fontSize:13, color:C.text }}>{item.propietario||'—'}</span></div>
            <div>
              <Lbl>Prioridad</Lbl>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <Dot risk={item.risk} />
                <span style={{ fontSize:13, color:rc, fontWeight:700 }}>{item.prioridad||'—'}</span>
              </div>
            </div>
            <div><Lbl>Fecha inicio</Lbl><span style={{ fontSize:13, color:C.text }}>{fmtFecha(fdStr(item.fechaInicio))}</span></div>
            <div>
              <Lbl>Fecha fin</Lbl>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:13, color:C.text }}>{fmtFecha(fdStr(item.fechaFin))}</span>
                {dl !== null && dl < 0 && item.status !== 'done' && <span style={{ fontSize:10, background:'#f43f5e22', color:'#f43f5e', padding:'2px 6px', borderRadius:4, fontWeight:700 }}>{Math.abs(dl)}d vencida</span>}
              </div>
            </div>
          </div>
          {item.objetivo && <div style={{ marginBottom:16 }}><Lbl>Objetivo</Lbl><p style={{ fontSize:13, color:C.text, lineHeight:1.6 }}>{item.objetivo}</p></div>}
          {item.subtareas.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <Lbl>Subtareas ({item.subtareas.filter(s=>s.status==='done').length}/{item.subtareas.length})</Lbl>
              {item.subtareas.map((st,i) => {
                const sc = ST.find(s=>s.id===st.status)||ST[0]
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:C.card, borderRadius:6, padding:'7px 10px', marginBottom:5, border:`1px solid ${C.border}` }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background:RK.find(r=>r.id===st.risk)?.color||'#64748b', flexShrink:0 }} />
                    <span style={{ flex:1, fontSize:12, color:st.status==='done'?C.muted:C.text, textDecoration:st.status==='done'?'line-through':'none' }}>{st.title}</span>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, background:sc.color+'22', color:sc.color }}>{sc.label}</span>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ marginBottom:16 }}>
            <Lbl>Actualizaciones</Lbl>
            {localComments.map(c => (
              <div key={c.id} style={{ display:'flex', gap:10, padding:'9px 12px', background:C.card, borderRadius:6, marginBottom:5, borderLeft:`3px solid ${C.accent}` }}>
                <div>
                  <div style={{ fontSize:11, color:C.muted, marginBottom:3 }}><span style={{ fontWeight:700, color:C.accent }}>[{c.ts}]</span></div>
                  <div style={{ fontSize:13, color:C.text, lineHeight:1.5, whiteSpace:'pre-wrap' }}>{c.text}</div>
                </div>
              </div>
            ))}
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:localComments.length>0?10:0 }}>
              <TA value={nc} onChange={setNc} placeholder="Escribe una actualización…" rows={2}
                onKeyDown={e => { if(e.ctrlKey&&e.key==='Enter'){ guardarComentario(); e.preventDefault() } }} />
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Btn onClick={guardarComentario} disabled={saving||!nc.trim()} style={{ padding:'6px 14px', fontSize:12 }}>💬 Guardar</Btn>
                <span style={{ fontSize:11, color:C.muted }}>Ctrl+Enter</span>
              </div>
            </div>
          </div>
          {item.notas && (
            <div>
              <Lbl>Notas de Seguimiento</Lbl>
              <div style={{ fontSize:12, color:C.muted, lineHeight:1.6, background:C.card, borderRadius:8, padding:12, maxHeight:200, overflowY:'auto', borderLeft:`3px solid ${C.border}`, whiteSpace:'pre-wrap' }}>
                {item.notas}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding:'10px 18px', borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, color:C.muted }}>Sheet: <b style={{ color:C.text }}>{item.estadoSheet}</b> · {item.subtareas.length} subtareas</span>
          <Btn v="sec" onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function OpsBoard() {
  const [vista,       setVista]      = useState('Tablero')
  const [items,       setItems]      = useState([])
  const [campanas,    setCampanas]   = useState([])
  const [localItems,  setLocalItems] = useState([])
  const [loading,     setLoading]    = useState(true)
  const [error,       setError]      = useState(null)
  const [lastUpd,     setLastUpd]    = useState(null)
  const [itemActivo,  setItemActivo] = useState(null)
  const [catF,        setCatF]       = useState('all')
  const [asF,         setAsF]        = useState('all')
  const [modo,        setModo]       = useState('kanban')

  const allItems = [...items, ...localItems]
  const owners   = [...new Set(allItems.map(i => i.propietario).filter(Boolean))]

  const loadData = async () => {
    setLoading(true); setError(null)
    try {
      const { items: fetched, campanas: fetchedCamps } = await fetchAll()
      setItems(fetched)
      setCampanas(fetchedCamps)
      setLastUpd(new Date())
    } catch (e) {
      setError(e.message || String(e))
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const onStatusChange = (id, newSt) =>
    setItems(prev => prev.map(i => i.id===id ? {...i, status:newSt, estadoSheet:ST_TO_SHEET[newSt]} : i))

  const onNextSt = async (id, newSt) => {
    const item = allItems.find(i => i.id===id)
    if (!item) return
    saveOverride(norm(item.tema), newSt, ST_TO_SHEET[newSt])
    try { await apiUpdate(item.tema, ST_TO_SHEET[newSt]) } catch {}
    onStatusChange(id, newSt)
  }

  const VISTAS = ['Tablero','Dashboard','📅 Campañas CVM','✨ IA Intake','📋 Reporte Semanal']

  return (
    <div style={{ background:C.bg, minHeight:'100vh', color:C.text, fontFamily:'system-ui,sans-serif' }}>
      {/* Header */}
      <header style={{ background:C.surface, padding:'0 20px', display:'flex', alignItems:'center', gap:10, height:52, position:'sticky', top:0, zIndex:100, flexDirection:'column', justifyContent:'center' }}>
        {/* Gradient accent bar */}
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'linear-gradient(90deg,#e60028 0%,#6366f1 45%,#06b6d4 100%)' }} />
        <div style={{ display:'flex', alignItems:'center', gap:10, width:'100%' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginRight:6, flexShrink:0 }}>
            <div style={{ width:28, height:28, borderRadius:7, background:'linear-gradient(135deg,#e60028,#6366f1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, color:'#fff' }}>⬡</div>
            <span style={{ fontSize:13, fontWeight:700, color:C.text }}>Ops<span style={{ color:'#e60028' }}>Board</span></span>
          </div>
          <nav style={{ display:'flex', gap:2, flex:1, overflowX:'auto' }}>
            {VISTAS.map(v => (
              <button key={v} onClick={() => setVista(v)}
                style={{ padding:'5px 12px', borderRadius:6, fontSize:12, fontWeight:600, border:'none', cursor:'pointer',
                  background:vista===v?C.accent+'22':'transparent', color:vista===v?C.accent:C.muted, whiteSpace:'nowrap' }}>
                {v}
              </button>
            ))}
          </nav>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
            {lastUpd && <span style={{ fontSize:11, color:C.muted }}>{pad(lastUpd.getHours())}:{pad(lastUpd.getMinutes())}</span>}
            <button onClick={loadData} disabled={loading}
              style={{ background:'none', border:`1px solid ${C.border}`, color:C.muted, borderRadius:6, padding:'4px 10px', fontSize:12, cursor:'pointer' }}>
              {loading ? '⏳' : '🔄'}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div style={{ padding:'0 20px 60px' }}>
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:280, gap:12, color:C.muted }}>
            <div style={{ width:32, height:32, borderRadius:'50%', border:`3px solid ${C.border}`, borderTopColor:C.accent, animation:'spin .8s linear infinite' }} />
            <span>Cargando desde Seguimiento…</span>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
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
                owners={owners} setItem={setItemActivo} onNextSt={onNextSt} modo={modo} setModo={setModo} />
            )}
            {vista === 'Dashboard'          && <Dashboard allItems={allItems} />}
            {vista === '📅 Campañas CVM'    && <CampanasCVM campanas={campanas} />}
            {vista === '✨ IA Intake'        && <IAIntake onAdd={ni => setLocalItems(p => [...p, ...ni])} />}
            {vista === '📋 Reporte Semanal' && <Reporte items={allItems} />}
          </>
        )}
      </div>

      {itemActivo && (
        <ModalItem item={itemActivo} onClose={() => setItemActivo(null)}
          onStatusChange={(id, st) => { onStatusChange(id, st); setItemActivo(null) }} />
      )}
    </div>
  )
}
