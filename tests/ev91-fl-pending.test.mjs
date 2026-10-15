import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let databaseReply = () => ({ data: [], error: null })
globalThis.__flPendingDatabase = { from(table) {
  const query = { table }
  const builder = {}
  for (const method of ['select', 'order', 'limit', 'gte', 'lte', 'gt']) {
    builder[method] = (...args) => { query[method] = args; return builder }
  }
  builder.then = (resolve, reject) => Promise.resolve(databaseReply(query)).then(resolve, reject)
  return builder
} }
const { createRoot } = await import('react-dom/client')
const server = await createServer({ cacheDir: 'node_modules/.vite-tests/ev91-fl-pending',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'no-live-database', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__flPendingDatabase'
  } }],
})
after(async () => {
  await server.close()
  dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__flPendingDatabase']) delete globalThis[key]
})
const report = await server.ssrLoadModule('/src/lib/ev91FlPending.js')
const { default: Page } = await server.ssrLoadModule('/src/Ev91FlPending.jsx')
const { loadEv91FlPendingData } = await server.ssrLoadModule('/src/lib/ev91FlPendingDb.js')
const asOf = new Date(2026, 9, 15)
const order = (id, extra = {}) => ({ worker_code: id, worker_name: 'Order Rider', city: 'Chennai',
  client: 'Blinkit', date_record: '2026-10-09', delivered: 5, ...extra })
const build = (orders, onboarding = [], mapping = [], details = []) => report.buildEv91FlPendingRows(orders, mapping, onboarding, details, asOf)

test('FL status uses only onboarding Client IDs and sources, regardless of EV91 mapping sources', () => {
  const rows = build([order('missing'), order('empty'), order('complete')], [
    { rider_id: 'empty', source_name: '' }, { rider_id: 'complete', source_name: 'Referral Team' },
  ], [{ clientId: 'missing', ev91RiderId: 'EV-1', source: 'API Source' },
    { clientId: 'empty', ev91RiderId: 'EV-2', source: 'API Source' }])
  const byId = new Map(rows.map((row) => [row.clientId, row]))
  assert.equal(byId.get('missing').status, 'Client ID not in onboarding')
  assert.equal(byId.get('missing').ev91RiderId, 'EV-1')
  assert.equal(byId.get('empty').status, 'Source name missing')
  assert.equal(byId.get('complete').pending, false)
  assert.equal(byId.get('complete').sourceName, 'Referral Team')
  assert.equal(report.filterEv91FlPendingRows(rows).length, 2)
})

test('all onboarding ID fields, aliases and placeholder sources preserve missing-source detection', () => {
  for (const field of ['rider_id_details', 'rider_id', 'worker_code', 'client_rider_id', 'merge']) {
    const [row] = build([order('963117.0')], [{ [field]: field === 'merge' ? 'voiceFE963117' : 'FE963117', source_name: 'Team' }])
    assert.equal(row.pending, false, field)
  }
  for (const source of ['', ' ', '-', '—', 'N/A', 'null', 'Unknown', 'none', 'not available']) {
    const [row] = build([order('CHN61-R0196')], [{ rider_id: 'chn61_r0196', source_name: source }])
    assert.equal(row.status, 'Source name missing', source)
    assert.equal(row.sourceName, '')
  }
  const [row] = build([order('FE963117')], [
    { rider_id: '963117', source_name: 'N/A', rider_name: 'First' },
    { rider_id: 'FE963117', source_name: 'Team', rider_mobile_number: '9876543210' },
  ])
  assert.equal(row.pending, false)
  assert.equal(row.workerName, 'First')
  assert.equal(row.mobile, '9876543210')
})

test('same names or phones cannot hide an absent onboarding Client ID', () => {
  const [row] = build([order('missing', { mob_number: '9876543210' })], [
    { rider_id: 'someone-else', rider_name: 'Order Rider', rider_mobile_number: '9876543210', source_name: 'Team' },
  ])
  assert.equal(row.status, 'Client ID not in onboarding')
})

test('order dates use net positive days; aliases combine and zeros, reversals and future rows do not extend LWD', () => {
  const rows = build([
    order('963117.0', { date_record: '01-10-2026', delivered: 4 }),
    order('FE963117', { date_record: '2026-10-01', delivered: 3 }),
    order('FE963117', { date_record: '2026-10-05', delivered: 2 }),
    order('FE963117', { date_record: '2026-10-10', delivered: 5 }),
    order('FE963117', { date_record: '2026-10-10', delivered: -5 }),
    order('FE963117', { date_record: '2026-10-14', delivered: 0 }),
    order('FE963117', { date_record: '2026-10-16', delivered: 99 }),
    order('FE963117', { delivered: 100, _ic_only: true }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].totalOrders, 9)
  assert.equal(rows[0].firstOrderDate, '2026-10-01')
  assert.equal(rows[0].lastWorkingDate, '2026-10-05')
  assert.equal(rows[0].orderDays, 2)
  assert.equal(rows[0].agingDays, 14)
  assert.equal(rows[0].inactiveDays, 10)
  const [noOrders] = build([order('zero', { delivered: 0 })])
  assert.equal(noOrders.lastWorkingDate, '')
  assert.equal(noOrders.agingDays, null)
})

test('city/client partitions and scoped EV91 mappings do not mix orders or identities', () => {
  const rows = build([order('shared'), order('shared', { city: 'BLR', client: 'Zepto', delivered: 8 }),
    order('shared', { city: 'Bangalore', client: 'zepto', delivered: 2 })], [], [
    { clientId: 'shared', clientName: 'Blinkit', ev91RiderId: 'EV-1' },
    { clientId: 'shared', clientName: 'Zepto', ev91RiderId: 'EV-2' },
  ], [{ publicRiderID: 'EV-1', name: 'One', clientRiderId: 'shared' },
    { publicRiderID: 'EV-2', name: 'Two', clientRiderId: 'shared' }])
  assert.equal(rows.length, 2)
  const filtered = report.filterEv91FlPendingRows(rows, { city: 'Bengaluru', client: 'Zepto', search: 'EV-2' })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].totalOrders, 10)
  assert.equal(filtered[0].workerName, 'Two')
  assert.equal(report.summarizeEv91FlPendingRows(rows).reduce((sum, row) => sum + row['Total Orders'], 0), 15)
  const exported = report.flPendingExportRows(filtered)
  assert.equal(exported[0]['Total Orders'], 10)
  assert.equal(exported[0]['EV91 ID'], 'EV-2')
  assert.equal(exported[0].LWD, '2026-10-09')
})

test('data load refuses partial onboarding pages before classifying missing IDs', async (t) => {
  const queries = []
  databaseReply = (query) => {
    queries.push(query)
    if (query.table !== 'rider_onboarding') return { data: [], error: null }
    if (query.gt) return { data: null, error: { code: '42703', message: 'Onboarding read failed' } }
    return { data: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, rider_id: 'R' + i })), error: null }
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [], pagination: { hasMore: false } }))
  await assert.rejects(loadEv91FlPendingData({ force: true }), (error) => error.message === 'Onboarding read failed')
  assert.equal(queries.filter((query) => query.table === 'rider_onboarding').length, 2)
  databaseReply = () => ({ data: [], error: null })
  const data = await loadEv91FlPendingData({ force: true })
  assert.deepEqual(data.onboardingRows, [])
  assert.deepEqual(data.orderRows, [])
})

test('Excel ends with EV91 Source / Referred By matched to the exported EV91 ID', () => {
  const rows = build([order('mapped'), order('detail-only'), order('no-detail')], [], [
    { clientId: 'mapped', ev91RiderId: 'EV-2', source: 'Mapping Source' },
    { clientId: 'no-detail', ev91RiderId: 'EV-ABSENT' },
  ], [
    { clientRiderId: 'mapped', publicRiderID: 'EV-1', referredById: 'Wrong Source' },
    { clientRiderId: 'other-client-id', publicRiderID: 'EV-2', referredById: ' EV91 Referral Team ' },
    { clientRiderId: 'detail-only', publicRiderId: 'EV-3', referredById: 'Direct Referral' },
    { clientRiderId: 'no-detail', publicRiderID: 'EV-4', referredById: 'Unrelated Referral' },
  ])
  const exported = report.flPendingExportRows(rows)
  const byId = new Map(exported.map((row) => [row['Client ID (Order)'], row]))
  assert.equal(byId.get('mapped')['Source / Referred By'], 'EV91 Referral Team')
  assert.equal(byId.get('mapped')['EV91 ID'], 'EV-2')
  assert.equal(byId.get('mapped')['Source Name'], '')
  assert.equal(byId.get('mapped')['FL Status'], 'Client ID not in onboarding')
  assert.equal(byId.get('detail-only')['Source / Referred By'], 'Direct Referral')
  assert.equal(byId.get('no-detail')['Source / Referred By'], '')
  assert.equal(Object.keys(exported[0]).at(-1), 'Source / Referred By')
  assert.equal(report.FL_PENDING_EXPORT_COLUMNS.at(-1).label, 'Source / Referred By')
})

function mount(t) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  return { container, root }
}
const fixture = { orderRows: [order('missing'), order('complete'), order('empty', { city: 'Bengaluru', client: 'Zepto' })],
  mappingRows: [], onboardingRows: [{ rider_id: 'complete', source_name: 'Referral' }, { rider_id: 'empty' }], riderDetails: [] }
const select = async (container, name, value) => act(async () => {
  const element = container.querySelector(`select[aria-label="${name}"]`)
  element.value = value
  element.dispatchEvent(new Event('change', { bubbles: true }))
})

test('page defaults to pending and city/client/status filters update details and summary', async (t) => {
  const { container, root } = mount(t)
  await act(async () => root.render(createElement(Page, { loadData: async () => fixture })))
  const details = () => container.querySelector('[aria-label="FL rider details"]').textContent
  assert.match(container.querySelector('h1').textContent, /FL Pending/)
  assert.match(details(), /missing/)
  assert.doesNotMatch(details(), /Referral/)
  await select(container, 'City', 'Bengaluru')
  await select(container, 'Client', 'Zepto')
  assert.match(details(), /empty/)
  assert.doesNotMatch(details(), /Order Client ID missing/)
  const summary = container.querySelector('[aria-label="City and client summary"] tbody')
  assert.equal(summary.querySelectorAll('tr').length, 1)
  assert.match(summary.textContent, /BengaluruZepto/)
  await select(container, 'City', 'All')
  await select(container, 'Client', 'All')
  await select(container, 'FL status', 'FL Complete')
  assert.match(details(), /Referral/)
  assert.doesNotMatch(details(), /Client ID not in onboarding/)
})

test('failed reference loads cannot display false pending; Refresh retries complete data', async (t) => {
  const { container, root } = mount(t)
  const options = []
  const loadData = async (option) => { options.push(option); if (options.length === 1) throw new Error('Onboarding unavailable'); return fixture }
  await act(async () => root.render(createElement(Page, { loadData })))
  assert.match(container.querySelector('[role="alert"]').textContent, /Onboarding unavailable/)
  assert.equal(container.querySelector('[aria-label="FL rider details"]'), null)
  const buttons = [...container.querySelectorAll('button')]
  assert.equal(buttons.find((button) => button.textContent.includes('Export')).disabled, true)
  await act(async () => buttons.find((button) => button.textContent.includes('Refresh')).click())
  assert.ok(container.querySelector('[aria-label="FL rider details"]'))
  assert.deepEqual(options, [{ force: false }, { force: true }])
})
