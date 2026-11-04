import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

const queries = []
let reply
globalThis.__fleetSdLoadingClient = {
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'order', 'limit', 'gt', 'or', 'abortSignal']) {
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
  cacheDir: 'node_modules/.vite-tests/fleet-sd-loading',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'fleet-sd-loading-database', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__fleetSdLoadingClient'
  } }],
})
const { fetchFleetSdRows, clearFleetSdCache } = await server.ssrLoadModule('/src/lib/fleetSdFetch.js')
const { FLEET_SD_COLUMNS } = await server.ssrLoadModule('/src/lib/fleetDataConfig.js')

after(async () => { await server.close(); delete globalThis.__fleetSdLoadingClient })
beforeEach(() => { queries.length = 0; clearFleetSdCache() })

function database(tables, cap = 1000) {
  return (query) => ({ data: (tables[query.table] || [])
    .filter((row) => !query.gt || BigInt(row.id) > BigInt(query.gt[1]))
    .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)
    .slice(0, Math.min(query.limit[0], cap)), error: null })
}

test('fleet SD loads both complete capped histories and shares forced refresh requests', async () => {
  reply = database({ fleet_data: [
    { id: '9007199254740993', rider_id: '00123', security_deposit_paid_deployee: '100' },
    { id: '9007199254740994', rider_id: 'LAST', security_deposit_paid_deployee: '200' },
  ], new_fleet_data: [{ id: 1, rider_id: 'NEW', security_deposit_paid_deployee: '300' }] }, 1)
  const [rows, shared] = await Promise.all([fetchFleetSdRows(), fetchFleetSdRows({ force: true })])
  assert.equal(rows, shared)
  assert.deepEqual(rows.map((row) => [row.rider_id, row.security_deposit_paid_deployee, row.data_source]), [
    ['00123', '100', 'Database'], ['LAST', '200', 'Database'], ['NEW', '300', 'new_fleet_data'],
  ])
  assert.equal(queries.length, 5)
  assert.ok(queries.every((query) => query.select[0] === FLEET_SD_COLUMNS && query.limit[0] === 1000))
  assert.ok(queries.every((query) => query.or[0].includes('vehicle_status.eq.Deployee')))
  assert.ok(queries.every((query) => query.abortSignal?.[0] instanceof AbortSignal), 'every fleet request must have a timeout signal')
  assert.deepEqual(queries.filter((query) => query.table === 'fleet_data').map((query) => query.gt?.[1]),
    [undefined, '9007199254740993', '9007199254740994'])
  assert.equal(await fetchFleetSdRows(), rows)
  assert.equal(queries.length, 5)
})

test('a later fleet page failure rejects instead of caching incomplete SD balances', async () => {
  const successfulReply = database({ fleet_data: [{ id: 1 }, { id: 2 }], new_fleet_data: [{ id: 1 }] }, 1)
  reply = (query) => query.table === 'fleet_data' && query.gt
    ? { data: null, error: { code: '42703', message: 'column does not exist' } }
    : successfulReply(query)
  await assert.rejects(fetchFleetSdRows(), { code: '42703' })
  reply = successfulReply
  const recovered = await fetchFleetSdRows()
  assert.equal(recovered.length, 3)
  assert.equal(await fetchFleetSdRows(), recovered)
})

test('a rejected refresh leaves the previously complete cache available', async () => {
  reply = database({ fleet_data: [{ id: 1, rider_id: 'CACHED' }] })
  const cached = await fetchFleetSdRows()
  reply = () => ({ data: null, error: { code: '42703', message: 'column does not exist' } })
  await assert.rejects(fetchFleetSdRows({ force: true }), { code: '42703' })
  assert.equal(await fetchFleetSdRows(), cached)
})

test('a cleared fleet request cannot overwrite a newer complete cache', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  reply = () => pending
  const old = fetchFleetSdRows()
  await new Promise((resolve) => setImmediate(resolve))
  clearFleetSdCache()
  reply = database({ fleet_data: [{ id: 2, rider_id: 'NEW' }] })
  const fresh = await fetchFleetSdRows()
  release({ data: [], error: null })
  await old
  assert.equal(await fetchFleetSdRows(), fresh)
  assert.equal(fresh[0].rider_id, 'NEW')
})
