// api/admin-users.js with a fake Supabase client: who may call it, create / reset / list rules. Run: node scripts/migration/test-admin-api.cjs
const Module = require('module'), path = require('path'), assert = require('assert')
const state = { people: [{ id: 'p1', name: 'Juan', email: 'juan@x.es' }, { id: 'p2', name: 'Fran', email: 'fran@x.es' }], authUsers: [{ id: 'a1', email: 'juan@x.es', last_sign_in_at: '2026-11-16T10:00:00Z' }], tokens: { tj: 'juan@x.es', tf: 'fran@x.es' }, created: [], resets: [] }
const fake = { createClient: () => ({
  auth: {
    getUser: async t => state.tokens[t] ? { data: { user: { email: state.tokens[t] } }, error: null } : { data: {}, error: { message: 'bad' } },
    admin: {
      listUsers: async () => ({ data: { users: state.authUsers }, error: null }),
      createUser: async ({ email, password, email_confirm }) => { if (state.authUsers.some(u => u.email === email)) return { error: { message: 'User already registered' } }; assert(email_confirm === true); state.authUsers.push({ id: 'a' + email, email }); state.created.push({ email, password }); return { error: null } },
      updateUserById: async (id, { password }) => { state.resets.push({ id, password }); return { error: null } },
    } },
  from: () => ({
    select: () => ({ order: async () => ({ data: state.people, error: null }), ilike: (_c, v) => ({ maybeSingle: async () => ({ data: state.people.find(p => p.email === v) || null }) }) }),
    insert: async row => { state.people.push({ id: 'pn', ...row }); return { error: null } },
  }) }) }
const orig = Module._load
Module._load = function (req, ...a) { return req === '@supabase/supabase-js' ? fake : orig.call(this, req, ...a) }
process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'; process.env.ADMIN_EMAILS = 'Juan@x.es'
const handler = require(path.join(__dirname, '../../api/admin-users.js'))
const call = async (token, body, method = 'POST') => { let out; const res = { status: s => ({ json: b => { out = { s, b } }, end: () => { out = { s } } }) }; await handler({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, body }, res); return out }
const results = []; const ok = (n, c) => { results.push([c ? 'PASS' : 'FAIL', n]); if (!c) process.exitCode = 1 }
;(async () => {
  ok('GET not allowed', (await call('tj', {}, 'GET')).s === 405)
  ok('no token -> 401', (await call(null, { action: 'me' })).s === 401)
  ok('bad token -> 401', (await call('zzz', { action: 'me' })).s === 401)
  ok('admin me -> true (ADMIN_EMAILS is case-insensitive)', (await call('tj', { action: 'me' })).b.admin === true)
  ok('non-admin me -> false', (await call('tf', { action: 'me' })).b.admin === false)
  ok('non-admin cannot list / create / reset', (await call('tf', { action: 'list' })).s === 403 && (await call('tf', { action: 'create', email: 'n@x.es', password: '12345678', name: 'N' })).s === 403 && (await call('tf', { action: 'reset', email: 'juan@x.es', password: '12345678' })).s === 403)
  const l = await call('tj', { action: 'list' })
  ok('list joins people with logins and marks admins', l.b.users.length === 2 && l.b.users[0].hasLogin === true && l.b.users[0].isAdmin === true && l.b.users[1].hasLogin === false)
  ok('create validates e-mail and password length', (await call('tj', { action: 'create', email: 'nope', password: '12345678' })).s === 400 && (await call('tj', { action: 'create', email: 'fran@x.es', password: 'short' })).s === 400)
  ok('create for an existing person makes the login (auto-confirmed) without a new person', (await call('tj', { action: 'create', email: 'FRAN@x.es', password: 'secret123' })).b.ok === true && state.created.length === 1 && state.people.length === 2)
  ok('create again -> 409 pointing to reset', (await call('tj', { action: 'create', email: 'fran@x.es', password: 'secret123' })).s === 409)
  ok('create for an unknown person needs a name', (await call('tj', { action: 'create', email: 'new@x.es', password: 'secret123' })).s === 400)
  ok('create with a name also adds the person', (await call('tj', { action: 'create', email: 'new@x.es', password: 'secret123', name: 'Nueva' })).b.ok === true && state.people.some(p => p.email === 'new@x.es'))
  ok('reset changes the password of an existing login', (await call('tj', { action: 'reset', email: 'juan@x.es', password: 'newpass99' })).b.ok === true && state.resets[0].id === 'a1')
  ok('reset for someone without login -> 404', (await call('tj', { action: 'reset', email: 'ghost@x.es', password: 'newpass99' })).s === 404)
  ok('unknown action -> 400', (await call('tj', { action: 'drop', email: 'juan@x.es', password: 'newpass99' })).s === 400)
  console.table(results.map(([r, n]) => ({ result: r, test: n })))
})()
