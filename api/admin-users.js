// POST /api/admin-users — user administration for the OpsBoard admin tab (create login, reset password, list).
// The Supabase SERVICE ROLE key lives only here (Vercel env var), never in the browser.
// Env vars: SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS (comma separated; the only people who can use this), and SUPABASE_URL (or VITE_SUPABASE_URL).
// Every call needs the caller's session token: Authorization: Bearer <access_token>. The caller's e-mail is taken from the verified token.
const { createClient } = require('@supabase/supabase-js')

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const reply = (res, status, body) => res.status(status).json(body)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!URL || !SERVICE_KEY || !ADMINS.length) return reply(res, 500, { error: 'El servidor no está configurado (faltan variables de entorno).' })
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(res, 401, { error: 'No has iniciado sesión.' })
  const sb = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: u, error: ue } = await sb.auth.getUser(token)
  const caller = u?.user?.email?.toLowerCase()
  if (ue || !caller) return reply(res, 401, { error: 'Sesión no válida.' })
  const isAdmin = ADMINS.includes(caller)

  const { action, email, password, name } = req.body || {}
  if (action === 'me') return reply(res, 200, { admin: isAdmin })
  if (!isAdmin) return reply(res, 403, { error: 'Solo administradores.' })

  try {
    if (action === 'list') {
      const { data: people, error: pe } = await sb.from('people').select('id, name, email').order('name')
      if (pe) throw pe
      const { data: au, error: ae } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (ae) throw ae
      const byEmail = new Map((au.users || []).map(x => [String(x.email || '').toLowerCase(), x]))
      return reply(res, 200, {
        users: (people || []).map(p => {
          const a = p.email ? byEmail.get(p.email.toLowerCase()) : null
          return { personId: p.id, name: p.name, email: p.email || '', hasLogin: !!a, lastSignIn: a?.last_sign_in_at || null, isAdmin: !!p.email && ADMINS.includes(p.email.toLowerCase()) }
        }),
      })
    }

    const mail = String(email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(mail)) return reply(res, 400, { error: 'Correo no válido.' })
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) return reply(res, 400, { error: 'La contraseña debe tener entre 8 y 72 caracteres.' })

    if (action === 'create') {
      const { data: existing } = await sb.from('people').select('id, name').ilike('email', mail).maybeSingle()
      let personName = existing?.name
      if (!existing) {
        personName = String(name || '').trim()
        if (!personName) return reply(res, 400, { error: 'Ese correo no está en OpsBoard: escribe también el nombre de la persona.' })
        const { error: ie } = await sb.from('people').insert({ name: personName, email: mail })
        if (ie) throw ie
      }
      const { error: ce } = await sb.auth.admin.createUser({ email: mail, password, email_confirm: true })
      if (ce) return reply(res, /already|registered|exists/i.test(ce.message) ? 409 : 400, { error: /already|registered|exists/i.test(ce.message) ? 'Esa persona ya tiene acceso: usa «Restablecer contraseña».' : 'No se pudo crear el acceso.' })
      console.log('[admin-users] created login for', mail, 'by', caller)
      return reply(res, 200, { ok: true, name: personName })
    }

    if (action === 'reset') {
      const { data: au, error: ae } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (ae) throw ae
      const target = (au.users || []).find(x => String(x.email || '').toLowerCase() === mail)
      if (!target) return reply(res, 404, { error: 'Esa persona todavía no tiene acceso: créalo primero.' })
      const { error: re } = await sb.auth.admin.updateUserById(target.id, { password })
      if (re) return reply(res, 400, { error: 'No se pudo cambiar la contraseña.' })
      console.log('[admin-users] password reset for', mail, 'by', caller)
      return reply(res, 200, { ok: true })
    }

    return reply(res, 400, { error: 'Acción desconocida.' })
  } catch (e) {
    console.error('[admin-users]', e && e.message)
    return reply(res, 500, { error: 'Error del servidor.' })
  }
}
