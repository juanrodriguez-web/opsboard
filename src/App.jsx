import { useState, useEffect, useRef } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { parseSheetValues, buildItems, norm } from './parser.js'

// ── Constants ────────────────────────────────────────────────────────────────
const CATS = [
  { id:'projects', label:'Proyectos',    color:'#60a5fa', bg:'#1a2740' },
  { id:'product',  label:'Producto',     color:'#a78bfa', bg:'#211a40' },
  { id:'tools',    label:'Herramientas', color:'#fbbf24', bg:'#3d2e0a' },
]
const ST = [
  { id:'pending',    label:'Pendiente',  color:'#64748b' },
  { id:'inprogress', label:'En Curso',   color:'#60a5fa' },
  { id:'blocked',    label:'Bloqueado',  color:'#f87171' },
  { id:'done',       label:'Completado', color:'#34d399' },
]
const RK = [
  { id:'green',  label:'Normal',   color:'#34d399' },
  { id:'yellow', label:'Atención', color:'#fbbf24' },
  { id:'red',    label:'Riesgo',   color:'#f87171' },
]
const ST_TO_SHEET = {
  pending:'No iniciado', inprogress:'Según lo planificado',
  blocked:'En peligro',  done:'Hecho',
}
const MC = ['#60a5fa','#a78bfa','#fbbf24','#34d399','#f87171','#fb923c']
const C  = {
  bg:'#0b0d17', surface:'#13162a', card:'#1a1e35',
  border:'#242843', text:'#e2e8f0', muted:'#5a6485', accent:'#60a5fa',
}
const OV_KEY       = 'obs-status-overrides'
const COMMENTS_KEY = 'obs-comments'

// ── Helpers ──────────────────────────────────────────────────────────────────
const uid       = () => Math.random().toString(36).slice(2, 9)
const pad       = n  => String(n).padStart(2, '0')
const hoy       = () => new Date().toISOString().slice(0, 10)
const fmtFecha  = d => {
  if (!d) return '—'
  try { return new Date(d + 'T12:00').toLocaleDateString('es-ES', { day:'2-digit', month:'short' }) }
  catch { return d }
}
const diasAbierta   = c => Math.floor((Date.now() - new Date(c).getTime()) / 86400000)
const diasRestantes = e => e ? Math.ceil((new Date(e + 'T23:59').getTime() - Date.now()) / 86400000) : null
const iniciales     = n => (n || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()

// localStorage helpers
const lsGet = (k, def = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def } catch { return def } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

// Status overrides (persist local changes until Sheet syncs)
const getOverrides    = ()           => lsGet(OV_KEY, {})
const saveOverride    = (k, st, sh)  => { const ov = getOverrides(); ov[k] = { status: st, estadoSheet: sh, ts: new Date().toISOString() }; lsSet(OV_KEY, ov) }
const getComments     = (k)          => (lsGet(COMMENTS_KEY, []) || []).filter(c => c.k === k)
const saveComment     = (k, text)    => {
  const all  = lsGet(COMMENTS_KEY, []) || []
  const now  = new Date()
  const ts   = `${pad(now.getDate())}/${pad(now.getMonth()+1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const item = { k, ts, text, id: uid(), iso: now.toISOString() }
  lsSet(COMMENTS_KEY, [item, ...all].slice(0, 300))
  return item
}

// Apply local overrides on top of Sheet data
function applyOverrides(items) {
  const ov = getOverrides()
  return items.map(item => {
    const k  = norm(item.tema)
    const o  = ov[k]
    if (!o) return item
    // If Sheet finally matches override → clear it
    if (item.status === o.status) {
      const fresh = getOverrides(); delete fresh[k]; lsSet(OV_KEY, fresh)
      return item
    }
    return { ...item, status: o.status, estadoSheet: o.estadoSheet }
  })
}

// ── API calls ────────────────────────────────────────────────────────────────
async function fetchItems() {
  const res  = await fetch('/api/data')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { values } = await res.json()
  const tables = parseSheetValues(values)
  return applyOverrides(buildItems(tables))
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
const Avatar = ({ name, color, size = 26 }) => (
  <div style={{ width:size, height:size, borderRadius:'50%', background:color+'28', border:`1.5px solid ${color}66`,
    display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*.38,
    fontWeight:700, color, fontFamily:'monospace', flexShrink:0 }}>
    {iniciales(name)}
  </div>
)
const Dot  = ({ risk }) => { const r = RK.find(x => x.id === risk) || RK[0]; return <div style={{ width:8, height:8, borderRadius:'50%', background:r.color, boxShadow:`0 0 5px ${r.color}88`, flexShrink:0 }} title={r.label} /> }
const Tag  = ({ id, type }) => {
  const src  = type === 'cat' ? CATS : ST
  const item = src.find(x => x.id === id)
  if (!item) return null
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:type==='cat'?item.bg:item.color+'22', color:item.color, textTransform:'uppercase', letterSpacing:'.05em' }}>{item.label}</span>
}
const Sel  = ({ value, onChange, opts, style }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', fontSize:13, outline:'none', cursor:'pointer', width:'100%', ...style }}>
    {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
  </select>
)
const Inp  = ({ value, onChange, placeholder, type='text', onKeyDown, style }) => (
  <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} onKeyDown={onKeyDown}
    style={{ background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'8px 12px', fontSize:13, outline:'none', width:'100%', ...style }} />
)
const TA   = ({ value, onChange, placeholder, rows = 4, style }) => (
  <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
    style={{ background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:'8px 12px', fontSize:13, outline:'none', width:'100%', resize:'vertical', fontFamily:'inherit', ...style }} />
)
const Btn  = ({ onClick, children, v='primary', style, disabled }) => {
  const vs = {
    primary: { background:C.accent, color:'#fff', border:'none' },
    sec:     { background:C.card, color:C.text, border:`1px solid ${C.border}` },
    danger:  { background:'#f8717122', color:'#f87171', border:'1px solid #f8717133' },
    ghost:   { background:'transparent', color:C.muted, border:'none' },
  }
  return <button onClick={onClick} disabled={disabled}
    style={{ padding:'8px 16px', borderRadius:6, fontSize:13, fontWeight:600, cursor:disabled?'not-allowed':'pointer', opacity:disabled?.5:1, display:'inline-flex', alignItems:'center', gap:6, ...vs[v], ...style }}>
    {children}
  </button>
}
const Lbl = ({ children }) => <div style={{ fontSize:10, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:5 }}>{children}</div>

const AlertFecha = ({ endDate, status }) => {
  if (!endDate || status === 'done') return null
  const dl = diasRestantes(endDate)
  const color = dl < 0 ? '#f87171' : dl <= 3 ? '#fbbf24' : C.muted
  const txt   = dl < 0 ? `Vencida ${Math.abs(dl)}d` : dl === 0 ? 'Hoy' : dl <= 3 ? `${dl}d` : fmtFecha(endDate)
  return <span style={{ fontSize:10, color, fontWeight:dl<=3?700:400, background:dl<=3?color+'22':'transparent', padding:dl<=3?'2px 5px':'0', borderRadius:4 }}>{txt}</span>
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────
const Tarjeta = ({ item, onClick, onNextSt }) => {
  const cat    = CATS.find(c => c.id === item.category)
  const nextId = ST[(ST.findIndex(s => s.id === item.status) + 1) % ST.length].id
  const stOk   = (item.subtareas || []).filter(s => s.status === 'done').length
  const stTot  = (item.subtareas || []).length
  const dl     = item.fechaFin && item.status !== 'done' ? diasRestantes(item.fechaFin instanceof Date ? item.fechaFin.toISOString().slice(0,10) : item.fechaFin) : null
  const oc     = item.propietario ? '#60a5fa' : C.muted

  return (
    <div onClick={() => onClick(item)}
      style={{ background:C.card, borderRadius:8, padding:12, marginBottom:8,
        border:`1px solid ${dl!==null&&dl<0?'#f8717155':C.border}`, borderLeft:`3px solid ${cat?.color||C.muted}`, cursor:'pointer' }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:6 }}>
        <Dot risk={item.risk} />
        <span style={{ flex:1, fontSize:13, fontWeight:600, color:C.text, lineHeight:1.35 }}>{item.tema}</span>
      </div>
      {item.objetivo && <p style={{ fontSize:11, color:C.muted, marginBottom:8, lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{item.objetivo}</p>}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, flex:1, flexWrap:'wrap' }}>
          <div style={{ width:20, height:20, borderRadius:'50%', background:oc+'28', border:`1.5px solid ${oc}66`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, fontWeight:700, color:oc, fontFamily:'monospace', flexShrink:0 }}>{iniciales(item.propietario)}</div>
          <AlertFecha endDate={item.fechaFin instanceof Date ? item.fechaFin.toISOString().slice(0,10) : item.fechaFin} status={item.status} />
          {item.prioridad && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:RK.find(r=>r.id===item.risk)?.color+'22', color:RK.find(r=>r.id===item.risk)?.color }}>{item.prioridad}</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          {stTot > 0 && <span style={{ fontSize:10, color:C.muted }}>{stOk}/{stTot}</span>}
          <button onClick={e => { e.stopPropagation(); onNextSt(item.id, nextId) }}
            title={`→ ${ST.find(s => s.id === nextId)?.label}`}
            style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:4, padding:'2px 6px', fontSize:10, cursor:'pointer', color:C.muted }}>→</button>
        </div>
      </div>
    </div>
  )
}

// ── Tablero ───────────────────────────────────────────────────────────────────
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
                background:modo===v.id?'#60a5fa22':C.card, color:modo===v.id?'#60a5fa':C.muted, cursor:'pointer' }}>{v.l}</button>
          ))}
        </div>
      </div>

      {modo === 'kanban' ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
          {ST.map(st => {
            const col = f.filter(i => i.status === st.id)
            return (
              <div key={st.id}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:st.color }} />
                    <span style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.08em' }}>{st.label}</span>
                    <span style={{ fontSize:10, color:st.color, background:st.color+'22', borderRadius:10, padding:'1px 6px' }}>{col.length}</span>
                  </div>
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
              const ov  = item.fechaFin && item.status !== 'done' && diasRestantes(item.fechaFin instanceof Date ? item.fechaFin.toISOString().slice(0,10) : item.fechaFin) < 0
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
                  <Tag id={item.status} type="st" />
                  <span style={{ fontSize:12, color:C.muted }}>{(item.propietario||'').split(' ')[0]}</span>
                  <span style={{ fontSize:11, color:ov?'#f87171':C.muted, fontWeight:ov?700:400 }}>
                    {item.fechaFin ? fmtFecha(item.fechaFin instanceof Date ? item.fechaFin.toISOString().slice(0,10) : item.fechaFin) : '—'}
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
const Dashboard = ({ items }) => {
  const bySt   = ST.map(s => ({ name:s.label, v:items.filter(i=>i.status===s.id).length, color:s.color }))
  const byCat  = CATS.map(c => ({ name:c.label, value:items.filter(i=>i.category===c.id).length, color:c.color }))
  const owners = [...new Set(items.map(i => i.propietario).filter(Boolean))]
  const byOwn  = owners.map(o => ({
    name:  o.split(' ')[0],
    total: items.filter(i => i.propietario === o).length,
    curso: items.filter(i => i.propietario === o && i.status === 'inprogress').length,
    color: '#60a5fa',
  }))
  const vencidas = items.filter(i => i.fechaFin && i.status !== 'done' && diasRestantes(i.fechaFin instanceof Date ? i.fechaFin.toISOString().slice(0,10) : i.fechaFin) < 0)
  const kpis = [
    { l:'Total',        v:items.length,                                       c:C.accent },
    { l:'En Curso',     v:items.filter(i=>i.status==='inprogress').length,    c:'#60a5fa' },
    { l:'Bloqueados',   v:items.filter(i=>i.status==='blocked').length,       c:'#f87171' },
    { l:'Riesgo 🔴',    v:items.filter(i=>i.risk==='red'&&i.status!=='done').length, c:'#f87171' },
    { l:'Vencidas ⚠️', v:vencidas.length,                                    c:'#fbbf24' },
    { l:'Completados ✓',v:items.filter(i=>i.status==='done').length,          c:'#34d399' },
  ]
  const tt = { contentStyle:{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, fontSize:12 } }
  return (
    <div style={{ paddingTop:16 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:18 }}>
        {kpis.map((k,i) => (
          <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:28, fontWeight:700, color:k.c, lineHeight:1 }}>{k.v}</div>
            <div style={{ fontSize:10, color:C.muted, marginTop:5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em' }}>{k.l}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:18 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:14 }}>Carga por persona</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={byOwn} barSize={20}>
              <XAxis dataKey="name" tick={{ fill:C.muted, fontSize:11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:C.muted, fontSize:10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...tt} /><Legend wrapperStyle={{ fontSize:11, color:C.muted }} />
              <Bar dataKey="total" name="Total"   radius={[4,4,0,0]}>{byOwn.map((_,i)=><Cell key={i} fill="#60a5fa88"/>)}</Bar>
              <Bar dataKey="curso" name="En Curso" radius={[4,4,0,0]}>{byOwn.map((_,i)=><Cell key={i} fill="#60a5fa"/>)}</Bar>
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
              <Tooltip contentStyle={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, fontSize:12 }} />
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
        <div style={{ background:'#f8717111', border:'1px solid #f8717133', borderRadius:10, padding:16 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#f87171', marginBottom:10 }}>⚠️ Temas vencidos ({vencidas.length})</div>
          {vencidas.map(item => (
            <div key={item.id} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6, flexWrap:'wrap' }}>
              <Tag id={item.category} type="cat" />
              <span style={{ flex:1, fontSize:13, color:C.text }}>{item.tema}</span>
              <span style={{ fontSize:11, color:'#f87171', fontWeight:700 }}>
                {Math.abs(diasRestantes(item.fechaFin instanceof Date ? item.fechaFin.toISOString().slice(0,10) : item.fechaFin))}d vencida
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── IA Intake ─────────────────────────────────────────────────────────────────
const IAIntake = ({ onAdd }) => {
  const [txt, setTxt]       = useState('')
  const [busy, setBusy]     = useState(false)
  const [pending, setPending] = useState(null)
  const [err, setErr]       = useState('')

  const run = async () => {
    if (!txt.trim()) return
    setBusy(true); setErr(''); setPending(null)
    try {
      const raw = await callClaude({
        model: 'claude-sonnet-4-20250514', max_tokens: 1000,
        system: 'Extrae tareas del texto. SOLO JSON:\n{"items":[{"category":"projects|product|tools","title":"string","description":"string","subtasks":["string"],"risk":"green|yellow|red","endDate":"YYYY-MM-DD|null"}]}',
        messages: [{ role:'user', content:txt }],
      })
      const p = JSON.parse(raw.replace(/```json|```/g,'').trim())
      setPending((p.items||[]).map(i => ({ ...i, assignee:'' })))
    } catch { setErr('Error procesando el texto.') }
    setBusy(false)
  }

  const confirmar = () => {
    const ni = pending.map(ai => ({
      id: uid(), category:ai.category||'projects', tema:ai.title,
      objetivo:ai.description||'', propietario:'', status:'pending',
      estadoSheet:'No iniciado', risk:ai.risk||'green', prioridad:'',
      fechaInicio:null, fechaFin:ai.endDate?new Date(ai.endDate):null,
      archivos:'', notas:'Creado desde IA Intake',
      subtareas:(ai.subtasks||[]).map(s=>({id:uid(),title:s,prop:'',status:'pending',risk:'green',fechaFin:null,notas:''})),
      _local: true,
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
      {err && <div style={{ color:'#f87171', fontSize:13, marginBottom:12 }}>{err}</div>}
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
                {item.description && <p style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{item.description}</p>}
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
  const [txt, setTxt]     = useState('')
  const [busy, setBusy]   = useState(false)
  const [fmt, setFmt]     = useState('email')
  const [copied, setCopied] = useState(false)

  const generar = async () => {
    setBusy(true); setTxt('')
    const all = items
    const stats = {
      fecha:      new Date().toLocaleDateString('es-ES',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}),
      total:      all.length,
      porEstado:  ST.map(s => ({ estado:s.label, n:all.filter(i=>i.status===s.id).length })),
      porArea:    CATS.map(c => ({ area:c.label, n:all.filter(i=>i.category===c.id).length })),
      enRiesgo:   all.filter(i=>i.risk==='red'&&i.status!=='done').map(i=>i.tema),
      bloqueados: all.filter(i=>i.status==='blocked').map(i=>({ tema:i.tema, prop:i.propietario })),
      completados:all.filter(i=>i.status==='done').map(i=>i.tema),
      vencidos:   all.filter(i=>i.fechaFin&&i.status!=='done').filter(i => {
        const d = i.fechaFin instanceof Date ? i.fechaFin.toISOString().slice(0,10) : i.fechaFin
        return d && diasRestantes(d) < 0
      }).map(i=>i.tema),
      equipo: [...new Set(all.map(i=>i.propietario).filter(Boolean))].map(p=>({
        nombre: p,
        total:  all.filter(i=>i.propietario===p).length,
        enCurso:all.filter(i=>i.propietario===p&&i.status==='inprogress').length,
      })),
    }
    const fi = fmt === 'email'
      ? 'Formato email ejecutivo, texto plano, tono profesional, máximo 350 palabras.'
      : 'Formato bullets concisos para reunión de 5 min, máximo 20 bullets.'
    try {
      const r = await callClaude({
        model:'claude-sonnet-4-20250514', max_tokens:1200,
        system:`Eres el responsable de producto digital prepago de Vodafone España. ${fi} Estructura: 1) Resumen ejecutivo, 2) Estado por áreas, 3) Equipo, 4) Riesgos/bloqueos, 5) Próximos pasos.`,
        messages:[{ role:'user', content:`Datos:\n${JSON.stringify(stats,null,2)}` }],
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
        {[{ id:'email', l:'📧 Email' }, { id:'bullets', l:'• Bullets' }].map(f => (
          <button key={f.id} onClick={() => setFmt(f.id)}
            style={{ padding:'5px 12px', borderRadius:6, fontSize:12, fontWeight:600, border:`1px solid ${C.border}`,
              background:fmt===f.id?'#60a5fa22':C.card, color:fmt===f.id?'#60a5fa':C.muted, cursor:'pointer' }}>{f.l}</button>
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
  const [newSt, setNewSt]     = useState(item.status)
  const [nc, setNc]           = useState('')
  const [saving, setSaving]   = useState(false)
  const cat  = CATS.find(c => c.id === item.category)
  const localComments = getComments(norm(item.tema))

  const guardarEstado = async () => {
    if (newSt === item.status) { onClose(); return }
    setSaving(true)
    try { await apiUpdate(item.tema, ST_TO_SHEET[newSt]) } catch {}
    saveOverride(norm(item.tema), newSt, ST_TO_SHEET[newSt])
    onStatusChange(item.id, newSt)
    setSaving(false)
    onClose()
  }

  const guardarComentario = async () => {
    const text = nc.trim()
    if (!text) return
    setSaving(true)
    const c = saveComment(norm(item.tema), text)
    const noteStr = `[${c.ts}] ${text}`
    try { await apiUpdate(item.tema, undefined, noteStr) } catch {}
    setNc('')
    setSaving(false)
  }

  const stOk  = (item.subtareas||[]).filter(s => s.status==='done').length
  const rc    = RK.find(r => r.id === item.risk)?.color || '#94a3b8'
  const fdStr = (d) => d instanceof Date ? d.toISOString().slice(0,10) : (d||'')
  const dl    = item.fechaFin ? diasRestantes(fdStr(item.fechaFin)) : null

  return (
    <div style={{ position:'fixed', inset:0, background:'#00000099', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget&&onClose()}>
      <div style={{ background:C.surface, borderRadius:12, border:`1px solid ${C.border}`, width:'100%', maxWidth:680, maxHeight:'92vh', overflow:'hidden', display:'flex', flexDirection:'column' }}>
        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:3, height:22, borderRadius:2, background:cat?.color||C.muted, flexShrink:0 }} />
          <h3 style={{ flex:1, fontSize:15, fontWeight:700, color:C.text, lineHeight:1.3 }}>{item.tema}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:18, padding:'2px 6px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:18 }}>
          {/* Fields */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
            <div><Lbl>Área</Lbl><Tag id={item.category} type="cat" /></div>
            <div>
              <Lbl>Estado</Lbl>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Sel value={newSt} onChange={setNewSt} opts={ST.map(s=>({v:s.id,l:s.label}))} style={{ width:'auto', flex:1 }} />
                <Btn onClick={guardarEstado} disabled={saving} style={{ padding:'6px 12px', fontSize:12, flexShrink:0 }}>
                  {saving?'…':'Guardar'}
                </Btn>
              </div>
            </div>
            <div>
              <Lbl>Propietario</Lbl>
              <span style={{ fontSize:13, color:C.text }}>{item.propietario||'—'}</span>
            </div>
            <div>
              <Lbl>Prioridad</Lbl>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <Dot risk={item.risk} />
                <span style={{ fontSize:13, color:rc, fontWeight:700 }}>{item.prioridad||'—'}</span>
              </div>
            </div>
            <div>
              <Lbl>Fecha inicio</Lbl>
              <span style={{ fontSize:13, color:C.text }}>{fmtFecha(fdStr(item.fechaInicio))}</span>
            </div>
            <div>
              <Lbl>Fecha fin</Lbl>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:13, color:C.text }}>{fmtFecha(fdStr(item.fechaFin))}</span>
                {dl !== null && dl < 0 && item.status !== 'done' && <span style={{ fontSize:10, background:'#fee2e2', color:'#ef4444', padding:'2px 6px', borderRadius:4, fontWeight:700 }}>{Math.abs(dl)}d vencida</span>}
              </div>
            </div>
          </div>

          {item.objetivo && <div style={{ marginBottom:16 }}><Lbl>Objetivo</Lbl><p style={{ fontSize:13, color:C.text, lineHeight:1.6 }}>{item.objetivo}</p></div>}

          {/* Subtareas */}
          {item.subtareas.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <Lbl>Subtareas ({stOk}/{item.subtareas.length})</Lbl>
              {item.subtareas.map((st,i) => {
                const sc  = ST.find(s=>s.id===st.status)||ST[0]
                const src = RK.find(r=>r.id===st.risk)?.color||'#94a3b8'
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:C.card, borderRadius:6, padding:'7px 10px', marginBottom:5, border:`1px solid ${C.border}` }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background:src, flexShrink:0 }} />
                    <span style={{ flex:1, fontSize:12, color:st.status==='done'?C.muted:C.text, textDecoration:st.status==='done'?'line-through':'none' }}>{st.title}</span>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, background:sc.color+'22', color:sc.color }}>{sc.label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Comments */}
          <div style={{ marginBottom:16 }}>
            <Lbl>Actualizaciones</Lbl>
            {localComments.map(c => (
              <div key={c.id} style={{ display:'flex', gap:10, padding:'9px 12px', background:C.card, borderRadius:6, marginBottom:5, borderLeft:`3px solid ${C.accent}` }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:C.muted, marginBottom:3 }}>
                    <span style={{ fontWeight:700, color:C.accent }}>[{c.ts}]</span>
                  </div>
                  <div style={{ fontSize:13, color:C.text, lineHeight:1.5, whiteSpace:'pre-wrap' }}>{c.text}</div>
                </div>
              </div>
            ))}
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:localComments.length>0?10:0 }}>
              <TA value={nc} onChange={setNc} placeholder="Escribe una actualización… se graba con fecha y hora." rows={2}
                onKeyDown={e => { if(e.ctrlKey&&e.key==='Enter'){ guardarComentario(); e.preventDefault() } }} />
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Btn onClick={guardarComentario} disabled={saving||!nc.trim()} style={{ padding:'6px 14px', fontSize:12 }}>
                  💬 Guardar
                </Btn>
                <span style={{ fontSize:11, color:C.muted }}>Ctrl+Enter</span>
              </div>
            </div>
          </div>

          {/* Notas del seguimiento */}
          {item.notas && (
            <div>
              <Lbl>Notas de Seguimiento</Lbl>
              <div style={{ fontSize:12, color:C.muted, lineHeight:1.6, background:C.card, borderRadius:8, padding:12,
                maxHeight:200, overflowY:'auto', borderLeft:`3px solid ${C.border}`, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
                {item.notas}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
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
  const [localItems,  setLocalItems] = useState([])   // items created via IA Intake
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
      const fetched = await fetchItems()
      setItems(fetched)
      setLastUpd(new Date())
    } catch (e) {
      setError(e.message || String(e))
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const onStatusChange = (id, newSt) => {
    setItems(prev => prev.map(i => i.id===id ? {...i, status:newSt, estadoSheet:ST_TO_SHEET[newSt]} : i))
  }

  const onNextSt = async (id, newSt) => {
    const item = allItems.find(i => i.id===id)
    if (!item) return
    saveOverride(norm(item.tema), newSt, ST_TO_SHEET[newSt])
    try { await apiUpdate(item.tema, ST_TO_SHEET[newSt]) } catch {}
    onStatusChange(id, newSt)
  }

  const VISTAS = ['Tablero','Dashboard','✨ IA Intake','📋 Reporte Semanal']

  return (
    <div style={{ background:C.bg, minHeight:'100vh', color:C.text, fontFamily:'system-ui,sans-serif' }}>
      {/* Header */}
      <header style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'0 20px', display:'flex', alignItems:'center', gap:10, height:52, position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginRight:6, flexShrink:0 }}>
          <div style={{ width:28, height:28, borderRadius:7, background:'linear-gradient(135deg,#60a5fa,#a78bfa)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, color:'#fff' }}>⬡</div>
          <span style={{ fontSize:13, fontWeight:700, color:C.text }}>Ops<span style={{ color:'#60a5fa' }}>Board</span></span>
        </div>
        <nav style={{ display:'flex', gap:2, flex:1, overflowX:'auto' }}>
          {VISTAS.map(v => (
            <button key={v} onClick={() => setVista(v)}
              style={{ padding:'5px 12px', borderRadius:6, fontSize:12, fontWeight:600, border:'none', cursor:'pointer',
                background:vista===v?'#60a5fa22':'transparent', color:vista===v?'#60a5fa':C.muted, whiteSpace:'nowrap' }}>
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
          <div style={{ marginTop:40, textAlign:'center', color:'#f87171' }}>
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
            {vista === 'Dashboard'         && <Dashboard items={allItems} />}
            {vista === '✨ IA Intake'      && <IAIntake onAdd={ni => setLocalItems(p => [...p, ...ni])} />}
            {vista === '📋 Reporte Semanal' && <Reporte items={allItems} />}
          </>
        )}
      </div>

      {itemActivo && (
        <ModalItem
          item={itemActivo}
          onClose={() => setItemActivo(null)}
          onStatusChange={(id, st) => { onStatusChange(id, st); setItemActivo(null) }}
        />
      )}
    </div>
  )
}
