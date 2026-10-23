import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import * as XLSX from 'xlsx'
import handler from '../api/ev91-sd-wallet.js'

const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const labels = ['PublicRiderId', 'City', 'ClientName', 'ClientRiderId', 'TotalSd', 'PendingSd', 'FixedDeposit']
const wallet = ['MYS-26-R000206', 'Mysuru', 'Client A', '001065830', 1234.5, 0, -100]
function workbook(rows = [wallet], headers = labels) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Rider SD Wallet')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' })
}
let version = 0
const loadApi = () => import(`../src/lib/ev91SdWalletApi.js?test=${++version}`)

test('GET-only wallet proxy returns workbook bytes for Fetch and Node runtimes, with fixed upstream and no cache', async (t) => {
  const bytes = workbook()
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests++
    assert.equal(String(url), 'https://dashboard.ev91riderz.com/api/v1/security-deposit/export/wallet')
    assert.equal(options.cache, 'no-store')
    assert.ok(options.signal)
    return new Response(bytes, { headers: { 'content-type': mime } })
  })
  const response = await handler(new Request('http://localhost/api/ev91-sd-wallet?url=https://invalid.test'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('content-type'), mime)
  assert.deepEqual(await response.arrayBuffer(), bytes)
  const node = { headers: {}, setHeader(name, value) { this.headers[name] = value }, end(value) { this.bytes = value } }
  await handler({ method: 'GET' }, node)
  assert.equal(node.statusCode, 200)
  assert.deepEqual(new Uint8Array(node.bytes), new Uint8Array(bytes))
  const rejected = await handler(new Request('http://localhost/api/ev91-sd-wallet', { method: 'POST' }))
  assert.equal(rejected.status, 405)
  assert.equal(rejected.headers.get('allow'), 'GET')
  assert.equal(requests, 2)
})

test('proxy rejects upstream failures, HTML, invalid workbook bytes and timeouts', async (t) => {
  let makeResponse
  t.mock.method(globalThis, 'fetch', () => makeResponse())
  for (const [reply, message] of [
    [() => new Response('denied', { status: 401 }), /HTTP 401/],
    [() => new Response('<html/>', { headers: { 'content-type': 'text/html' } }), /Excel workbook/],
    [() => new Response('invalid', { headers: { 'content-type': mime } }), /Excel workbook/],
    [() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }, /timed out/],
  ]) {
    makeResponse = reply
    const response = await handler(new Request('http://localhost/api/ev91-sd-wallet'))
    assert.equal(response.status, 502)
    assert.match((await response.json()).message, message)
  }
})

test('wallet parser preserves leading-zero IDs, zero/negative amounts, empty exports and Excel round trips', async () => {
  const api = await loadApi()
  const rows = await api.parseEv91SdWallet(workbook())
  assert.deepEqual(rows, [{ public_rider_id: wallet[0], city: wallet[1], client_name: wallet[2],
    client_rider_id: wallet[3], total_sd: wallet[4], pending_sd: 0, fixed_deposit: -100 }])
  assert.deepEqual(await api.parseEv91SdWallet(workbook([])), [])
  const book = await api.buildEv91SdWalletWorkbook(rows)
  const reopened = XLSX.read(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), { type: 'array' })
  const exported = XLSX.utils.sheet_to_json(reopened.Sheets['EV91 SD'])
  assert.deepEqual(exported[0], Object.fromEntries(labels.map((label, index) => [label, wallet[index]])))
})

test('schema mismatches and malformed financial rows reject rather than producing partial or zero balances', async () => {
  const api = await loadApi()
  await assert.rejects(api.parseEv91SdWallet(workbook([wallet], labels.slice(0, 6))), /missing columns.*FixedDeposit/)
  await assert.rejects(api.parseEv91SdWallet(workbook([[...wallet.slice(0, 4), 'not an amount', 0, 0]])), /invalid rider IDs or SD amounts/)
  await assert.rejects(api.parseEv91SdWallet(workbook([['', 'Mysuru', 'Client A', '', 100, 0, 0]])), /invalid rider IDs/)
})

test('wallet fetch shares inflight work, caches complete results, expires and keeps last success after refresh failures', async (t) => {
  const api = await loadApi()
  let calls = 0, fail = false
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++
    assert.equal(url, '/api/ev91-sd-wallet')
    return fail ? Response.json({ message: 'Unavailable' }, { status: 502 })
      : new Response(workbook(), { headers: { 'content-type': mime } })
  })
  const [first, second] = await Promise.all([api.fetchEv91SdWallet(), api.fetchEv91SdWallet()])
  assert.equal(first, second)
  assert.equal(calls, 1)
  assert.equal(await api.fetchEv91SdWallet(), first)
  assert.equal(calls, 1)
  fail = true
  await assert.rejects(api.fetchEv91SdWallet({ force: true }), /Unavailable/)
  assert.equal(api.getCachedEv91SdWallet(), first)
  fail = false
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 300001)
  await api.fetchEv91SdWallet()
  assert.equal(calls, 3)
})

test('HTML fallback is explained and a failed first fetch is never cached', async (t) => {
  const api = await loadApi()
  let fail = true
  t.mock.method(globalThis, 'fetch', async () => fail
    ? new Response('<html/>', { headers: { 'content-type': 'text/html' } })
    : new Response(workbook(), { headers: { 'content-type': mime } }))
  await assert.rejects(api.fetchEv91SdWallet(), /hosting route/)
  assert.equal(api.getCachedEv91SdWallet(), null)
  fail = false
  assert.equal((await api.fetchEv91SdWallet()).rows.length, 1)
})

test('EV91 sidebar page and local/production wallet routes are wired before SPA fallbacks', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /onClick=\{\(\) => openEv91Page\('ev91-sd'\)\}/)
  assert.match(app, /activePage === 'ev91-sd' \? \(\s*<Ev91SdWallet/)
  const redirects = JSON.parse(await readFile(new URL('../amplify-redirects.json', import.meta.url), 'utf8'))
  const index = redirects.findIndex((rule) => rule.source === '/api/ev91-sd-wallet')
  assert.ok(index >= 0 && index < redirects.length - 1)
  assert.equal(redirects[index].target, 'https://dashboard.ev91riderz.com/api/v1/security-deposit/export/wallet')
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.equal(vercel.functions['api/ev91-sd-wallet.js'].maxDuration, 30)
})
