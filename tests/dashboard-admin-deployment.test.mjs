import assert from 'node:assert/strict'
import { test } from 'node:test'
import { corsHeaders } from '@supabase/supabase-js/cors'
import { checkAdminService } from '../scripts/check-dashboard-admin.mjs'

const base = 'https://arnxvnkednpzyzyfculx.supabase.co'
const unsigned = () => Response.json({ error: 'Sign in as an administrator.' }, { status: 401, headers: corsHeaders })
function check(responses) {
  const calls = []
  const result = checkAdminService({ base, key: 'test-public-key', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), ...options })
    assert.ok(responses.length, 'Unexpected extra request')
    return responses.shift()
  } })
  return { calls, result }
}

test('missing function preflight identifies the app project and stops before POST', async () => {
  const view = check([Response.json({ code: 'NOT_FOUND' }, { status: 404 })])
  await assert.rejects(view.result, /OPTIONS preflight returns 404.*project\/arnxvnkednpzyzyfculx\/functions.*named exactly dashboard-admin/)
  assert.equal(view.calls.length, 1)
  assert.equal(view.calls[0].method, 'OPTIONS')
})

test('successful deployment check verifies preflight and performs no account operation', async () => {
  const view = check([new Response(null, { status: 204, headers: corsHeaders }), unsigned()])
  await view.result
  assert.equal(view.calls[0].headers['Access-Control-Request-Headers'], corsHeaders['Access-Control-Allow-Headers'])
  assert.equal(view.calls[1].method, 'POST')
  assert.equal(view.calls[1].body, '{}')
  assert.equal(view.calls[1].headers.Authorization, undefined)
})

test('preflight must allow the browser origin and all SDK request headers', async () => {
  for (const headers of [
    { ...corsHeaders, 'Access-Control-Allow-Origin': 'https://another-site.example' },
    { ...corsHeaders, 'Access-Control-Allow-Headers': 'authorization, apikey' },
  ]) {
    const view = check([new Response(null, { status: 204, headers })])
    await assert.rejects(view.result, /browser origin|missing required request headers/)
    assert.equal(view.calls.length, 1)
  }
})

test('auth gateway rejection and missing CORS on error responses do not pass', async () => {
  const gateway = check([new Response(null, { status: 401 })])
  await assert.rejects(gateway.result, /preflight returned HTTP 401.*Verify JWT OFF/)
  const noCors = check([new Response(null, { status: 204, headers: corsHeaders }),
    Response.json({ error: 'Sign in as an administrator.' }, { status: 401 })])
  await assert.rejects(noCors.result, /does not allow this browser origin/)
})

test('a wrong handler that permits unsigned POST requests does not pass', async () => {
  const view = check([new Response(null, { status: 204, headers: corsHeaders }), Response.json({ ok: true })])
  await assert.rejects(view.result, /HTTP 200/)
})
