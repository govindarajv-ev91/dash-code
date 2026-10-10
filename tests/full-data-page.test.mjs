import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent']) {
  globalThis[name] = name === 'window' ? dom.window : dom.window[name]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
let databaseReply = () => ({ data: [], error: null })
globalThis.__fullDataPageClient = {
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'eq', 'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit']) {
      builder[method] = (...args) => { query[method] = args; return builder }
    }
    builder.then = (resolve, reject) => Promise.resolve(databaseReply(query)).then(resolve, reject)
    return builder
  },
  rpc(rpc) { return Promise.resolve(databaseReply({ rpc })) },
}
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/full-data-page',
  ssr: { noExternal: ['html-to-image'] },
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [], exclude: ['html-to-image'] },
  plugins: [{
    name: 'mock-full-data-page', enforce: 'pre',
    resolveId(source) {
      if (source === 'html-to-image') return '\0unavailable-screenshot-library'
    },
    load(id) {
      if (id === '\0unavailable-screenshot-library') {
        return "throw new Error('Screenshot library is unavailable'); export function toBlob() {} export function toCanvas() {} export function toPng() {}"
      }
    },
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) {
        return 'export const supabase = globalThis.__fullDataPageClient'
      }
    },
  }],
})
const { default: FullDataPage } = await server.ssrLoadModule('/src/components/FullDataPage.jsx')
const { default: FullData } = await server.ssrLoadModule('/src/FullData.jsx')
const orders = await server.ssrLoadModule('/src/lib/orderUploadDb.js')
const iot = await server.ssrLoadModule('/src/lib/iotDataDb.js')
const api = await server.ssrLoadModule('/src/lib/ev91MisApi.js')
const screenshot = await server.ssrLoadModule('/src/lib/fullDataShareScreenshot.js')
after(async () => {
  await server.close(); dom.window.close()
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'IS_REACT_ACT_ENVIRONMENT', '__fullDataPageClient']) delete globalThis[name]
})

function mount(t) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const uncaught = []
  const root = createRoot(container, { onUncaughtError: (error) => uncaught.push(error), onCaughtError() {} })
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  return { container, root, uncaught }
}
function app(loadPage, riderData = []) {
  return createElement('div', null,
    createElement('aside', null, 'Dashboard navigation'),
    createElement(FullDataPage, { loadPage, onboardingData: [], riderData }))
}
const workingPage = () => createElement('h1', null, 'Full Data table')
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  assert.ok(predicate(), 'Page did not finish rendering')
}

test('opening Full Data shows progress while its module loads and preserves navigation', async (t) => {
  const { container, root, uncaught } = mount(t)
  let resolve
  const load = () => new Promise((done) => { resolve = done })
  await act(async () => root.render(app(load)))
  assert.match(container.textContent, /Opening Full Data/)
  assert.match(container.textContent, /Dashboard navigation/)
  await act(async () => resolve({ default: workingPage }))
  assert.match(container.textContent, /Full Data table/)
  assert.deepEqual(uncaught, [])
})

test('a failed page import stays inside Full Data and Retry requests the module again', async (t) => {
  t.mock.method(console, 'error', () => {})
  const { container, root, uncaught } = mount(t)
  let calls = 0
  const load = async () => {
    if (++calls === 1) throw new Error('Failed to fetch dynamically imported module')
    return { default: workingPage }
  }
  await act(async () => root.render(app(load)))
  assert.match(container.querySelector('[role="alert"]').textContent, /Full Data couldn’t open/)
  assert.match(container.textContent, /Dashboard navigation/)
  await act(async () => container.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(calls, 2)
  assert.match(container.textContent, /Full Data table/)
  assert.deepEqual(uncaught, [])
})

test('a Full Data render error cannot unmount the dashboard and Retry remounts the page', async (t) => {
  t.mock.method(console, 'error', () => {})
  const { container, root, uncaught } = mount(t)
  function BrokenPage() { throw new ReferenceError('Report render failed') }
  let calls = 0
  const load = async () => ({ default: ++calls === 1 ? BrokenPage : workingPage })
  await act(async () => root.render(app(load)))
  assert.match(container.textContent, /Report render failed/)
  assert.match(container.textContent, /Dashboard navigation/)
  await act(async () => container.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.match(container.textContent, /Full Data table/)
  assert.deepEqual(uncaught, [])
})

test('real Full Data loads a month and renders its matrix without a client render error', async (t) => {
  const { container, root, uncaught } = mount(t)
  orders.clearOrderUploadCache(); iot.clearIotRiderOrderCache(); api.clearEv91AllCache()
  databaseReply = (query) => {
    if (query.rpc) return { data: [{ month: 'Jun-2026' }], error: null }
    if (query.table === 'iot_data') return { data: [], error: null }
    if (query.select?.[0] === 'id') return { data: [{ id: 1 }], error: null }
    return { data: [{ id: 1, month: 'Jun-2026', date_record: '2026-06-03', worker_code: 'FE1', delivered: 5, city: 'Chennai', client: 'Blinkit', type1: 'EV' }], error: null }
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [], pagination: { hasMore: false } }))
  await act(async () => root.render(app(async () => ({ default: FullData }))))
  await waitFor(() => container.querySelector('.full-data-sheet') || uncaught.length)
  assert.deepEqual(uncaught, [])
  assert.match(container.textContent, /FleetPro Full Data/)
  assert.match(container.textContent, /Jun-2026/)
  assert.equal(container.querySelectorAll('.full-data-sheet table').length, 1)
})

test('a database timeout keeps the page visible and Refresh recovers the month', async (t) => {
  const { container, root, uncaught } = mount(t)
  orders.clearOrderUploadCache(); iot.clearIotRiderOrderCache(); api.clearEv91AllCache()
  t.mock.method(console, 'warn', () => {})
  const originalTimeout = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => originalTimeout(fn, ms >= 200 ? 0 : ms, ...args))
  let failing = true
  databaseReply = (query) => {
    if (query.rpc) return { data: [{ month: 'Jun-2026' }], error: null }
    if (query.table === 'iot_data') return { data: [], error: null }
    if (query.select?.[0] === 'id') return { data: [{ id: 1 }], error: null }
    if (failing) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    return { data: [{ id: 1, month: 'Jun-2026', date_record: '2026-06-03', worker_code: 'FE1', delivered: 5 }], error: null }
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [], pagination: { hasMore: false } }))
  await act(async () => root.render(app(async () => ({ default: FullData }))))
  await waitFor(() => container.textContent.includes('The database took too long'))
  assert.match(container.textContent, /Dashboard navigation/)
  assert.match(container.textContent, /Unable to load this month/)
  assert.deepEqual(uncaught, [])
  failing = false
  const refresh = [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Refresh')
  await act(async () => refresh.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await waitFor(() => container.querySelector('.full-data-sheet'))
  assert.ok(!container.textContent.includes('The database took too long'))
})

test('the screenshot library is loaded only for capture, so its failure does not block opening Full Data', async () => {
  // The real Full Data module and matrix above loaded while this library was unavailable.
  await assert.rejects(screenshot.captureElementPngBlob({}), /Screenshot library is unavailable/)
})


test('rendered zero-order counts use shared prior-month orders and wait for reference contacts', async (t) => {
  const { container, root, uncaught } = mount(t)
  orders.clearOrderUploadCache(); iot.clearIotRiderOrderCache(); api.clearEv91AllCache()
  databaseReply = (query) => {
    if (query.rpc) return { data: [{ month: 'Jun-2026' }], error: null }
    if (query.table === 'iot_data') return { data: [], error: null }
    if (query.select?.[0] === 'id') return { data: [{ id: 1 }], error: null }
    return { data: [{ id: 1, month: 'Jun-2026', date_record: '2026-06-01', worker_code: 'unrelated', delivered: 1 }], error: null }
  }
  let finishDetails
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('rider-details')) await new Promise((resolve) => { finishDetails = resolve })
    return Response.json({ success: true, data: String(url).includes('overall-status') ? [{
      vehicleStatus: 'Deployed', statusDate: '2026-05-01', vehicleNumber: 'TN1234', clientId: 'FE123456',
      riderName: 'Test Rider', cityName: 'Chennai', clientName: 'Blinkit',
    }] : [], pagination: { hasMore: false } })
  })
  const riderData = [{ _data_source: 'order_upload', worker_code: '123456', date_record: '2026-05-30', delivered: 4 }]
  await act(async () => root.render(app(async () => ({ default: FullData }), riderData)))
  await waitFor(() => finishDetails && container.querySelector('.full-data-sheet'))
  const cell = (key, date) => container.querySelector('[data-metric-total="' + key + '"]').closest('tr').querySelector('[data-date-key="' + date + '"]')
  assert.equal(cell('zeroOrderRiderCount', '2026-06-01').textContent, '\u2026')
  const exportButton = [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Export')
  assert.equal(exportButton.disabled, true)
  await act(async () => finishDetails())
  await waitFor(() => cell('zeroOrderRiderCount', '2026-06-04').textContent === '1')
  assert.equal(cell('zeroOrderRiderCount', '2026-06-01').textContent, '0')
  assert.equal(cell('d1ZeroOrderRiderCount', '2026-06-01').textContent, '0')
  assert.equal(cell('d1ZeroOrderRiderCount', '2026-06-04').textContent, '1')
  assert.equal(exportButton.disabled, false)
  assert.deepEqual(uncaught, [])
})

test('rendered D-1 counts exclude recent deployments and include them after four calendar days', async (t) => {
  const { container, root, uncaught } = mount(t)
  orders.clearOrderUploadCache(); iot.clearIotRiderOrderCache(); api.clearEv91AllCache()
  databaseReply = (query) => {
    if (query.rpc) return { data: [{ month: 'Jun-2026' }], error: null }
    if (query.table === 'iot_data') return { data: [], error: null }
    if (query.select?.[0] === 'id') return { data: [{ id: 1 }], error: null }
    return { data: [{ id: 1, month: 'Jun-2026', date_record: '2026-06-09', worker_code: 'unrelated', delivered: 1 }], error: null }
  }
  t.mock.method(globalThis, 'fetch', async (url) => Response.json({ success: true,
    data: String(url).includes('overall-status') ? [
      { vehicleStatus: 'Deployed', statusDate: '2026-05-01', vehicleNumber: 'TN-OLD', clientId: 'older', cityName: 'Chennai', clientName: 'Blinkit' },
      { vehicleStatus: 'Deployed', statusDate: '2026-06-06', vehicleNumber: 'TN-NEW', clientId: 'newer', cityName: 'Chennai', clientName: 'Blinkit' },
    ] : [], pagination: { hasMore: false },
  }))
  await act(async () => root.render(app(async () => ({ default: FullData }))))
  const cell = (key, date) => container.querySelector(`[data-metric-total="${key}"]`)?.closest('tr').querySelector(`[data-date-key="${date}"]`)
  await waitFor(() => cell('d1ZeroOrderRiderCount', '2026-06-10')?.textContent === '2')
  assert.equal(cell('zeroOrderRiderCount', '2026-06-09').textContent, '2')
  assert.equal(cell('d1ZeroOrderRiderCount', '2026-06-09').textContent, '1')
  assert.equal(cell('zeroOrderRiderCount', '2026-06-10').textContent, '2')
  assert.match(cell('d1ZeroOrderRiderCount', '2026-06-09').closest('tr').querySelector('td').title, /previous 3 days/)
  assert.deepEqual(uncaught, [])
})
