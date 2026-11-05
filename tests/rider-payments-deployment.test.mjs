import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createRiderPaymentsHandler } from '../supabase/functions/rider-payments/handler.js'
import { asDenoHandler } from '../supabase/functions/rider-payments/serve.js'

test('Deno connection info is never treated as a Node response', async () => {
  const handler = asDenoHandler(createRiderPaymentsHandler({ getApiKey: () => 'edge-secret' }))
  const info = { remoteAddr: { transport: 'tcp', hostname: '127.0.0.1', port: 1234 } }
  const response = await handler(new Request('https://example.com/api/rider-payments'), info)
  assert.equal(response.status, 401)
  assert.equal((await response.json()).success, false)
  assert.equal((await handler(new Request('https://example.com', { method: 'OPTIONS' }), info)).status, 204)
})

test('deployed function authenticates using injected secrets without the local environment', async () => {
  let calls = 0
  const handler = createRiderPaymentsHandler({
    getApiKey: () => 'edge-secret',
    getClient: () => { calls++; return {} },
    load: async ({ riderId }) => ({ success: true, ev91_id: riderId, count: 0, data: [] }),
  })
  const url = 'https://example.supabase.co/functions/v1/rider-payments/CHE-26-R001711'
  assert.equal((await handler(new Request(url))).status, 401)
  assert.equal(calls, 0)
  const response = await handler(new Request(url, { headers: { 'x-api-key': 'edge-secret' } }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).ev91_id, 'CHE-26-R001711')
  assert.equal(calls, 1)
})

test('deployable handler and payment feed stay in sync with tested API sources', async () => {
  const source = await readFile(new URL('../api/rider-payments.js', import.meta.url), 'utf8')
  const deployed = await readFile(new URL('../supabase/functions/rider-payments/handler.js', import.meta.url), 'utf8')
  assert.equal(deployed.slice(deployed.indexOf('\n') + 1), source
    .replace("import { getSupabase } from './lib/supabaseServer.js'", '')
    .replace('getClient = getSupabase', 'getClient')
    .replace('export default createRiderPaymentsHandler()', ''))
  const feed = await readFile(new URL('../api/lib/riderPaymentFeed.js', import.meta.url), 'utf8')
  const deployedFeed = await readFile(new URL('../supabase/functions/rider-payments/lib/riderPaymentFeed.js', import.meta.url), 'utf8')
  assert.equal(deployedFeed.slice(deployedFeed.indexOf('\n') + 1), feed)
})

test('Amplify routes payment requests to the function before the HTML fallback', async () => {
  const rules = JSON.parse(await readFile(new URL('../amplify-redirects.json', import.meta.url), 'utf8'))
  const index = rules.findIndex((rule) => rule.source === '/api/rider-payments')
  assert.ok(index >= 0 && index < rules.findIndex((rule) => rule.target === '/index.html'))
  assert.equal(rules[index].status, '200')
  assert.equal(rules[index].target, 'https://arnxvnkednpzyzyfculx.supabase.co/functions/v1/rider-payments')
  const pathIndex = rules.findIndex((rule) => rule.source === '/api/rider-payments/<*>')
  assert.ok(pathIndex >= 0 && pathIndex < rules.findIndex((rule) => rule.target === '/index.html'))
  assert.equal(rules[pathIndex].status, '200')
  assert.equal(rules[pathIndex].target, 'https://arnxvnkednpzyzyfculx.supabase.co/functions/v1/rider-payments/<*>')
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  assert.match(config, /\[functions\.rider-payments\][\s\S]*?verify_jwt = false/)
})
