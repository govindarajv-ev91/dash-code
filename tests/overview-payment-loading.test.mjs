import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

const calls = []
let reply
function builder(query) {
  const value = {}
  for (const method of ['select', 'range', 'limit', 'gt', 'gte', 'lte', 'abortSignal']) {
    value[method] = (...args) => { query[method] = args; return value }
  }
  value.order = (...args) => { (query.order ||= []).push(args); return value }
  value.then = (resolve, reject) => {
    calls.push(query)
    return Promise.resolve().then(() => reply(query)).then(resolve, reject)
  }
  return value
}
globalThis.__revenueClient = {
  rpc(name, args, options) { return builder({ rpc: name, args, options }) },
  from(table) { return builder({ table }) },
}
const server = await createServer({
  configFile: false, cacheDir: 'node_modules/.vite-tests/overview-payment-loading',
  server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'overview-payment-db', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__revenueClient'
  } }],
})
const api = await server.ssrLoadModule('/src/lib/riderPaymentDb.js')
const { buildMonthlyRevenueSeries } = await server.ssrLoadModule('/src/lib/paymentHistoryReport.js')
after(async () => { await server.close(); delete globalThis.__revenueClient })
beforeEach(() => { calls.length = 0; api.clearRiderPaymentCache() })

function grouped(month, index, gross = 100) {
  return { id: `${month}|Client|${index}`, month, client_name: 'Client', rider_id: `00${index}`,
    orders: '10', gross_payout: String(gross), final_net_payout: String(gross - 5) }
}
function rpcReply(rows, { cap = 1000, count = true } = {}) {
  return (query) => {
    assert.equal(query.rpc, 'rider_payment_revenue_overview', 'no raw downloads when the summary works')
    assert.deepEqual(query.order.map(([key]) => key), ['month', 'client_name', 'rider_id', 'id'])
    const [from, to] = query.range
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null,
      count: count && query.options?.count === 'exact' ? rows.length : null }
  }
}

test('overview loads months beyond the capped April response and shares only complete cached totals', async () => {
  const rows = [
    ...Array.from({ length: 1000 }, (_, i) => grouped('Apr-2026', i)),
    ...Array.from({ length: 1001 }, (_, i) => grouped('Aug-2026', i, 200)),
    grouped('Sep-2026', 2001, 300), grouped('Oct-2026', 2002, 400),
  ]
  reply = rpcReply(rows)
  const progress = []
  const [all, shared] = await Promise.all([
    api.fetchRiderPaymentsForRevenue({ onProgress: (state) => progress.push(state) }),
    api.fetchRiderPaymentsForRevenue({ force: true }),
  ])
  assert.equal(all, shared)
  assert.equal(all.length, rows.length)
  assert.equal(all[0].rider_id, '000')
  const chart = buildMonthlyRevenueSeries(all, { financialYear: 'FY 2026-27' })
  assert.deepEqual(chart.series.map((row) => row.monthKey), ['2026-04', '2026-08', '2026-09', '2026-10'])
  assert.equal(chart.totals.gross, 300900)
  assert.equal(chart.totals.orders, rows.length * 10)
  assert.equal(progress.at(-1).loadedRows, rows.length)
  const before = calls.length
  assert.equal(await api.fetchRiderPaymentsForRevenue(), all)
  assert.equal(calls.length, before)
})

test('a lower server cap and a later cap change still include every group with at most four concurrent pages', async () => {
  const rows = Array.from({ length: 27 }, (_, i) => grouped(i < 3 ? 'Apr-2026' : 'Oct-2026', i))
  let active = 0, peak = 0
  reply = async (query) => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    return rpcReply(rows, { cap: query.range[0] ? 2 : 3 })(query)
  }
  const loaded = await api.fetchRiderPaymentsForRevenue()
  assert.deepEqual(loaded.map((row) => row.id), rows.map((row) => row.id))
  assert.equal(peak, 4)
})

test('missing count metadata continues after short pages until an empty response', async () => {
  const rows = [grouped('Apr-2026', 1), grouped('May-2026', 2), grouped('Oct-2026', 3)]
  reply = rpcReply(rows, { cap: 1, count: false })
  assert.deepEqual((await api.fetchRiderPaymentsForRevenue()).map((row) => row.month), rows.map((row) => row.month))
  assert.equal(calls.at(-1).range[0], 3)
})

test('a failed later summary page rejects without caching an April-only result', async () => {
  const rows = [grouped('Apr-2026', 1), grouped('May-2026', 2), grouped('Oct-2026', 3)]
  const success = rpcReply(rows, { cap: 1 })
  reply = (query) => query.range[0] ? { error: { code: '42501', message: 'Read failed' } } : success(query)
  await assert.rejects(api.fetchRiderPaymentsForRevenue(), { code: '42501' })
  reply = success
  assert.equal((await api.fetchRiderPaymentsForRevenue()).length, 3)
})

test('an unexpectedly empty page rejects instead of reporting partial totals as complete', async () => {
  const rows = [grouped('Apr-2026', 1), grouped('Oct-2026', 2)]
  const success = rpcReply(rows, { cap: 1 })
  reply = (query) => query.range[0] ? { data: [], error: null } : success(query)
  await assert.rejects(api.fetchRiderPaymentsForRevenue(), /incomplete page/)
  reply = success
  assert.equal((await api.fetchRiderPaymentsForRevenue()).length, 2)
})

function rawReply(query) {
  assert.equal(query.table, 'rider_payment_data')
  const rows = [{ id: 1, month: 'Apr-2026', rider_id: '001', gross_payout: 100 },
    { id: 2, month: 'Oct-2026', rider_id: '002', gross_payout: 250 },
    { id: 3, month: null, rider_id: '003', gross_payout: 50 }]
  return { data: query.select[0] === 'id' ? [{ id: 3 }] : rows, error: null, count: rows.length }
}

test('missing summary function uses bounded narrow payment reads without depending on a sampled month list', async () => {
  reply = (query) => query.rpc ? { error: { code: 'PGRST202', message: 'Could not find the function' } } : rawReply(query)
  const rows = await api.fetchRiderPaymentsForRevenue()
  assert.deepEqual(rows.map((row) => row.month), ['Apr-2026', 'Oct-2026', null])
  assert.equal(rows.reduce((sum, row) => sum + row.gross_payout, 0), 400)
  assert.ok(calls.filter((query) => query.table).every((query) => query.select[0] !== '*'))
})

test('a stalled summary request times out, aborts, and completes through the raw fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  reply = (query) => query.rpc ? new Promise(() => {}) : rawReply(query)
  const pending = api.fetchRiderPaymentsForRevenue()
  await new Promise((resolve) => setImmediate(resolve))
  const signal = calls[0].abortSignal[0]
  t.mock.timers.tick(15000)
  assert.equal((await pending).length, 3)
  assert.equal(signal.aborted, true)
})

test('refresh failures preserve the last complete cache and never serve it as a successful refresh', async () => {
  reply = rpcReply([grouped('Oct-2026', 1)])
  const prior = await api.fetchRiderPaymentsForRevenue()
  reply = () => ({ error: { code: '42501', message: 'Unavailable' } })
  await assert.rejects(api.fetchRiderPaymentsForRevenue({ force: true }), { code: '42501' })
  assert.equal(await api.fetchRiderPaymentsForRevenue(), prior)
})

test('cache invalidation prevents an older request from overwriting newer complete months', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  reply = () => pending
  const older = api.fetchRiderPaymentsForRevenue()
  await new Promise((resolve) => setImmediate(resolve))
  api.clearRiderPaymentCache()
  reply = rpcReply([grouped('Oct-2026', 1)])
  const newer = await api.fetchRiderPaymentsForRevenue()
  release({ data: [grouped('Apr-2026', 1)], count: 1, error: null })
  await older
  assert.equal(await api.fetchRiderPaymentsForRevenue(), newer)
})
