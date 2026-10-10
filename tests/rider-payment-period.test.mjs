import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

const queries = []
let reply
globalThis.__paymentPeriodTestClient = {
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'gte', 'lte', 'gt', 'order', 'range', 'limit']) {
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
  cacheDir: 'node_modules/.vite-tests/rider-payment-period',
  server: { middlewareMode: true },
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
beforeEach(() => { queries.length = 0; db.clearRiderPaymentCache() })

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
    return { data: rows.filter((row) => row.period_start >= query.gte[1] &&
      row.period_start <= query.lte[1] && (!query.gt || row.id > query.gt[1]))
      .slice(0, query.limit[0]), error: null }
  }
  const params = { fromDate: '2026-03-15', toDate: '2026-09-30', slim: true }
  const [first, simultaneous] = await Promise.all([
    db.fetchRiderPaymentsForPeriod(params), db.fetchRiderPaymentsForPeriod(params),
  ])
  assert.equal(first, simultaneous)
  assert.deepEqual(first, rows)
  assert.equal(peak, 4)
  assert.equal(queries.length, 14)
  const ranges = [...new Set(queries.map((query) => `${query.gte[1]}|${query.lte[1]}`))]
  assert.deepEqual(ranges, [
    '2026-03-15|2026-03-31', '2026-04-01|2026-04-30', '2026-05-01|2026-05-31',
    '2026-06-01|2026-06-30', '2026-07-01|2026-07-31', '2026-08-01|2026-08-31',
    '2026-09-01|2026-09-30',
  ])
  assert.deepEqual(await db.fetchRiderPaymentsForPeriod({
    fromDate: '2026-05-01', toDate: '2026-05-31', slim: true,
  }), rows.filter((row) => row.period_start.startsWith('2026-05')))
  assert.equal(queries.length, 14, 'narrowing dates reuses existing rows')
  await db.fetchRiderPaymentsForPeriod({ ...params, force: true })
  assert.equal(queries.length, 28)
})

test('full export columns use a separate cache and crossing December preserves dates', async () => {
  reply = (query) => ({ data: [{ id: queries.length, period_start: query.gte[1],
    gross_payout: 100, utr_number: query.select[0].includes('utr_number') ? 'UTR-1' : undefined }], error: null })
  const params = { fromDate: '2026-12-30', toDate: '2027-01-02' }
  await db.fetchRiderPaymentsForPeriod({ ...params, slim: true })
  const full = await db.fetchRiderPaymentsForPeriod(params)
  assert.equal(full.length, 2)
  assert.equal(full[0].utr_number, 'UTR-1')
  assert.deepEqual(queries.map((query) => query.select[0]), [
    db.RIDER_PAYMENT_TREND_COLUMNS, db.RIDER_PAYMENT_TREND_COLUMNS,
    db.RIDER_PAYMENT_COLUMNS, db.RIDER_PAYMENT_COLUMNS,
  ])
  assert.deepEqual(queries.slice(0, 2).map((query) => [query.gte[1], query.lte[1]]), [
    ['2026-12-30', '2026-12-31'], ['2027-01-01', '2027-01-02'],
  ])
})

test('failed ranges reject without caching partial results', async () => {
  reply = () => ({ data: null, error: { code: '42703', message: 'column does not exist' } })
  const params = { fromDate: '2026-08-01', toDate: '2026-08-31', slim: true }
  await assert.rejects(db.fetchRiderPaymentsForPeriod(params), { code: '42703' })
  reply = () => ({ data: [{ id: 1, period_start: '2026-08-03' }], error: null })
  assert.equal((await db.fetchRiderPaymentsForPeriod(params)).length, 1)
  assert.equal(queries.length, 2)
})

test('invalidating payment data prevents an old request from repopulating the period cache', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  reply = () => pending
  const params = { fromDate: '2026-08-01', toDate: '2026-08-31', slim: true }
  const oldRequest = db.fetchRiderPaymentsForPeriod(params)
  await new Promise((resolve) => setImmediate(resolve))
  db.clearRiderPaymentCache()
  release({ data: [{ id: 1, period_start: '2026-08-03' }], error: null })
  await oldRequest
  reply = () => ({ data: [{ id: 2, period_start: '2026-08-03' }], error: null })
  assert.equal((await db.fetchRiderPaymentsForPeriod(params))[0].id, 2)
  assert.equal(queries.length, 2)
})

test('undated historical uploads retain the existing full-payment fallback', async () => {
  reply = (query) => ({ data: query.gte ? [] :
    [{ id: 1, period_start: null, week: '3226', month: 'Aug-26' }], error: null })
  const rows = await db.fetchRiderPaymentsForPeriod({
    fromDate: '2026-08-01', toDate: '2026-08-31', slim: true,
  })
  assert.equal(rows[0].week, '3226')
  assert.ok(queries.some((query) => query.select[0] === db.RIDER_PAYMENT_COLUMNS))
})

test('reversed dates return an empty range without querying payment history', async () => {
  assert.deepEqual(await db.fetchRiderPaymentsForPeriod({
    fromDate: '2026-09-01', toDate: '2026-08-01', slim: true,
  }), [])
  assert.equal(queries.length, 0)
})
