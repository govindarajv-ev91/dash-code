import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

const queries = []
let reply
let monthError = null
globalThis.__paymentPeriodTestClient = {
  rpc() { return Promise.resolve({ data: ['Aug-26', 'Sep-26', 'September 2026', 'Oct-26'], error: monthError }) },
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'eq', 'gte', 'lte', 'gt', 'or', 'range', 'limit']) {
      builder[method] = (...args) => { query[method] = args; return builder }
    }
    builder.order = (...args) => { (query.orders ||= []).push(args); return builder }
    builder.then = (resolve, reject) => {
      queries.push(query)
      return Promise.resolve().then(() => reply(query)).then(resolve, reject)
    }
    return builder
  },
}
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/rider-payment-period',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'mock-payment-period-database', enforce: 'pre',
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) {
        return 'export const supabase = globalThis.__paymentPeriodTestClient'
      }
    },
  }],
})
after(async () => { await server.close(); delete globalThis.__paymentPeriodTestClient })
const db = await server.ssrLoadModule('/src/lib/riderPaymentDb.js')
beforeEach(() => { queries.length = 0; monthError = null; db.clearRiderPaymentCache() })

test('payment permission errors point to the permission repair rather than timeout setup', () => {
  assert.equal(db.isRiderPaymentPermissionError({ code: '42501', message: 'permission denied' }), true)
  assert.equal(db.isRiderPaymentPermissionError({ message: 'new row violates row-level security policy for table "rider_payment_data"' }), true)
  assert.equal(db.isRiderPaymentPermissionError({ code: '57014', message: 'statement timeout' }), false)
  assert.equal(db.isRiderPaymentPermissionError({ message: 'Failed to fetch' }), false)
  assert.equal(db.isRiderPaymentPermissionError(null), false)
  assert.match(db.getRiderPaymentPermissionMessage(), /sql\/fix_rider_payment_permissions\.sql/)
})

function page(query, rows, cap = Infinity) {
  const cursor = query.or?.[0].match(/period_start\.eq\.([^,]+),id\.gt\.(\d+)/)
  return rows.filter((row) =>
    (!query.eq || row[query.eq[0]] === query.eq[1]) &&
    (!query.gte || row[query.gte[0]] >= query.gte[1]) &&
    (!query.lte || row[query.lte[0]] <= query.lte[1]) &&
    (!query.gt || row.id > query.gt[1]) &&
    (!cursor || row.period_start > cursor[1] || (row.period_start === cursor[1] && row.id > Number(cursor[2])))
  ).slice(0, Math.min(query.limit[0], cap))
}

test('month ranges load concurrently, preserve keyset pagination, and include each boundary once', async () => {
  let active = 0
  let peak = 0
  const rows = Array.from({ length: 7 }, (_, month) =>
    Array.from({ length: 1001 }, (_, index) => ({
      id: month * 1001 + index + 1,
      period_start: `2026-${String(month + 3).padStart(2, '0')}-${index === 1000 ? '30' : '15'}`,
    }))
  ).flat()
  reply = async (query) => {
    assert.equal(query.select[0], db.RIDER_PAYMENT_TREND_COLUMNS)
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active--
    assert.deepEqual(query.orders, [['period_start', { ascending: true }], ['id', { ascending: true }]])
    return { data: page(query, rows), error: null }
  }
  const params = { fromDate: '2026-03-15', toDate: '2026-09-30', slim: true }
  const [first, simultaneous] = await Promise.all([
    db.fetchRiderPaymentsForPeriod(params), db.fetchRiderPaymentsForPeriod(params),
  ])
  assert.equal(first, simultaneous)
  assert.deepEqual(first, rows)
  assert.equal(peak, 4)
  assert.equal(queries.length, 21)
  const ranges = queries.filter((query) => !query.or).map((query) => `${query.gte[1]}|${query.lte[1]}`)
  assert.deepEqual(ranges, [
    '2026-03-15|2026-03-31', '2026-04-01|2026-04-30', '2026-05-01|2026-05-31',
    '2026-06-01|2026-06-30', '2026-07-01|2026-07-31', '2026-08-01|2026-08-31',
    '2026-09-01|2026-09-30',
  ])
  assert.deepEqual(await db.fetchRiderPaymentsForPeriod({
    fromDate: '2026-05-01', toDate: '2026-05-31', slim: true,
  }), rows.filter((row) => row.period_start.startsWith('2026-05')))
  assert.equal(queries.length, 21, 'narrowing dates reuses existing rows')
  await db.fetchRiderPaymentsForPeriod({ ...params, force: true })
  assert.equal(queries.length, 42)
})

test('full export columns use a separate cache and crossing December preserves dates', async () => {
  reply = (query) => ({ data: query.or ? [] : [{ id: queries.length, period_start: query.gte[1],
    gross_payout: 100, utr_number: query.select[0].includes('utr_number') ? 'UTR-1' : undefined }], error: null })
  const params = { fromDate: '2026-12-30', toDate: '2027-01-02' }
  await db.fetchRiderPaymentsForPeriod({ ...params, slim: true })
  const full = await db.fetchRiderPaymentsForPeriod(params)
  assert.equal(full.length, 2)
  assert.equal(full[0].utr_number, 'UTR-1')
  assert.deepEqual(queries.filter((query) => !query.or).map((query) => query.select[0]), [
    db.RIDER_PAYMENT_TREND_COLUMNS, db.RIDER_PAYMENT_TREND_COLUMNS,
    db.RIDER_PAYMENT_COLUMNS, db.RIDER_PAYMENT_COLUMNS,
  ])
  assert.deepEqual(queries.filter((query) => !query.or).slice(0, 2).map((query) => [query.gte[1], query.lte[1]]), [
    ['2026-12-30', '2026-12-31'], ['2027-01-01', '2027-01-02'],
  ])
})

test('failed ranges reject without caching partial results', async () => {
  reply = () => ({ data: null, error: { code: '42703', message: 'column does not exist' } })
  const params = { fromDate: '2026-08-01', toDate: '2026-08-31', slim: true }
  await assert.rejects(db.fetchRiderPaymentsForPeriod(params), { code: '42703' })
  reply = (query) => ({ data: page(query, [{ id: 1, period_start: '2026-08-03' }]), error: null })
  assert.equal((await db.fetchRiderPaymentsForPeriod(params)).length, 1)
  assert.equal(queries.length, 3)
})

test('invalidating payment data prevents an old request from repopulating the period cache', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  reply = (query) => query.or ? { data: [], error: null } : pending
  const params = { fromDate: '2026-08-01', toDate: '2026-08-31', slim: true }
  const oldRequest = db.fetchRiderPaymentsForPeriod(params)
  await new Promise((resolve) => setImmediate(resolve))
  db.clearRiderPaymentCache()
  release({ data: [{ id: 1, period_start: '2026-08-03' }], error: null })
  await oldRequest
  reply = (query) => ({ data: page(query, [{ id: 2, period_start: '2026-08-03' }]), error: null })
  assert.equal((await db.fetchRiderPaymentsForPeriod(params))[0].id, 2)
  assert.equal(queries.length, 4)
})

test('undated historical uploads retain the existing full-payment fallback', async () => {
  reply = (query) => ({ data: query.gte || query.gt ? [] :
    [{ id: 1, period_start: null, week: '3226', month: 'Aug-26' }], error: null })
  const rows = await db.fetchRiderPaymentsForPeriod({
    fromDate: '2026-08-01', toDate: '2026-08-31', slim: true,
  })
  assert.equal(rows[0].week, '3226')
  assert.ok(queries.some((query) => query.select[0] === db.RIDER_PAYMENT_COLUMNS))
})

test('capped pages and repeated dates use both cursor fields without losing or duplicating rows', async () => {
  const rows = [
    { id: 8, period_start: '2026-08-03' },
    { id: 11, period_start: '2026-08-03' },
    { id: 2, period_start: '2026-08-10' },
    { id: 5, period_start: '2026-08-10' },
    { id: 1, period_start: '2026-08-31' },
  ]
  reply = (query) => ({ data: page(query, rows, 2), error: null })
  const result = await db.fetchRiderPaymentsForPeriod({ fromDate: '2026-08-01', toDate: '2026-08-31', slim: true })
  assert.deepEqual(result, [...rows].sort((a, b) => a.id - b.id))
  assert.equal(queries.length, 4)
})

test('a statement timeout retries the same date cursor with a smaller page', async () => {
  const rows = [{ id: 7, period_start: '2026-08-03' }, { id: 3, period_start: '2026-08-10' }]
  let timedOut = false
  reply = (query) => {
    if (query.or && !timedOut) {
      timedOut = true
      return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    }
    return { data: page(query, rows, 1), error: null }
  }
  const result = await db.fetchRiderPaymentsForPeriod({ fromDate: '2026-08-01', toDate: '2026-08-31', slim: true })
  assert.deepEqual(result, [...rows].sort((a, b) => a.id - b.id))
  assert.equal(queries[1].or[0], queries[2].or[0])
  assert.equal(queries[2].limit[0], 500)
})

test('a stuck composite cursor rejects and does not cache partial data', async () => {
  const params = { fromDate: '2026-08-01', toDate: '2026-08-31', slim: true }
  reply = () => ({ data: [{ id: 1, period_start: '2026-08-03' }], error: null })
  await assert.rejects(db.fetchRiderPaymentsForPeriod(params), /invalid pagination cursor/)
  reply = (query) => ({ data: page(query, [{ id: 2, period_start: '2026-08-03' }]), error: null })
  assert.equal((await db.fetchRiderPaymentsForPeriod(params))[0].id, 2)
})

test('reversed dates return an empty range without querying payment history', async () => {
  assert.deepEqual(await db.fetchRiderPaymentsForPeriod({
    fromDate: '2026-09-01', toDate: '2026-08-01', slim: true,
  }), [])
  assert.equal(queries.length, 0)
})

test('unbounded requests preserve undated uploads through ID pagination', async () => {
  const rows = [{ id: 1, period_start: null }, { id: 2, period_start: '2026-08-03' }]
  reply = (query) => ({ data: page(query, rows, 1), error: null })
  assert.deepEqual(await db.fetchRiderPaymentsForPeriod({ slim: true }), rows)
  assert.equal(queries.length, 3)
})

test('monthly reads include previous-month week starts and undated payments, with separate weekly and export caches', async () => {
  const rows = [
    { id: 1, month: 'Sep-26', period_start: '2026-08-31', gross_payout: 13242990 },
    { id: 2, month: 'Sep-26', period_start: '2026-09-07', gross_payout: 49131487 },
    { id: 3, month: 'September 2026', period_start: null, gross_payout: 100 },
    { id: 4, month: 'Aug-26', period_start: '2026-09-01', gross_payout: 200 },
    { id: 5, month: 'Oct-26', period_start: '2026-09-28', gross_payout: 300 },
  ]
  reply = (query) => ({ data: page(query, rows, 1), error: null })
  const params = { fromDate: '2026-09-01', toDate: '2026-09-30', slim: true }
  await db.fetchRiderPaymentsForPeriod(params)
  const start = queries.length
  const monthly = await db.fetchRiderPaymentsForPeriod({ ...params, monthly: true })
  assert.deepEqual(monthly, rows.slice(0, 3))
  assert.equal(monthly.slice(0, 2).reduce((sum, row) => sum + row.gross_payout, 0), 62374477)
  assert.deepEqual(new Set(queries.slice(start).filter((query) => query.eq).map((query) => query.eq[1])),
    new Set(['Sep-26', 'September 2026']))
  const calls = queries.length
  assert.deepEqual(await db.fetchRiderPaymentsForPeriod({ ...params, fromDate: '2026-09-15', monthly: true }), monthly)
  assert.equal(queries.length, calls, 'narrowing within a month retains its boundary and undated payments')
  assert.deepEqual(await db.fetchRiderPaymentsForPeriod({ ...params, slim: false, monthly: true }), monthly)
  assert.ok(queries.slice(calls).some((query) => query.select[0] === db.RIDER_PAYMENT_COLUMNS))
})

test('monthly revenue refuses sampled month lists and retries without caching an incomplete result', async () => {
  const row = { id: 1, month: 'Sep-26', period_start: '2026-08-31', gross_payout: 100 }
  reply = (query) => ({ data: page(query, [row]), error: null })
  monthError = { code: '57014', message: 'statement timeout' }
  const params = { fromDate: '2026-09-01', toDate: '2026-09-30', slim: true, monthly: true }
  await assert.rejects(db.fetchRiderPaymentsForPeriod(params), /Unable to load all payment months/)
  assert.equal(queries.length, 1, 'does not substitute a sampled month list')
  monthError = null
  assert.deepEqual(await db.fetchRiderPaymentsForPeriod(params), [row])
})
