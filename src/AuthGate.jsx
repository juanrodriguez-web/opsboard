// Shows the app only to a signed-in person who exists in OpsBoard (people.email). Off unless VITE_REQUIRE_AUTH=true.
// On success it stores the identity the app already uses for "My Work" (opsboard-me), so the rest of the app needs no change.
import { useState, useEffect } from 'react'
import { AUTH_REQUIRED, getSession, onSessionChange, sendLoginLink, signOut } from './lib/auth.js'
import { findPersonByEmail } from './lib/api/index.js'

const box = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#f6f5f3', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }
const card = { background: '#fff', border: '1px solid #e3e1dc', borderRadius: 12, padding: 28, width: '100%', maxWidth: 380, color: '#1d1f24', boxShadow: '0 8px 30px rgba(0,0,0,.06)' }
const btn = { width: '100%', padding: '10px 14px', borderRadius: 8, border: 'none', background: '#e8243b', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }

function Login() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault(); setBusy(true); setMsg('')
    const err = await sendLoginLink(email)
    setBusy(false)
    if (err) setMsg(err); else setSent(true)
  }
  return (
    <div style={box}><form style={card} onSubmit={submit}>
      <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>OpsBoard</h1>
      {sent ? <p style={{ fontSize: 14, lineHeight: 1.5, margin: '12px 0 0' }}>Te hemos enviado un enlace a <b>{email}</b>. Ábrelo en este navegador para entrar. Puedes cerrar esta pestaña de OpsBoard.</p> : <>
        <p style={{ fontSize: 13, color: '#6a6f7a', margin: '0 0 16px' }}>Escribe tu correo de Sercom y te enviamos un enlace de acceso.</p>
        <label htmlFor="login-email" style={{ fontSize: 12, fontWeight: 600 }}>Correo</label>
        <input id="login-email" type="email" autoFocus autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nombre@sercomsoluciones.es"
          style={{ width: '100%', boxSizing: 'border-box', margin: '4px 0 12px', padding: '9px 10px', border: '1px solid #e3e1dc', borderRadius: 8, fontSize: 14 }} />
        <button type="submit" disabled={busy || !email.trim()} style={{ ...btn, opacity: busy || !email.trim() ? 0.6 : 1 }}>{busy ? 'Enviando…' : 'Enviarme el enlace'}</button>
        {msg && <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginTop: 10 }}>{msg}</div>}
      </>}
    </form></div>
  )
}

function Denied({ email }) {
  return (
    <div style={box}><div style={card}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Sin acceso</h1>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 16px' }}>El correo <b>{email}</b> no está dado de alta en OpsBoard. Pide a Juan que lo añada y vuelve a entrar.</p>
      <button style={btn} onClick={signOut}>Usar otro correo</button>
    </div></div>
  )
}

function Gate({ children }) {
  const [session, setSession] = useState(undefined)      // undefined = still checking
  const [person, setPerson] = useState(undefined)         // undefined = checking, null = not in people
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    getSession().then(s => { if (alive) setSession(s) }).catch(() => { if (alive) setSession(null) })
    const off = onSessionChange(s => { if (alive) { setSession(s); setPerson(undefined) } })
    return () => { alive = false; off() }
  }, [])
  const email = session?.user?.email
  useEffect(() => {
    if (!email) return
    let alive = true
    findPersonByEmail(email).then(p => {
      if (!alive) return
      if (p) { try { localStorage.setItem('opsboard-me', JSON.stringify({ id: p.id, email: p.email, name: p.name })) } catch {} }
      setPerson(p || null)
    }).catch(e => { if (alive) setErr('No se pudo comprobar tu acceso: ' + (e.message || e)) })
    return () => { alive = false }
  }, [email])
  if (session === undefined) return <div style={box}>Cargando…</div>
  if (!session) return <Login />
  if (err) return <div style={box}><div style={card}><p style={{ fontSize: 13 }}>{err}</p><button style={btn} onClick={() => location.reload()}>Reintentar</button></div></div>
  if (person === undefined) return <div style={box}>Comprobando acceso…</div>
  if (person === null) return <Denied email={email} />
  return children
}

export default function AuthGate({ children }) {
  return AUTH_REQUIRED ? <Gate>{children}</Gate> : children
}
