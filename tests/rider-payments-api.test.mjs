import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRiderPaymentsHandler } from '../api/rider-payments.js'
import { fetchRiderPaymentFeed, paymentMonthWindow } from '../api/lib/riderPaymentFeed.js'

const RIDER = 'CHE-26-R001711'
const now = new Date('2026-11-04T10:00:00Z')
function setKey(t, value) {
  const previous = process.env.RIDER_PAYMENT_API_KEY
  t.after(() => { if (previous === undefined) delete process.env.RIDER_PAYMENT_API_KEY; else process.env.RIDER_PAYMENT_API_KEY = previous })
  process.env.RIDER_PAYMENT_API_KEY = value
}
const payment = (id, rider_id, month, overrides = {}) => ({ id, rider_id, rider_name: 'Test Rider', client_name: 'Blinkit',
  month, week: '4526', gross_payout: '5000', cod_deduction: '100', damage: '20', traffic: '30', ev_rent: '1000', final_net_payout: '3850', ...overrides })

function fixture({ rows = [], mappings = [], cap = 1, failure = false } = {}) {
  const queries = []
  const supabase = { from(table) {
    const params = { table, filters: {} }
    const builder = {
      select(columns) { params.columns = columns; return this },
      in(key, values) { params.filters[key] = values; return this },
      order() { return this }, limit() { return this }, gt(key, value) { params.cursor = value; return this },
      abortSignal() { return this },
      then(resolve, reject) {
        queries.push(params)
        const selected = rows.filter((row) => params.filters.rider_id.includes(row.rider_id) && params.filters.month.includes(row.month) &&
          (!params.cursor || BigInt(row.id) > BigInt(params.cursor))).slice(0, cap)
        return Promise.resolve(failure ? { error: { message: 'private database error' } } : { data: selected, error: null }).then(resolve, reject)
      },
    }
    return builder
  } }
  const upstream = []
  const fetchImpl = async (url, options) => {
    upstream.push({ url: String(url), options })
    const offset = Number(new URL(url).searchParams.get('offset'))
    return Response.json({ success: true, data: mappings.slice(offset, offset + 1), pagination: { hasMore: offset + 1 < mappings.length } })
  }
  return { supabase, fetchImpl, queries, upstream }
}

test('India calendar month window moves across years and at the IST month boundary', () => {
  assert.deepEqual(paymentMonthWindow(now).map((month) => month.key), ['2026-10', '2026-11'])
  assert.deepEqual(paymentMonthWindow(new Date('2026-12-31T18:30:00Z')).map((month) => month.key), ['2026-12', '2027-01'])
  assert.deepEqual(paymentMonthWindow(new Date('2026-10-31T18:29:59Z')).map((month) => month.key), ['2026-09', '2026-10'])
})

test('exact EV91 mappings, client IDs and month limits preserve every capped payment page and amount', async () => {
  const context = fixture({ mappings: [
    { ev91RiderId: RIDER, clientId: 'FE123456', clientName: 'Blinkit', riderName: 'Mapped Rider' },
    { ev91RiderId: 'OTHER-26-R001711', clientId: '999999', clientName: 'Blinkit' },
  ], rows: [payment('1', '123456', 'Oct-2026'), payment('2', 'FE123456', 'Nov-2026'),
    payment('3', RIDER, 'Nov-2026'), payment('4', '999999', 'Nov-2026'),
    payment('5', '123456', 'Sep-2026'), payment('6', '123456', 'Dec-2026'),
    payment('7', '123456', 'Nov-2026', { client_name: 'Amazon' }),
  ] })
  const body = await fetchRiderPaymentFeed({ riderId: RIDER, now, ...context })
  assert.equal(body.count, 3)
  assert.deepEqual(body.data.map((row) => row.id), ['1', '2', '3'])
  assert.ok(body.data.every((row) => row.client_id === 'FE123456' && row.ev91_id === RIDER))
  assert.deepEqual(body.data[0], { id: '1', ev91_id: RIDER, rider_name: 'Test Rider', client_id: 'FE123456', client_name: 'Blinkit',
    week: '4526', month: 'Oct-2026', gross_payout: 5000, cod_deduction: 100, damage: 20, traffic: 30, ev_rent: 1000, final_net_payout: 3850 })
  assert.ok(context.queries.length > 3)
  assert.ok(context.upstream.every(({ options }) => options.cache === 'no-store' && options.signal))
  assert.ok(!context.queries[0].filters.rider_id.includes('26001711'), 'EV91 digits are never treated as client IDs')
})

test('direct EV91 payments remain available without mappings and missing/negative values are preserved', async () => {
  const context = fixture({ rows: [payment('1', RIDER, 'Nov-2026', { gross_payout: -50, damage: null, traffic: 0 })] })
  const result = await fetchRiderPaymentFeed({ riderId: RIDER, now, ...context })
  assert.equal(result.data[0].client_id, null)
  assert.equal(result.data[0].gross_payout, -50)
  assert.equal(result.data[0].damage, 0)
  assert.equal(result.data[0].traffic, 0)
  assert.equal((await fetchRiderPaymentFeed({ riderId: 'NO-MATCH', now, ...context })).count, 0)
})

test('API authenticates before accessing data, rejects URL keys and supports Fetch and Node responses', async (t) => {
  setKey(t, 'private-test-key')
  let calls = 0
  const handler = createRiderPaymentsHandler({ getClient: () => ({}), load: async ({ riderId }) => { calls++; return { success: true, ev91_id: riderId, data: [] } } })
  const request = (path = `?ev91_id=${RIDER}`, headers = {}) => new Request(`http://localhost/api/rider-payments${path}`, { headers })
  assert.equal((await handler(request())).status, 401)
  assert.equal((await handler(request(`?ev91_id=${RIDER}&api_key=private-test-key`))).status, 401)
  assert.equal(calls, 0)
  assert.equal((await handler(request('', { 'x-api-key': 'private-test-key' }))).status, 400)
  const response = await handler(request(undefined, { authorization: 'Bearer private-test-key' }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).ev91_id, RIDER)
  const res = { setHeader() {}, end(body) { this.body = JSON.parse(body) } }
  await handler({ method: 'GET', query: { ev91_id: RIDER }, headers: { 'x-api-key': 'private-test-key' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ev91_id, RIDER)
  assert.equal((await handler(new Request('http://localhost', { method: 'OPTIONS' }))).status, 204)
  assert.equal((await handler(new Request('http://localhost', { method: 'POST' }))).status, 405)
})

test('configuration and upstream failures return generic errors and never partial financial data', async (t) => {
  setKey(t, '')
  const handler = createRiderPaymentsHandler({ getClient: () => ({}), load: async () => { throw new Error('private database details') } })
  const req = new Request(`http://localhost/api/rider-payments?ev91_id=${RIDER}`, { headers: { 'x-api-key': 'test' } })
  assert.equal((await handler(req)).status, 503)
  process.env.RIDER_PAYMENT_API_KEY = 'test'
  const response = await handler(req)
  assert.equal(response.status, 502)
  assert.doesNotMatch(JSON.stringify(await response.json()), /private database details/)
  await assert.rejects(fetchRiderPaymentFeed({ riderId: RIDER, now, ...fixture({ failure: true }) }), /Payment data is unavailable/)
  await assert.rejects(fetchRiderPaymentFeed({ riderId: RIDER, now, supabase: {}, fetchImpl: async () => Response.json({ success: false }, { status: 500 }) }), /mapping service/)
})
