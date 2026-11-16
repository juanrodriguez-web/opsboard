// Administración (solo administradores): who can log in, create a login, reset a password. The server enforces the admin check.
// `ui` injects shared styles (avoids a circular import with App.jsx).
import { useState, useEffect } from 'react'
import { listUsers, createUser, resetPassword, generatePassword } from '../lib/adminApi.js'

const fmt = iso => { try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '' } }

export default function AdminView({ ui }) {
  const { C } = ui
  const [users, setUsers] = useState(null)
  const [msg, setMsg] = useState(null)                       // { ok, text }
  const [form, setForm] = useState({ email: '', name: '', password: '' })
  const [reset, setReset] = useState(null)                   // { email, password }
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(null)                   // { email, password } just set, so the admin can copy it once
  const inp = { background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', fontSize: 12.5, outline: 'none', minWidth: 0, boxSizing: 'border-box' }
  const btn = (primary, dis) => ({ padding: '7px 14px', borderRadius: 6, border: primary ? 'none' : `1px solid ${C.border}`, background: primary ? C.accent : 'transparent', color: primary ? '#fff' : C.text, fontWeight: 600, fontSize: 12.5, cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.6 : 1 })
  const load = () => listUsers().then(setUsers).catch(e => { setUsers([]); setMsg({ ok: false, text: e.message }) })
  useEffect(() => { load() }, [])

  const doCreate = async e => {
    e.preventDefault(); setBusy(true); setMsg(null); setShown(null)
    try {
      const r = await createUser(form.email, form.password, form.name)
      setShown({ email: form.email.trim().toLowerCase(), password: form.password })
      setMsg({ ok: true, text: `Acceso creado para ${r.name || form.email}. Entrégale la contraseña y que la cambie con el botón 🔑.` })
      setForm({ email: '', name: '', password: '' }); load()
    } catch (err) { setMsg({ ok: false, text: err.message }) }
    setBusy(false)
  }
  const doReset = async () => {
    setBusy(true); setMsg(null); setShown(null)
    try {
      await resetPassword(reset.email, reset.password)
      setShown({ email: reset.email, password: reset.password })
      setMsg({ ok: true, text: 'Contraseña restablecida. Entrégasela a la persona y que la cambie con el botón 🔑.' }); setReset(null); load()
    } catch (err) { setMsg({ ok: false, text: err.message }) }
    setBusy(false)
  }
  const copy = t => { try { navigator.clipboard.writeText(t) } catch { /* the password is on screen to copy by hand */ } }

  return (
    <div style={{ maxWidth: 820, padding: '4px 2px' }}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
        Aquí das acceso a OpsBoard sin enviar correos. Cada persona necesita estar en OpsBoard y tener un acceso con contraseña. La contraseña se muestra una sola vez al crearla: apúntala o cópiala antes de salir de esta vista.
      </div>
      {msg && <div role="alert" style={{ fontSize: 12.5, marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: msg.ok ? '#ecfdf5' : '#fef2f2', color: msg.ok ? '#047857' : '#b91c1c' }}>{msg.text}</div>}
      {shown && (
        <div style={{ fontSize: 12.5, marginBottom: 14, padding: '10px 12px', borderRadius: 6, border: `1px dashed ${C.border}`, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span><b>{shown.email}</b> · contraseña: <code style={{ fontSize: 13, background: C.surface, padding: '2px 6px', borderRadius: 4 }}>{shown.password}</code></span>
          <button type="button" style={btn(false)} onClick={() => copy(shown.password)}>Copiar</button>
          <button type="button" style={btn(false)} onClick={() => setShown(null)}>Ocultar</button>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Dar acceso a una persona</div>
      <form onSubmit={doCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 22 }}>
        <input aria-label="Correo" type="email" placeholder="correo@sercomsoluciones.es" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ ...inp, flex: '2 1 220px' }} />
        <input aria-label="Nombre (solo si es nueva)" placeholder="Nombre (solo si es nueva)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, flex: '1 1 170px' }} />
        <input aria-label="Contraseña inicial" placeholder="Contraseña (mín. 8)" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={{ ...inp, flex: '1 1 150px' }} />
        <button type="button" style={btn(false)} onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}>Generar</button>
        <button type="submit" disabled={busy || !form.email || form.password.length < 8} style={btn(true, busy || !form.email || form.password.length < 8)}>Crear acceso</button>
      </form>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Personas de OpsBoard</div>
      {users === null ? <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div> : users.length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>No hay personas.</div> :
        users.map(u => (
          <div key={u.personId} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}{u.isAdmin && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: C.accent }}>ADMIN</span>}</div>
                <div style={{ fontSize: 11.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email || 'Sin correo: añádelo para poder dar acceso'}</div>
              </div>
              <span style={{ fontSize: 11.5, color: u.hasLogin ? '#059669' : '#b45309' }}>{u.hasLogin ? (u.lastSignIn ? 'Último acceso ' + fmt(u.lastSignIn) : 'Con acceso, aún sin entrar') : 'Sin acceso'}</span>
              {u.hasLogin && <button type="button" style={btn(false)} onClick={() => setReset({ email: u.email, password: '' })}>Restablecer contraseña</button>}
            </div>
            {reset?.email === u.email && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <input aria-label="Nueva contraseña" placeholder="Nueva contraseña (mín. 8)" value={reset.password} onChange={e => setReset(r => ({ ...r, password: e.target.value }))} style={{ ...inp, flex: '1 1 200px' }} />
                <button type="button" style={btn(false)} onClick={() => setReset(r => ({ ...r, password: generatePassword() }))}>Generar</button>
                <button type="button" disabled={busy || reset.password.length < 8} style={btn(true, busy || reset.password.length < 8)} onClick={doReset}>Guardar</button>
                <button type="button" style={btn(false)} onClick={() => setReset(null)}>Cancelar</button>
              </div>
            )}
          </div>
        ))}
    </div>
  )
}
