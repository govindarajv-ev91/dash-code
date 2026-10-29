import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event']) {
  globalThis[name] = name === 'window' ? dom.window : dom.window[name]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
let reply
const queries = []
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
const row = (id, overrides = {}) => ({
  id, worker_code: `R${id}`, date_record: '2026-10-29', client: 'Client',
  delivered: 5, city: 'Chennai', month: 'Oct-2026', created_at: '2026-10-29T05:00:00Z',
  ...overrides,
})
function builder(query) {
  const chain = {}
  for (const method of ['select', 'order', 'limit', 'gt', 'lt', 'gte', 'lte', 'eq', 'upsert', 'insert', 'delete', 'neq', 'abortSignal']) {
    chain[method] = (...args) => { query[method] = args; return chain }
  }
  chain.then = (resolve, reject) => {
    queries.push(query)
    return Promise.resolve().then(() => reply(query)).then(resolve, reject)
  }
  return chain
}
globalThis.__uploadTestClient = {
  from: (table) => builder({ table }),
  rpc: (rpc) => builder({ rpc }),
}
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/order-upload-performance',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'upload-test-client', enforce: 'pre', transform(_code, id) {
    const path = id.replaceAll('\\', '/')
    if (path.endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__uploadTestClient'
    if (path.endsWith('/src/lib/orderUploadParse.js')) return `
      export const ORDER_UPLOAD_HEADER_LABELS = ['Client', 'Date'];
      export const ORDER_UPLOAD_PREVIEW_COLUMNS = [{ key: 'worker_code', label: 'WorkerCode' }];
      export const parseOrderUploadFile = () => ({ rows: [${JSON.stringify(row(99))}], sheetName: 'Orders' });
      export const summarizeOrderUploadDates = () => [];
      export const downloadOrderUploadTemplate = () => {};`
  } }],
})
const orders = await server.ssrLoadModule('/src/lib/orderUploadDb.js')
const { default: OrderUpload } = await server.ssrLoadModule('/src/OrderUpload.jsx')

beforeEach(() => { queries.length = 0; orders.clearOrderUploadCache() })
after(async () => {
  await server.close(); dom.window.close()
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__uploadTestClient']) delete globalThis[name]
})

test('summary uses three requests and publishes preview before parallel metadata; no counts scan rows', async () => {
  const count = deferred(), months = deferred()
  const preview = [row(10)]
  let partial
  reply = (query) => query.rpc ? months.promise
    : query.select[1]?.head ? count.promise : { data: preview }
  const pending = orders.loadOrderUploadSummary({ onPreview: (value) => { partial = value } })
  await tick()
  assert.equal(partial.preview, preview)
  assert.equal(partial.lastUploadAt, preview[0].created_at)
  assert.equal(queries.length, 3, 'metadata overlaps without redundant existence/timestamp queries')
  assert.deepEqual(queries.find((query) => query.select?.[1]).select[1], { count: 'planned', head: true })
  count.resolve({ count: 200000 })
  months.resolve({ data: [{ month: 'Sep-2026' }, { month: 'Oct-2026' }] })
  const summary = await pending
  assert.equal(summary.count, 200000)
  assert.equal(summary.countIsLowerBound, false)
  assert.deepEqual(summary.months, ['Oct-2026', 'Sep-2026'])
})

test('empty table needs one request; missing table still reports setup requirement', async () => {
  reply = () => ({ data: [] })
  assert.equal((await orders.loadOrderUploadSummary()).count, 0)
  assert.equal(queries.length, 1)
  reply = () => ({ error: { code: 'PGRST205', message: 'order_upload_data missing from schema cache' } })
  assert.equal((await orders.loadOrderUploadSummary()).missingTable, true)
})

test('count timeouts never trigger an exact count; empty month RPC needs no sampled scan', async () => {
  reply = (query) => query.rpc ? { data: [] }
    : query.select[1]?.head ? { error: { code: '57014' } } : { data: [row(1)] }
  const summary = await orders.loadOrderUploadSummary()
  assert.equal(summary.count, 1)
  assert.equal(summary.countIsLowerBound, true)
  assert.equal(queries.length, 3)
})

test('post-save preview is local, preserves old months, and does not inflate counts on reupload', () => {
  reply = () => { throw new Error('Unexpected database request') }
  const summary = orders.refreshOrderUploadSummaryAfterSave([row(1)], {
    previousCount: 2000, previousMonths: ['Sep-2026'],
  })
  assert.equal(summary.count, 2000)
  assert.deepEqual(summary.months, ['Oct-2026', 'Sep-2026'])
  assert.equal(queries.length, 0)
})

test('large upload deduplicates rows and uses five writes with at most two active requests', async () => {
  let active = 0, peak = 0
  const committed = [], progress = []
  reply = async (query) => {
    active++; peak = Math.max(peak, active)
    await tick()
    committed.push(...query.upsert[0]); active--
    assert.equal(query.upsert[1].onConflict, 'worker_code,date_record,client,delivered')
    return { error: null }
  }
  const rows = Array.from({ length: 2001 }, (_, index) => row(index))
  rows.push(row(0, { city: 'updated' }), row(5000, { worker_code: '' }))
  const result = await orders.saveOrderUploadRows(rows, { onProgress: (value) => progress.push(value) })
  assert.equal(result.saved, 2001)
  assert.equal(result.skipped, 2)
  assert.equal(queries.length, 5, 'previously required 11 sequential writes at 200 rows each')
  assert.equal(peak, 2)
  assert.equal(committed.find((item) => item.worker_code === 'R0').city, 'updated')
  assert.deepEqual(progress.at(-1), { saved: 2001, total: 2001 })
  assert.ok(progress.every((value, index) => index === 0 || value.saved > progress[index - 1].saved))
})

test('failed uploads stop scheduling chunks and settle active writes before rejecting', async () => {
  const activeWrite = deferred()
  const failure = { code: '42501', message: 'RLS denied' }
  let calls = 0, settled = false
  reply = () => ++calls === 1 ? { error: failure } : activeWrite.promise
  const saving = orders.saveOrderUploadRows(Array.from({ length: 2000 }, (_, index) => row(index)))
  const result = saving.then(() => { settled = true }, (error) => { settled = true; return error })
  await tick()
  assert.equal(calls, 2)
  assert.equal(settled, false)
  activeWrite.resolve({ error: null })
  assert.equal(await result, failure)
  assert.equal(calls, 2)
})

function database(rows) {
  return (query) => {
    let data = rows.filter((item) => ['gt', 'lt', 'gte', 'lte'].every((method) => {
      if (!query[method]) return true
      const [key, value] = query[method]
      return method === 'gt' ? item[key] > value : method === 'lt' ? item[key] < value
        : method === 'gte' ? item[key] >= value : item[key] <= value
    }) && (!query.eq || item[query.eq[0]] === query.eq[1]))
    data = [...data].sort((a, b) => query.order?.[1]?.ascending === false ? b.id - a.id : a.id - b.id)
    return { data: data.slice(0, query.limit?.[0] || data.length) }
  }
}

test('complete caches are reused after a patch; single-file patches still require a complete fetch', async () => {
  const rows = [row(1), row(2)]
  reply = database(rows)
  orders.patchOrderUploadCache([row(3)])
  assert.equal((await orders.fetchAllOrderUploads()).length, 2, 'partial patch must not hide older DB rows')
  const requests = queries.length
  orders.patchOrderUploadCache([row(3)])
  assert.equal((await orders.fetchAllOrderUploads()).length, 3)
  assert.equal(queries.length, requests, 'no forced full scan after patching a complete cache')
  await orders.fetchOrderUploadsForHistory('Oct-2026')
  rows.push(row(3))
  orders.patchOrderUploadCache([row(3)])
  assert.equal((await orders.fetchOrderUploadsForHistory('Oct-2026')).length, 3, 'history must refresh after upload')
})

test('preview renders while metadata is pending, and successful upload is usable before background refresh', async (t) => {
  const firstCount = deferred(), backgroundCount = deferred()
  let uploaded = false, notified = false
  reply = (query) => {
    if (query.upsert) { uploaded = true; return { error: null } }
    if (query.rpc) return { data: [{ month: 'Oct-2026' }] }
    if (query.select[1]?.head) return uploaded ? backgroundCount.promise : firstCount.promise
    return { data: [row(uploaded ? 99 : 1)] }
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  t.after(async () => {
    firstCount.resolve({ count: 10 }); backgroundCount.resolve({ count: 11 })
    await act(async () => { await root.unmount(); await tick() }); host.remove()
  })
  await act(async () => root.render(createElement(OrderUpload, {
    onOrdersSaved: () => { notified = true; return Promise.resolve() },
  })))
  assert.match(host.querySelector('tbody').textContent, /R1/)
  const input = host.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'orders.xlsx', arrayBuffer: async () => new ArrayBuffer(0) }] })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await tick() })
  assert.equal(notified, true)
  assert.equal(input.disabled, false, 'metadata must not keep upload controls disabled')
  assert.match(host.textContent, /Saved 1 unique rows/)
  assert.match(host.querySelector('tbody').textContent, /R99/)
  // A slow initial summary must not replace the new upload's preview/count.
  await act(async () => { firstCount.resolve({ count: 10000 }); await tick() })
  assert.match(host.querySelector('tbody').textContent, /R99/)
  assert.doesNotMatch(host.textContent, /10,000/)
})
