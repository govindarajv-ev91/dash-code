import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

const queries = []
let reply
globalThis.__sdLoadingClient = {
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'order', 'limit', 'gt', 'gte', 'lte', 'eq', 'abortSignal', 'insert', 'upsert']) {
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
  cacheDir: 'node_modules/.vite-tests/sd-payment-loading',
  server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'sd-loading-database', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__sdLoadingClient'
  } }],
})
const payments = await server.ssrLoadModule('/src/lib/riderPaymentDb.js')
const manual = await server.ssrLoadModule('/src/lib/manualCollationDb.js')

test('payment upload count uses exact rows rather than stale planner estimates', async () => {
  reply = (query) => {
    if (query.select[1]?.count === 'exact') return { data: null, error: null, count: 197392 }
    if (query.select[1]?.count) return { data: null, error: null, count: 204827 }
    return { data: [{ id: 1 }], error: null }
  }
  assert.equal(await payments.fetchRiderPaymentCount(), 197392)
  assert.ok(queries.some((query) => query.select[1]?.count === 'exact'))
  assert.ok(!queries.some((query) => ['estimated', 'planned'].includes(query.select[1]?.count)))
})

test('payment upload count does not substitute an estimate when the exact count fails', async () => {
  reply = (query) => query.select[1]?.count === 'exact'
    ? { error: { code: '57014', message: 'count timed out' } }
    : { data: [{ id: 1 }], error: null, count: 204827 }
  await assert.rejects(payments.fetchRiderPaymentCount(), { code: '57014' })
})
after(async () => { await server.close(); delete globalThis.__sdLoadingClient })
beforeEach(() => {
  queries.length = 0
  payments.clearRiderPaymentCache()
  manual.clearManualCollationCache()
})

const variants = [
  { label: 'payment', table: 'rider_payment_data', load: payments.fetchRiderPaymentsForSdRent,
    full: payments.fetchAllRiderPayments, clear: payments.clearRiderPaymentCache, save: payments.saveRiderPaymentRows,
    columns: 'id,client_name,type,week,month,rider_id,rider_name,city,sd,ev_rent,vehicle_number,period_start,payment_date' },
  { label: 'manual', table: 'manual_collation_data', load: manual.fetchManualCollationForSdRent,
    full: manual.fetchAllManualCollation, clear: manual.clearManualCollationCache, save: manual.saveManualCollationRows,
    columns: 'id,rider_id,rider_name,city,month,purpose,deposits,withdrawals,vehicle_number' },
]
function database(rows, cap = 1000) {
  return (query) => {
    if (query.insert || query.upsert) {
      const added = (query.insert || query.upsert)[0]
      rows.push(...added)
      return { data: added.map(({ id }) => ({ id })), error: null }
    }
    const selected = rows.filter((row) => (!query.gt || BigInt(row.id) > BigInt(query.gt[1])) &&
      (!query.gte || BigInt(row.id) >= BigInt(query.gte[1])) && (!query.lte || BigInt(row.id) <= BigInt(query.lte[1])))
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1) * (query.order?.[1]?.ascending === false ? -1 : 1))
      .slice(0, Math.min(query.limit?.[0] || 1000, cap))
    const columns = query.select[0]
    return { data: columns === '*' ? selected : selected.map((row) => Object.fromEntries(
      columns.split(',').map((key) => [key, row[key] ?? null])
    )), error: null, count: rows.length }
  }
}

for (const variant of variants) {
  test(`${variant.label}: slim shared fetch reads every capped page and preserves IDs/amounts`, async () => {
    const rows = [
      { id: '9007199254740993', rider_id: '00123', sd: 0, ev_rent: 500, deposits: 0, withdrawals: 300 },
      { id: '9007199254740994', rider_id: 'FE12345', sd: 250, ev_rent: 0, deposits: 100, withdrawals: 0 },
      { id: '9007199254740995', rider_id: 'LAST', sd: -100, ev_rent: 100, deposits: 100, withdrawals: 20 },
    ]
    reply = database(rows, 1)
    const [first, shared] = await Promise.all([variant.load(), variant.load()])
    assert.equal(first, shared)
    assert.deepEqual(first.map((row) => row.id), rows.map((row) => row.id))
    assert.equal(first[0].rider_id, '00123')
    if (variant.label === 'payment') assert.deepEqual(first.map((row) => [row.sd, row.ev_rent]), [[0, 500], [250, 0], [-100, 100]])
    else assert.deepEqual(first.map((row) => [row.deposits, row.withdrawals]), [[0, 300], [100, 0], [100, 20]])
    const count = queries.length
    assert.equal(count, variant.label === 'payment' ? 6 : 4, 'short pages continue until the empty final page; concurrent callers share the scan')
    assert.ok(queries.every((query) => query.table === variant.table && (
      (query.select[0] === variant.columns && query.limit[0] === 1000) ||
      (variant.label === 'payment' && query.select[0] === 'id' && query.limit[0] === 1))))
    assert.ok(queries.filter((query) => query.gt).every((query) => rows.some((row) => row.id === query.gt[1])))
    assert.equal(await variant.load(), first)
    assert.equal(queries.length, count, 'subsequent visits reuse the cache')
  })

  test(`${variant.label}: completed full-history cache avoids an additional slim download`, async () => {
    reply = database([{ id: 1, rider_id: 'ONE', month: 'Oct-2026', sd: 250, deposits: 100 }])
    const full = await variant.full()
    const before = queries.length
    assert.equal(await variant.load(), full)
    assert.equal(queries.length, before)
  })

  test(`${variant.label}: concurrent refreshes share one scan and do not return a stale cache`, async () => {
    reply = database([{ id: 1, rider_id: 'OLD' }])
    await variant.load()
    queries.length = 0
    let release
    const pending = new Promise((resolve) => { release = resolve })
    reply = (query) => query.gt ? { data: [], error: null } : pending
    const refresh = variant.load({ force: true })
    const duplicateRefresh = variant.load({ force: true })
    const visit = variant.load()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(queries.length, variant.label === 'payment' ? 2 : 1)
    release({ data: [{ id: 2, rider_id: 'NEW' }], error: null })
    const [fresh, shared, latest] = await Promise.all([refresh, duplicateRefresh, visit])
    assert.equal(fresh, shared)
    assert.equal(fresh, latest)
    assert.equal(fresh[0].rider_id, 'NEW')
    assert.equal(queries.length, 2)
  })

  test(`${variant.label}: upload invalidates the slim cache and fresh rows are loaded`, async () => {
    const rows = [{ id: 1, rider_id: 'ONE' }]
    reply = database(rows)
    assert.equal((await variant.load()).length, 1)
    await variant.save([{ id: 2, rider_id: 'TWO', upload_dedupe_key: 'new-row' }], { replace: false })
    assert.deepEqual((await variant.load()).map((row) => row.id), [1, 2])
  })

  test(`${variant.label}: a failed later page rejects without caching partial history`, async () => {
    const rows = [{ id: 1, rider_id: 'ONE' }, { id: 2, rider_id: 'TWO' }]
    const dataReply = database(rows, 1)
    reply = (query) => query.gt ? { data: null, error: { code: '42703', message: 'column does not exist' } } : dataReply(query)
    await assert.rejects(variant.load(), { code: '42703' })
    reply = dataReply
    assert.deepEqual((await variant.load()).map((row) => row.id), [1, 2])
  })

  test(`${variant.label}: transient failures stop after two retries and a later request can recover`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    reply = () => ({ data: null, error: { code: 'XX000', message: 'Unavailable' } })
    const rejected = assert.rejects(variant.load(), { code: 'XX000' })
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(1000)
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(2000)
    await rejected
    assert.equal(queries.length, variant.label === 'payment' ? 6 : 3)
    reply = database([{ id: 1, rider_id: 'RECOVERED' }])
    assert.equal((await variant.load())[0].rider_id, 'RECOVERED')
  })

  test(`${variant.label}: a stalled later page times out, aborts retries, and never caches incomplete totals`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const rows = [{ id: 1, rider_id: 'ONE', sd: 250, deposits: 100 }, { id: 2, rider_id: 'TWO', sd: 500, deposits: 200 }]
    const dataReply = database(rows, 1)
    reply = (query) => query.gt ? new Promise(() => {}) : dataReply(query)
    const rejected = assert.rejects(variant.load(), { name: 'TimeoutError', code: 'REQUEST_TIMEOUT' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(queries.length, variant.label === 'payment' ? 4 : 2)
    for (let attempt = 0; attempt < 3; attempt++) {
      const signal = queries.at(-1).abortSignal[0]
      assert.equal(signal.aborted, false)
      t.mock.timers.tick(15000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(signal.aborted, true)
      if (attempt < 2) {
        t.mock.timers.tick((attempt + 1) * 1000)
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
    await rejected
    assert.equal(queries.length, variant.label === 'payment' ? 6 : 4)
    assert.ok(queries.every((query) => query.abortSignal?.[0]), 'every page is bounded, including response parsing')
    reply = dataReply
    const recovered = await variant.load()
    assert.deepEqual(recovered.map((row) => row.id), [1, 2])
  })

  test(`${variant.label}: cleared slim/full requests cannot overwrite a newer cache`, async () => {
    for (const startOld of [variant.load, variant.full]) {
      variant.clear()
      let release
      const pending = new Promise((resolve) => { release = resolve })
      reply = (query) => query.select[0] === 'id' && query.order?.[1]?.ascending !== false
        ? { data: [{ id: 1 }], error: null } : pending
      const older = startOld()
      await new Promise((resolve) => setImmediate(resolve))
      variant.clear()
      reply = database([{ id: 2, rider_id: 'NEW' }])
      const newer = await variant.load()
      release({ data: [], error: null })
      await older
      assert.equal(await variant.load(), newer)
      assert.equal(newer[0].rider_id, 'NEW')
      assert.equal((await variant.full())[0]?.rider_id, 'NEW', 'an old full scan must not leave a stale reusable full cache')
    }
  })
}

test('manual: a partly successful append invalidates cached SD amounts', async () => {
  const rows = [{ id: 1, rider_id: 'OLD', deposits: 100 }]
  const dataReply = database(rows)
  reply = dataReply
  await manual.fetchManualCollationForSdRent()
  let batches = 0
  reply = (query) => query.insert && ++batches === 2
    ? { error: { code: 'XX000', message: 'Second upload batch failed' } }
    : dataReply(query)
  await assert.rejects(manual.saveManualCollationRows(
    Array.from({ length: 501 }, (_, index) => ({ id: index + 2, rider_id: `NEW-${index}`, deposits: 10 })),
    { replace: false },
  ), { code: 'XX000' })
  assert.equal((await manual.fetchManualCollationForSdRent()).length, 501)
})

test('payment: four bounded ranges load concurrently, preserve every bigint ID, and share live progress', async () => {
  const base = 9007199254740993n
  const rows = Array.from({ length: 7001 }, (_, index) => ({ id: String(base + BigInt(index) * 3n),
    rider_id: `00${index}`, sd: index % 2 ? 250 : -10, ev_rent: 300 }))
  const dataReply = database(rows)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let rangeStarts = 0
  reply = async (query) => {
    if (query.gte && !query.gt) { rangeStarts++; await gate }
    return dataReply(query)
  }
  const progress = [], sharedProgress = []
  const first = payments.fetchRiderPaymentsForSdRent({ onProgress: (state) => progress.push(state) })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(rangeStarts, 4, 'independent primary-key ranges must start together')
  assert.equal(progress.at(-1).loadedRows, 1000)
  const shared = payments.fetchRiderPaymentsForSdRent({ onProgress: (state) => sharedProgress.push(state) })
  assert.equal(sharedProgress.at(-1).loadedRows, 1000, 'a returning subscriber receives current progress immediately')
  release()
  const [loaded, same] = await Promise.all([first, shared])
  assert.equal(loaded, same)
  assert.deepEqual(loaded.map((row) => row.id), rows.map((row) => row.id))
  assert.equal(new Set(loaded.map((row) => row.id)).size, rows.length)
  assert.equal(loaded.reduce((sum, row) => sum + row.sd, 0), rows.reduce((sum, row) => sum + row.sd, 0))
  for (const states of [progress, sharedProgress]) {
    assert.equal(states.at(-1).loadedRows, rows.length)
    assert.equal(states.at(-1).complete, true)
    assert.ok(states.every((state, index) => !index || state.loadedRows >= states[index - 1].loadedRows))
  }
})

test('payment: retry resumes saved range checkpoints and never repeats the initial download', async () => {
  const rows = Array.from({ length: 22 }, (_, index) => ({ id: index + 1, rider_id: `R-${index}`, sd: 50 }))
  const dataReply = database(rows, 2)
  const progress = []
  reply = (query) => query.gte && query.gt
    ? { data: null, error: { code: '42703', message: 'Temporary test failure' } }
    : dataReply(query)
  await assert.rejects(payments.fetchRiderPaymentsForSdRent({ onProgress: (state) => progress.push(state) }), { code: '42703' })
  const checkpointCount = progress.at(-1).loadedRows
  assert.ok(checkpointCount > 2 && checkpointCount < rows.length)
  const previousQueries = queries.length
  reply = dataReply
  const retried = await payments.fetchRiderPaymentsForSdRent({ force: true })
  assert.deepEqual(retried.map((row) => row.id), rows.map((row) => row.id))
  const resumed = queries.slice(previousQueries)
  assert.ok(resumed.every((query) => query.select[0] === 'id' || (query.gte && query.gt)), 'check the latest ID, then continue only unfinished ranges from their saved cursor')
})

test('payment: an upload arriving mid-scan is included on refresh, outside the original maximum ID', async () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, rider_id: `R-${index}`, sd: 50 }))
  const dataReply = database(rows, 1)
  let appended = false
  reply = (query) => {
    if (query.gte && !appended) { appended = true; rows.push({ id: 9, rider_id: 'NEW-UPLOAD', sd: 100 }) }
    return dataReply(query)
  }
  const first = await payments.fetchRiderPaymentsForSdRent()
  assert.equal(first.length, 8)
  const refreshed = await payments.fetchRiderPaymentsForSdRent({ force: true })
  assert.equal(refreshed.length, 9)
  assert.equal(refreshed.at(-1).rider_id, 'NEW-UPLOAD')
})

test('payment: retry after an external upload discards the old scan bound and includes every new row', async () => {
  const rows = Array.from({ length: 22 }, (_, index) => ({ id: index + 1, rider_id: `R-${index}`, sd: 50 }))
  const dataReply = database(rows, 2)
  reply = (query) => query.gte && query.gt
    ? { data: null, error: { code: '42703', message: 'Temporary test failure' } }
    : dataReply(query)
  await assert.rejects(payments.fetchRiderPaymentsForSdRent(), { code: '42703' })
  rows.push({ id: 23, rider_id: 'EXTERNAL-UPLOAD', sd: 100 })
  reply = dataReply
  const loaded = await payments.fetchRiderPaymentsForSdRent({ force: true })
  assert.equal(loaded.length, 23)
  assert.equal(loaded.at(-1).rider_id, 'EXTERNAL-UPLOAD')
  assert.equal(new Set(loaded.map((row) => row.id)).size, 23)
})
