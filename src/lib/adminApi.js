// Client for /api/admin-users (user administration). The server decides who is an admin; this only forwards the session token.
import { getAccessToken } from './auth.js'

async function call(action, body = {}) {
  const token = await getAccessToken()
  if (!token) throw new Error('No has iniciado sesión.')
  const r = await fetch('/api/admin-users', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ action, ...body }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status)
  return j
}

export const amIAdmin = () => call('me').then(j => !!j.admin).catch(() => false)
export const listUsers = () => call('list').then(j => j.users)
export const createUser = (email, password, name) => call('create', { email, password, name })
export const resetPassword = (email, password) => call('reset', { email, password })

// Readable one-off password for the admin to hand over (12 chars, no look-alike characters).
export function generatePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, b => abc[b % abc.length]).join('')
}
