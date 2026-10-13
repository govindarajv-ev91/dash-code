import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdminHandler } from '../supabase/functions/dashboard-admin/handler.js'
import { corsHeaders as sdkCorsHeaders } from '@supabase/supabase-js/cors'

const adminId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'
function fixture({ role = 'admin', targetRole = 'user', identityError = null, profileError = null } = {}) {
  const calls = []
  const client = {
    auth: {
      async getUser(token) { calls.push(['getUser', token]); return { data: { user: { id: adminId } }, error: identityError } },
      admin: {
        async createUser(body) { calls.push(['createUser', body]); return { data: { user: { id: targetId } }, error: null } },
        async deleteUser(id) { calls.push(['deleteUser', id]); return { error: null } },
      },
    },
    from(table) {
      const query = { table }
      const builder = {}
      for (const method of ['select', 'eq', 'order', 'range', 'update']) builder[method] = (...args) => {
        query[method] = args; calls.push([table, method, ...args]); return builder
      }
      function result() {
        if (table === 'dashboard_settings') return { data: query.update[0], error: null }
        if (query.eq) return { data: { role: query.eq[1] === adminId ? role : targetRole }, error: query.eq[1] === adminId ? profileError : null }
        return { data: [{ id: targetId, role: targetRole }], count: 1, error: null }
      }
      builder.maybeSingle = builder.single = async () => result()
      builder.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
      return builder
    },
  }
  const handler = createAdminHandler(client)
  async function request(body, token = 'verified-token') {
    const response = await handler(new Request('https://example.test/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }))
    return { status: response.status, body: await response.json() }
  }
  return { client, calls, request, handler }
}

test('browser preflight allows SDK headers without authentication and errors keep CORS', async () => {
  const view = fixture()
  const response = await view.handler(new Request('https://example.test/admin', {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': sdkCorsHeaders['Access-Control-Allow-Headers'] },
  }))
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  const allowed = response.headers.get('access-control-allow-headers').split(',').map((value) => value.trim())
  for (const header of sdkCorsHeaders['Access-Control-Allow-Headers'].split(',').map((value) => value.trim())) {
    assert.ok(allowed.includes(header), `Missing browser request header: ${header}`)
  }
  assert.match(response.headers.get('access-control-allow-methods'), /POST/)
  assert.deepEqual(view.calls, [])
  const rejected = await view.handler(new Request('https://example.test/admin', { method: 'POST' }))
  assert.equal(rejected.status, 401)
  assert.equal(rejected.headers.get('access-control-allow-origin'), '*')
})

test('missing/invalid credentials cannot inspect users or mutate anything', async () => {
  const first = fixture()
  assert.equal((await first.request({ action: 'list-users' }, null)).status, 401)
  assert.deepEqual(first.calls, [])
  const invalid = fixture({ identityError: new Error('revoked') })
  assert.equal((await invalid.request({ action: 'create-user' })).status, 401)
  assert.equal(invalid.calls.some((call) => call[0] === 'createUser'), false)
})
test('ordinary users cannot create/delete users or disable login, even with forged role', async () => {
  for (const action of ['create-user', 'delete-user', 'set-login-enabled', 'list-users']) {
    const view = fixture({ role: 'user' })
    assert.equal((await view.request({ action, role: 'admin', login_enabled: false, user_id: targetId })).status, 403)
    assert.equal(view.calls.some((call) => ['createUser', 'deleteUser'].includes(call[0]) || call[1] === 'update'), false)
  }
})
test('profile lookup failure denies admin access', async () => {
  const view = fixture({ profileError: new Error('missing table') })
  assert.equal((await view.request({ action: 'set-login-enabled', login_enabled: false })).status, 503)
  assert.equal(view.calls.some((call) => call[1] === 'update'), false)
})
test('create uses Auth admin API and ignores attempted role escalation', async () => {
  const view = fixture()
  const result = await view.request({ action: 'create-user', email: ' Staff@Example.com ', password: '  secret  ', display_name: 'Staff', role: 'admin' })
  assert.equal(result.status, 201)
  assert.deepEqual(view.calls.find((call) => call[0] === 'createUser')[1], {
    email: 'staff@example.com', password: '  secret  ', email_confirm: true, user_metadata: { display_name: 'Staff' },
  })
  assert.equal(result.body.user.role, 'user')
  assert.equal(JSON.stringify(result.body).includes('secret'), false)
})
test('rejects invalid email/password before Auth writes', async () => {
  for (const body of [{ email: 'bad', password: '123456' }, { email: 'a@example.com', password: '123' }]) {
    const view = fixture()
    assert.equal((await view.request({ action: 'create-user', ...body })).status, 400)
    assert.equal(view.calls.some((call) => call[0] === 'createUser'), false)
  }
})
test('self and administrator deletion are protected; ordinary deletion uses Auth', async () => {
  const self = fixture()
  assert.equal((await self.request({ action: 'delete-user', user_id: adminId })).status, 409)
  const protectedUser = fixture({ targetRole: 'admin' })
  assert.equal((await protectedUser.request({ action: 'delete-user', user_id: targetId })).status, 409)
  assert.equal(protectedUser.calls.some((call) => call[0] === 'deleteUser'), false)
  const ordinary = fixture()
  assert.equal((await ordinary.request({ action: 'delete-user', user_id: targetId })).status, 200)
  assert.deepEqual(ordinary.calls.find((call) => call[0] === 'deleteUser'), ['deleteUser', targetId])
})
test('only a boolean setting is accepted and caller ID is recorded', async () => {
  const view = fixture()
  assert.equal((await view.request({ action: 'set-login-enabled', login_enabled: 'false' })).status, 400)
  assert.equal(view.calls.some((call) => call[1] === 'update'), false)
  assert.equal((await view.request({ action: 'set-login-enabled', login_enabled: false, updated_by: targetId })).status, 200)
  const change = view.calls.find((call) => call[1] === 'update')[2]
  assert.equal(change.login_enabled, false)
  assert.equal(change.updated_by, adminId)
})
test('list users is paginated with bounded input', async () => {
  const view = fixture()
  assert.equal((await view.request({ action: 'list-users', page: -1 })).status, 400)
  assert.equal((await view.request({ action: 'list-users', page: 2 })).status, 200)
  assert.deepEqual(view.calls.find((call) => call[1] === 'range'), ['dashboard_users', 'range', 50, 99])
})
test('Auth errors never leak submitted passwords or backend details', async () => {
  const view = fixture()
  view.client.auth.admin.createUser = async () => { throw new Error('sensitive-backend-secret') }
  const result = await view.request({ action: 'create-user', email: 'a@example.com', password: 'sensitive-password' })
  assert.equal(result.status, 500)
  assert.doesNotMatch(JSON.stringify(result.body), /sensitive/)
})
