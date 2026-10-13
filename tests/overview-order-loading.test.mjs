import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

const queries = []
let reply
globalThis.__overviewOrdersClient = {
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'order', 'limit', 'gte', 'lte', 'gt', 'range']) {
      builder[method] = (...args) => { query[method] = args; return builder }
    }
    builder.then = (resolve, reject) => {
      queries.push(query)
      return Promise.resolve().then(() => reply(query)).then(resolve, reject)
    }
    return builder
  },
}
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/overview-order-loading',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'mock-overview-order-database', enforce: 'pre',
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) {
        return 'export const supabase = globalThis.__overviewOrdersClient'
      }
    },
  }],
})
const orders = await server.ssrLoadModule('/src/lib/orderUploadDb.js')
const { mergeRiderMetricSources, selectOverviewOrderRows, toMetricDateKey } = await server.ssrLoadModule('/src/lib/mergeRiderMetrics.js')
const { buildClientPeriodLineSeries } = await server.ssrLoadModule('/src/lib/paymentHistoryReport.js')
after(async () => { await server.close(); delete globalThis.__overviewOrdersClient })
beforeEach(() => { queries.length = 0; orders.clearOrderUploadCache() })

const row = (id, date, overrides = {}) => ({
  id, date_record: date, worker_code: `r${id}`, delivered: 10,
  client: 'Alpha', city: 'Chennai', type1: 'EV', month: '', ...overrides,
})
function database(rows, cap = 1000) {
  return (query) => {
    let selected = rows.filter((item) =>
      (!query.gte || BigInt(item.id) >= BigInt(query.gte[1])) &&
      (!query.lte || BigInt(item.id) <= BigInt(query.lte[1])) &&
      (!query.gt || BigInt(item.id) > BigInt(query.gt[1])))
    selected = selected.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)
    if (query.order?.[1].ascending === false) selected.reverse()
    return { data: selected.slice(0, Math.min(query.limit[0], cap)), error: null }
  }
}

test('both date formats normalize to the same keys across 4 May and ISO timestamps', () => {
  assert.equal(toMetricDateKey('04-05-2026'), '2026-05-04')
  assert.equal(toMetricDateKey('04/05/2026'), '2026-05-04')
  assert.equal(toMetricDateKey('2026-05-04'), '2026-05-04')
  assert.equal(toMetricDateKey('2026-05-05'), '2026-05-05')
  assert.equal(toMetricDateKey('2026-05-05T23:00:00Z'), '2026-05-05')
  assert.equal(toMetricDateKey('2026-02-30'), '')
  assert.equal(toMetricDateKey('31-04-2026'), '')
})

test('parallel complete scans include post-May ISO rows even when the server caps pages', async () => {
  const rows = [
    ...Array.from({ length: 600 }, (_, index) => row(index + 1, index < 400 ? '30-04-2026' : '04-05-2026')),
    row(90000, '2026-05-05'), row(100000, '2026-06-01'),
    row(500000, '2026-07-31'), row(744292, '2026-10-12'),
  ]
  let active = 0, peak = 0
  const dataReply = database(rows, 100)
  reply = async (query) => {
    if (query.select[0] === 'id') return dataReply(query)
    active++; peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active--
    return dataReply(query)
  }
  const [first, shared] = await Promise.all([orders.fetchAllOrderUploads(), orders.fetchAllOrderUploads()])
  assert.equal(first, shared)
  assert.deepEqual(first, rows)
  assert.equal(peak, 4)
  assert.ok(queries.some((query) => query.gt?.[1] === 600), 'the short server page must not stop at May 4')
  const overview = selectOverviewOrderRows(mergeRiderMetricSources([], first))
  assert.equal(overview.at(-1).date_record, '2026-10-12')
  const report = buildClientPeriodLineSeries(overview)
  assert.deepEqual(report.series.map((point) => point.period), ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Oct 2026'])
  assert.equal(report.totals.orders, 6040)
  const before = queries.length
  assert.equal(await orders.fetchAllOrderUploads(), first)
  assert.equal(queries.length, before)
})

test('a failed later page rejects and cannot turn a May 4 partial result into the cache', async () => {
  const rows = [row(1, '04-05-2026'), row(2, '2026-05-05')]
  const dataReply = database(rows, 1)
  reply = (query) => query.gt ? { data: null, error: { code: '42703', message: 'column does not exist' } } : dataReply(query)
  await assert.rejects(orders.fetchAllOrderUploads(), { code: '42703' })
  reply = dataReply
  assert.deepEqual(await orders.fetchAllOrderUploads(), rows)
})

test('complete scans preserve bigint cursors and detect a page that repeats its cursor', async () => {
  const rows = [row('9007199254740993', '04-05-2026'), row('9007199254740994', '2026-05-05')]
  reply = database(rows, 1)
  assert.deepEqual(await orders.fetchAllOrderUploads(), rows)
  assert.ok(queries.some((query) => query.gt?.[1] === '9007199254740994'))
  orders.clearOrderUploadCache()
  reply = (query) => ({ data: [row(1, '2026-05-05')], error: null })
  await assert.rejects(orders.fetchAllOrderUploads(), { code: 'INVALID_CURSOR' })
})

test('invalidating an in-flight scan prevents it from repopulating the order cache', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const oldRows = [row(1, '04-05-2026')]
  const oldReply = database(oldRows)
  reply = (query) => query.select[0] === 'id' ? oldReply(query) : pending.then(() => oldReply(query))
  const older = orders.fetchAllOrderUploads()
  await new Promise((resolve) => setImmediate(resolve))
  orders.clearOrderUploadCache()
  release()
  await older
  const fresh = [row(2, '2026-05-05')]
  reply = database(fresh)
  assert.deepEqual(await orders.fetchAllOrderUploads(), fresh)
})
