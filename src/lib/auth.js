// Sign-in with an e-mail link (Supabase Auth). The data layer (src/lib/api) never touches this: components call these helpers only.
// Login is OFF unless VITE_REQUIRE_AUTH === 'true' (so the code can ship before the database is locked down).
import { supabase } from './supabase.js'

export const AUTH_REQUIRED = import.meta.env.VITE_REQUIRE_AUTH === 'true'

export const getSession = async () => (await supabase.auth.getSession()).data.session

export const onSessionChange = cb => {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

// Sends a one-time sign-in link to the address. Returns null on success or a message for the user.
export async function sendLoginLink(email) {
  const clean = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return 'Escribe un correo válido'
  const { error } = await supabase.auth.signInWithOtp({ email: clean, options: { emailRedirectTo: window.location.origin } })
  if (error) return /rate|seconds|limit/i.test(error.message) ? 'Espera un minuto antes de pedir otro enlace' : 'No se pudo enviar el enlace: ' + error.message
  return null
}

export const signOut = async () => { try { await supabase.auth.signOut() } catch { /* offline: the local session is cleared anyway */ } }
