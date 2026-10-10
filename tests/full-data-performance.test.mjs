import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const queries = []
let reply = () => ({ data: [], error: null })
globalThis.__fullDataTestClient = {
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'eq', 'gte', 'lte', 'gt', 'or', 'order', 'range', 'limit']) {
      builder[method] = (...args) => { query[method] = args; return builder }
    }
    builder.then = (resolve, reject) => {
      queries.push(query)
      return Promise.resolve(reply(query)).then(resolve, reject)
    }
    return builder
  },
}
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/full-data-performance',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'mock-full-data-database', enforce: 'pre',
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) {
        return 'export const supabase = globalThis.__fullDataTestClient'
      }
    },
  }],
})
after(async () => { await server.close(); delete globalThis.__fullDataTestClient })
const iot = await server.ssrLoadModule('/src/lib/iotDataDb.js')
const orders = await server.ssrLoadModule('/src/lib/orderUploadDb.js')
const api = await server.ssrLoadModule('/src/lib/ev91MisApi.js')
const report = await server.ssrLoadModule('/src/lib/fullDataMonthReport.js')
const zeroOrder = await server.ssrLoadModule('/src/lib/fullDataZeroOrder.js')
const riderPerformance = await server.ssrLoadModule('/src/lib/riderPerformanceReport.js')
const ev91Performance = await server.ssrLoadModule('/src/lib/ev91RiderPerformance.js')
const { default: FullData } = await server.ssrLoadModule('/src/FullData.jsx')
const timeout = { code: '57014', message: 'canceling statement due to statement timeout' }
const page = (length, date = '2026-06-01') => Array.from({ length }, (_, i) => ({ id: i + 1, run_date: date }))
function fastRetries(t) {
  const original = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => original(fn, ms >= 200 ? 0 : ms, ...args))
}

test('Full Data renders its header and filters before month data loads', () => {
  const html = renderToStaticMarkup(createElement(FullData))
  assert.match(html, /Full Data/)
  assert.match(html, /Refresh/)
  assert.match(html, /Loading months/)
})

test('IoT uses a date/id cursor across dates without OFFSET or losing large IDs', async () => {
  iot.clearIotRiderOrderCache(); queries.length = 0
  const first = page(1000)
  first[999] = { id: '9007199254740993', run_date: '2026-06-02' }
  reply = (query) => ({ data: query.or ? [{ id: '9007199254740994', run_date: '2026-06-02' }] : first, error: null })
  const rows = await iot.fetchIotDataInRange('2026-06-01', '2026-06-30')
  assert.equal(rows.length, 1001)
  assert.equal(queries[1].or[0], 'run_date.gt.2026-06-02,and(run_date.eq.2026-06-02,id.gt.9007199254740993)')
  assert.ok(queries.every((query) => !query.range && query.limit))
  assert.equal(await iot.fetchIotDataInRange('2026-06-01', '2026-06-30'), rows)
  assert.equal(queries.length, 2)
})

test('IoT timeout retries shrink the page and resume the same cursor', async (t) => {
  fastRetries(t)
  iot.clearIotRiderOrderCache(); queries.length = 0
  let call = 0
  reply = () => {
    call++
    if (call === 1 || call === 3) return { data: null, error: timeout }
    return { data: call === 2 ? page(500) : [{ id: 501, run_date: '2026-06-01' }], error: null }
  }
  assert.equal((await iot.fetchIotDataInRange('2026-06-01', '2026-06-30')).length, 501)
  assert.deepEqual(queries.map((query) => query.limit[0]), [1000, 500, 500, 250])
  assert.deepEqual(queries[2].or, queries[3].or)
})

test('failed IoT and order months never cache partial results', async (t) => {
  fastRetries(t)
  for (const [clear, load, size] of [
    [iot.clearIotRiderOrderCache, () => iot.fetchIotDataInRange('2026-06-01', '2026-06-30'), 1000],
    [orders.clearOrderUploadCache, () => orders.fetchOrderUploadsForHistory('Jun-2026'), 500],
  ]) {
    clear(); queries.length = 0
    reply = (query) => query.gt || query.or ? { data: null, error: timeout } : { data: page(size), error: null }
    await assert.rejects(load(), (error) => error.code === '57014')
    const failedCalls = queries.length
    reply = () => ({ data: [{ id: 1, run_date: '2026-06-01' }], error: null })
    assert.equal((await load()).length, 1)
    assert.equal(queries.length, failedCalls + 1)
  }
})

test('shared IoT requests and cache invalidation keep older pulls from overwriting uploads', async () => {
  iot.clearIotRiderOrderCache(); queries.length = 0
  const pending = []
  reply = () => new Promise((resolve) => pending.push(resolve))
  const load = () => iot.fetchIotDataInRange('2026-06-01', '2026-06-30')
  const older = load(), shared = load()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(queries.length, 1)
  iot.clearIotRiderOrderCache()
  const newer = load()
  await new Promise((resolve) => setTimeout(resolve, 0))
  pending[1]({ data: [{ id: 2 }], error: null })
  const freshRows = await newer
  pending[0]({ data: [{ id: 1 }], error: null })
  assert.equal(await older, await shared)
  assert.equal(await load(), freshRows)
  assert.equal(queries.length, 2)
})

test('simultaneous EV91 callers share all pages and invalidation prevents stale caching', async (t) => {
  api.clearEv91AllCache()
  const pending = []
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Promise((resolve) => pending.push((id) => resolve(Response.json({
      success: true, data: [{ id }], pagination: { hasMore: false },
    }))))
  })
  const load = () => api.fetchAllEv91MisData('overall-status')
  const older = load(), shared = load()
  assert.equal(calls, 1)
  api.clearEv91AllCache('overall-status')
  const newer = load()
  pending[1](2)
  const fresh = await newer
  pending[0](1)
  assert.equal(await older, await shared)
  assert.equal(await load(), fresh)
  assert.equal(calls, 2)
})

test('zero-order optimization matches detail rows for reversals, duplicate assignments and window boundaries', async () => {
  const days = ['2026-06-05', '2026-06-06', '2026-06-07'].map((dateKey) => ({ dateKey }))
  const orderRows = [
    { worker_code: 'active', date_record: '2026-06-03', delivered: 5 },
    { worker_code: 'reversed', date_record: '2026-06-03', delivered: 5 },
    { worker_code: 'REVERSED', date_record: '2026-06-03', delivered: -5 },
    { worker_code: 'other', date_record: '2026-06-07', delivered: 1 },
  ]
  const intervals = ['ACTIVE', 'REVERSED', 'NO-ORDERS', 'NO-ORDERS'].map((riderId) => ({
    riderId, fromKey: '2026-06-01', toKey: null, city: 'Chennai', client: 'Blinkit',
  }))
  intervals.push({ ...intervals[0], riderId: 'RETURNED', toKey: '2026-06-05' })
  const base = { days, fromKey: days[0].dateKey, toKey: days.at(-1).dateKey, slices: new Map() }
  await report.fillZeroOrderIntoBaseAsync(base, { orderRows, flatIntervals: intervals })
  const details = report.buildFullDataZeroOrderDetailRows(orderRows, [], { ...base, flatIntervals: intervals })
  assert.ok(details.some((row) => row['Worker Code'] === 'REVERSED'))
  assert.ok(details.every((row) => row['Worker Code'] !== 'RETURNED'))
  for (const { dateKey } of days) {
    const metrics = [...(base.slices.get(dateKey)?.values() || [])]
    const expected = details.filter((row) => row.Date === dateKey).length
    assert.equal(metrics.reduce((sum, m) => sum + m.zeroOrderRiderCount, 0), expected)
    assert.equal(metrics.reduce((sum, m) => sum + m.d1ZeroOrderRiderCount, 0), expected)
  }
})

test('large order builds yield and can cancel during the order phase', async () => {
  let phase = '', checks = 0
  const base = await report.buildFullDataMonthBaseAsync({
    monthLabel: 'Jun-2026',
    orderRows: Array.from({ length: 5000 }, (_, i) => ({ worker_code: `R${i}`, date_record: '2026-06-03', delivered: 1 })),
  }, {
    onProgress: (step) => { phase = step },
    shouldCancel: () => phase === 'orders' && ++checks === 1,
  })
  assert.equal(phase, 'orders')
  assert.equal(base.days.length, 0)
})

test('report build finishes when a hidden browser does not fire animation frames', async () => {
  globalThis.window = { requestAnimationFrame() { throw new Error('RAF should not gate the report') } }
  try {
    const base = await report.buildFullDataMonthBaseAsync({ monthLabel: 'Jun-2026' })
    assert.equal(base.days.length, 30)
  } finally { delete globalThis.window }
})

const asOfDate = new Date(2026, 9, 10)
const deployed = (id, extra = {}) => ({ currentStatus: 'Deployed', clientRiderId: id,
  vehicleNumber: 'TN-' + id, city: 'Chennai', clientName: 'Blinkit', lastStatusDate: '2026-09-01', ...extra })

test('D-1 counts and exports match EV91 zero-order tab with aliases, contacts and live statuses', async () => {
  const currentRows = [
    deployed('FE899696'), deployed('ABC_123456'), deployed('ev-fallback', { ev91RiderId: 'EV-67890' }),
    deployed('phone-fallback', { riderContact: '+91 9876543210' }),
    deployed('name-fallback', { riderName: '  Test   Rider ' }),
    deployed('detail-fallback', { ev91RiderId: 'EV-DETAIL' }),
    deployed('priority', { riderContact: '9999999999' }), deployed('reversed'),
    deployed('new-today', { lastStatusDate: '2026-10-10' }),
    deployed('', { vehicleNumber: 'TN-VEHICLE-ONLY' }),
    deployed('outside-window'), deployed('non-d1', { clientName: 'Other Client' }),
    deployed('returned', { currentStatus: 'Returned' }),
    deployed('not-deployed', { currentStatus: 'Yet not deployed' }),
  ]
  const orderRows = [
    { worker_code: '899696.0', date_record: '2026-10-09', delivered: 2 },
    { worker_code: 'ABC-123456', date_record: '2026-10-08', delivered: 1 },
    { worker_code: 'EV-67890', date_record: '2026-10-06', delivered: 4 },
    { worker_code: 'different-phone-id', mob_number: '9876543210', date_record: '2026-10-09', delivered: 3 },
    { worker_code: 'different-name-id', worker_name: 'Test Rider', date_record: '2026-10-09', delivered: 2 },
    { worker_code: 'different-detail-id', mob_number: '8888888888', date_record: '2026-10-09', delivered: 2 },
    { worker_code: 'priority', date_record: '2026-10-09', delivered: 0 },
    { worker_code: 'different-priority-id', mob_number: '9999999999', date_record: '2026-10-09', delivered: 9 },
    { worker_code: 'reversed', date_record: '2026-10-07', delivered: 5 },
    { worker_code: 'REVERSED', date_record: '2026-10-07', delivered: -5 },
    { worker_code: 'outside-window', date_record: '2026-10-05', delivered: 5 },
  ]
  const riderDetailsById = new Map([['EV-DETAIL', { phone: '8888888888' }]])
  const expected = ev91Performance.buildEv91RiderPerformanceReport(currentRows, orderRows, asOfDate, { riderDetailsById })
    .filter((row) => riderPerformance.hasZeroOrdersLast4Days(row, asOfDate))
  assert.equal(expected.length, 6)
  const days = ['2026-10-09', '2026-10-10'].map((dateKey) => ({ dateKey }))
  const base = { days, fromKey: days[0].dateKey, toKey: days.at(-1).dateKey, slices: new Map(), _currentRowsRef: currentRows }
  const options = { ...base, orderRows, asOfDate, riderDetailsById, currentRows, flatIntervals: [
    { riderId: 'ghost', city: 'Chennai', client: 'Blinkit', fromKey: '2026-09-01' },
    { riderId: 'priority', city: 'Old City', client: 'Old Client', fromKey: '2026-09-01' },
  ] }
  await report.fillZeroOrderIntoBaseAsync(base, options)
  const details = report.buildFullDataZeroOrderDetailRows(orderRows, [], options)
  assert.deepEqual(details.map((row) => row['V Number']).sort(), expected.map((row) => row['V no']).sort())
  assert.ok(details.every((row) => row.Date === '2026-10-09'))
  const matrix = report.materializeFullDataReport(base)
  assert.equal(matrix.byDate['2026-10-09'].zeroOrderRiderCount, expected.length)
  assert.equal(matrix.byDate['2026-10-09'].d1ZeroOrderRiderCount, expected.length - 2)
  for (const city of ['All', 'Chennai', 'Old City']) {
    for (const client of ['All', 'Blinkit', 'Other Client', 'Old Client']) {
      const values = report.materializeFullDataReport(base, city, client).byDate['2026-10-09']
      const filtered = report.buildFullDataZeroOrderDetailRows(orderRows, [], { ...options, cityFilter: city, clientFilter: client })
      assert.equal(values.zeroOrderRiderCount, filtered.length)
      assert.equal(values.d1ZeroOrderRiderCount, filtered.filter((row) => row['Included in D-1 count'] === 'Yes').length)
      assert.ok(values.d1ZeroOrderRiderCount <= values.zeroOrderRiderCount)
    }
  }
})

test('historical client moves use one assignment for both counts before filtering', async () => {
  const flatIntervals = [
    { riderId: 'FE123456', ev91RiderId: 'EV123', vehicleNumber: 'TN1', fromKey: '2026-06-01', city: 'Chennai', client: 'Other Client' },
    { riderId: '123456', ev91RiderId: 'EV123', vehicleNumber: 'TN1', fromKey: '2026-06-03', city: 'Bengaluru', client: 'Blinkit' },
    { riderId: '123456', ev91RiderId: 'EV123', vehicleNumber: 'TN2', fromKey: '2026-06-02', city: 'Chennai', client: 'Zepto' },
  ]
  const base = { days: [{ dateKey: '2026-06-05' }], fromKey: '2026-06-05', toKey: '2026-06-05', slices: new Map() }
  await report.fillZeroOrderIntoBaseAsync(base, { flatIntervals, asOfDate })
  for (const [city, client, expected] of [['All', 'All', 1], ['Bengaluru', 'Blinkit', 1], ['Chennai', 'Zepto', 0]]) {
    const values = report.materializeFullDataReport(base, city, client).byDate['2026-06-05']
    const details = report.buildFullDataZeroOrderDetailRows([], [], { ...base, flatIntervals, asOfDate, cityFilter: city, clientFilter: client })
    assert.equal(values.zeroOrderRiderCount, expected)
    assert.equal(values.d1ZeroOrderRiderCount, 0)
    assert.equal(details.length, expected)
  }
})

test('first days of a month include prior-month orders in the four-day zero-order window', async () => {
  const flatIntervals = [{ riderId: 'FE123456', fromKey: '2026-09-01', city: 'Chennai', client: 'Blinkit' }]
  const orderRows = [{ worker_code: '123456', date_record: '2026-09-30', delivered: 3 }]
  const base = { days: ['2026-10-01', '2026-10-04'].map((dateKey) => ({ dateKey })), fromKey: '2026-10-01', toKey: '2026-10-04', slices: new Map() }
  await report.fillZeroOrderIntoBaseAsync(base, { flatIntervals, orderRows, asOfDate })
  const matrix = report.materializeFullDataReport(base)
  assert.equal(matrix.byDate['2026-10-01'].zeroOrderRiderCount, 0)
  assert.equal(matrix.byDate['2026-10-04'].zeroOrderRiderCount, 1)
  const details = report.buildFullDataZeroOrderDetailRows(orderRows, [], { ...base, flatIntervals, asOfDate })
  assert.deepEqual(details.map((row) => row.Date), ['2026-10-04'])
})

test('zero-order indexing yields and honours cancellation with large shared order history', async () => {
  let checks = 0
  const result = await zeroOrder.buildFullDataZeroOrderIndexAsync(Array.from({ length: 5000 }, (_, i) => ({ worker_code: 'R' + i, date_record: '2026-10-09', delivered: 1 })), () => ++checks === 2)
  assert.equal(result, null)
  assert.equal(checks, 2)
})


test('bounded order index preserves reference matching precedence without storing old daily history', () => {
  const rows = [
    { worker_code: 'preferred', date_record: '2025-01-01', delivered: 3 },
    { worker_code: 'different', date_record: '2026-10-09', delivered: 4, mob_number: '9876543210' },
  ]
  const index = zeroOrder.buildFullDataZeroOrderIndex(rows, { fromKey: '2026-10-06', toKey: '2026-10-09' })
  assert.equal(index.byWorker.get('PREFERRED').size, 0)
  assert.equal(zeroOrder.fullDataAssignmentHasZeroOrders({ riderId: 'preferred', mobile: '9876543210' }, index, zeroOrder.fullDataZeroOrderWindowKeys('2026-10-09')), true)
})

test('09-Oct D-1 count gives deployments on 06-09 Oct grace and exports the same eligibility', async () => {
  const currentRows = [
    deployed('older', { lastStatusDate: '2026-10-05' }),
    ...['06', '07', '08', '09', '10'].map((day) => deployed(`new-${day}`, { lastStatusDate: `2026-10-${day}T12:00:00` })),
    deployed('other-client', { lastStatusDate: '2026-10-05', clientName: 'Other Client' }),
    deployed('working', { lastStatusDate: '2026-10-05' }),
    deployed('aging-recent', { lastStatusDate: null, aging: 4 }),
    deployed('aging-older', { lastStatusDate: 'invalid', aging: 5, city: 'Bengaluru' }),
    deployed('unknown-date', { lastStatusDate: null, aging: null }),
    deployed('returned', { currentStatus: 'Returned', lastStatusDate: '2026-10-01' }),
  ]
  const orderRows = [{ worker_code: 'working', date_record: '2026-10-08', delivered: 2 }]
  const base = { days: [{ dateKey: '2026-10-09' }], fromKey: '2026-10-09', toKey: '2026-10-09', slices: new Map() }
  const options = { ...base, currentRows, orderRows, asOfDate }
  await report.fillZeroOrderIntoBaseAsync(base, options)
  const details = report.buildFullDataZeroOrderDetailRows(orderRows, [], options)
  const included = details.filter((row) => row['Included in D-1 count'] === 'Yes')
  assert.deepEqual(included.map((row) => row['Worker Code']).sort(), ['aging-older', 'older', 'unknown-date'])
  assert.equal(details.find((row) => row['Worker Code'] === 'aging-recent')['Deployment Date'], '2026-10-06')
  assert.equal(details.find((row) => row['Worker Code'] === 'aging-older')['Deployment Date'], '2026-10-05')
  assert.equal(details.find((row) => row['Worker Code'] === 'unknown-date')['Deployment Date'], '')
  for (const city of ['All', 'Chennai', 'Bengaluru']) {
    for (const client of ['All', 'Blinkit', 'Other Client']) {
      const values = report.materializeFullDataReport(base, city, client).byDate['2026-10-09']
      const filtered = report.buildFullDataZeroOrderDetailRows(orderRows, [], { ...options, cityFilter: city, clientFilter: client })
      assert.equal(values.zeroOrderRiderCount, filtered.length)
      assert.equal(values.d1ZeroOrderRiderCount, filtered.filter((row) => row['Included in D-1 count'] === 'Yes').length)
      assert.ok(values.d1ZeroOrderRiderCount <= values.zeroOrderRiderCount)
    }
  }
  const values = report.materializeFullDataReport(base).byDate['2026-10-09']
  assert.equal(values.zeroOrderRiderCount, 10)
  assert.equal(values.d1ZeroOrderRiderCount, 3)
})

test('historical deployments join D-1 after the grace period, including across months', async () => {
  const flatIntervals = [
    { riderId: 'oct-new', fromKey: '2026-10-06', city: 'Chennai', client: 'Blinkit' },
    { riderId: 'sep-new', fromKey: '2026-09-30', city: 'Chennai', client: 'Blinkit' },
  ]
  const base = { days: ['2026-10-03', '2026-10-04', '2026-10-09', '2026-10-10'].map((dateKey) => ({ dateKey })), fromKey: '2026-10-03', toKey: '2026-10-10', slices: new Map() }
  const options = { ...base, flatIntervals, asOfDate: new Date(2026, 9, 12) }
  await report.fillZeroOrderIntoBaseAsync(base, options)
  const matrix = report.materializeFullDataReport(base)
  assert.equal(matrix.byDate['2026-10-03'].zeroOrderRiderCount, 1)
  assert.equal(matrix.byDate['2026-10-03'].d1ZeroOrderRiderCount, 0)
  assert.equal(matrix.byDate['2026-10-04'].d1ZeroOrderRiderCount, 1)
  assert.equal(matrix.byDate['2026-10-09'].zeroOrderRiderCount, 2)
  assert.equal(matrix.byDate['2026-10-09'].d1ZeroOrderRiderCount, 1)
  assert.equal(matrix.byDate['2026-10-10'].d1ZeroOrderRiderCount, 2)
  const details = report.buildFullDataZeroOrderDetailRows([], [], options)
  for (const { dateKey } of base.days) {
    assert.equal(matrix.byDate[dateKey].d1ZeroOrderRiderCount,
      details.filter((row) => row.Date === dateKey && row['Included in D-1 count'] === 'Yes').length)
  }
})
