import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import * as XLSX from 'xlsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'localStorage']) {
  globalThis[key] = key === 'window' ? dom.window : dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
globalThis.__summaryXlsxUtils = XLSX.utils
const server = await createServer({
  ssr: { noExternal: ['xlsx'] },
  cacheDir: 'node_modules/.vite-tests/ev91-summary-rtd',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'mock-targets-database', enforce: 'pre',
    resolveId(id) { if (id === 'xlsx') return '\0capture-summary-xlsx' },
    load(id) {
      if (id === '\0capture-summary-xlsx') return `export const utils = globalThis.__summaryXlsxUtils;
        export const writeFile = (book) => { globalThis.__summaryWorkbook = book }`
    },
    transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return `
      export const supabase = { from() {
        const query = { select() { return query }, order() { return query }, limit() { return query },
          then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) } };
        return query;
      } };
    `
  } }],
})
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', '__summaryXlsxUtils', '__summaryWorkbook']) delete globalThis[key]
})
const operational = await server.ssrLoadModule('/src/lib/ev91OperationalSummary.js')
const summaryLib = await server.ssrLoadModule('/src/lib/ev91DeployReturnSummary.js')
const targetsLib = await server.ssrLoadModule('/src/lib/fleetClientTargets.js')
const { default: Summary } = await server.ssrLoadModule('/src/Ev91DeployReturnSummary.jsx')
const vehicle = (id, status = 'Available', city = 'Chennai') => ({ id,
  registrationNumber: `TN-${id}`, operationalStatus: status, hub: { city: { displayName: city } } })

function deploymentEvents(date = '2026-10-26') {
  const event = (id, reason, changes = {}) => ({
    vehicleNumber: `TN-${id}`, vehicleStatus: 'Deployed', statusDate: date,
    clientId: `R${id}`, clientName: 'Blinkit', cityName: 'Chennai', reason, ...changes,
  })
  const rejoiner = event(2, 'RE_JOINER')
  return [event(1, 'NEW_RIDER'), rejoiner, { ...rejoiner }, event(3, 'Shifting'),
    event(4, 'Exiting', { vehicleStatus: 'Returned' }),
    event(5, 'Maintenance', { vehicleStatus: 'Returned' }),
    event(6, 'RE_JOINER', { cityName: 'Bangalore', clientName: 'Zepto' }),
    event(7, 'NEW_RIDER', { statusDate: '2020-01-01' })]
}

test('combined API mode includes new riders and rejoiners with the same city/date, duplicate and return rules', () => {
  const options = { city: 'Chennai', startDate: '2026-10-25', endDate: '2026-10-31', includeDetails: true }
  const events = deploymentEvents()
  const orders = [{ worker_code: 'IC1', date_record: '2026-10-26', city: 'Chennai', client: 'Blinkit', type1: 'NON-EV', delivered: 1 },
    { worker_code: 'EV1', date_record: '2026-10-26', city: 'Chennai', client: 'Blinkit', type1: 'EV', delivered: 1 }]
  const combined = summaryLib.buildEv91ClientWiseSummary(events, orders, { ...options, evDeployedSource: 'api-rejoiners' })
  assert.deepEqual(combined.totals, { totalDeployed: 3, evDeployed: 2, icDeployed: 1, returnCount: 1, netAddon: 2 })
  assert.equal(combined.evDeployedSource, 'api-rejoiners')
  assert.deepEqual(combined.details.evRows.map((row) => row.reason).sort(), ['NEW_RIDER', 'RE_JOINER'])
  assert.equal(combined.clients.length, 1)
  const original = summaryLib.buildEv91ClientWiseSummary(events, orders, options)
  assert.equal(original.totals.evDeployed, 1)
  assert.equal(original.totals.returnCount, combined.totals.returnCount)
  const overall = summaryLib.buildEv91ClientWiseSummary(events, orders, { ...options, evDeployedSource: 'overall' })
  assert.equal(overall.totals.evDeployed, 3)
  assert.equal(overall.totals.returnCount, 2)
  const order = summaryLib.buildEv91ClientWiseSummary(events, orders, { ...options, evDeployedSource: 'order' })
  assert.equal(order.totals.evDeployed, 1)
  assert.equal(order.totals.returnCount, 2)
  const aliasCity = summaryLib.buildEv91ClientWiseSummary(events, [], { ...options, city: 'Bengaluru', evDeployedSource: 'api-rejoiners' })
  assert.equal(aliasCity.totals.evDeployed, 1)
  assert.equal(aliasCity.clients[0].client, 'Zepto')
  const details = summaryLib.buildEv91SummaryRawDetails(events, orders, { ...options, evDeployedSource: 'api-rejoiners' })
  assert.deepEqual(details, combined.details)
  for (const reason of ['RE_JOINER', ' re-joiner ', 'Re   Joiner']) {
    assert.equal(summaryLib.isEv91ApiEvDeployReason(reason), false)
    assert.equal(summaryLib.isEv91ApiEvDeployReason(reason, { includeRejoiners: true }), true)
  }
  for (const reason of ['', 'Shifting', 'RE_JOINER_OTHER']) {
    assert.equal(summaryLib.isEv91ApiEvDeployReason(reason, { includeRejoiners: true }), false)
  }
})

test('inventory RTD uses nested hub cities, normalizes aliases and counts unique available vehicles', () => {
  const counts = operational.buildVehicleInventoryOperationalStatusCounts([
    vehicle('1', 'Available', 'BLR'), vehicle('1', 'Available', 'Bangalore'),
    vehicle('2', 'Available - Without(Battery & Charger)', 'Bengaluru'),
    vehicle('3', 'Not Available', 'Bengaluru'), vehicle('4', 'UnAvailable', 'Bengaluru'),
    vehicle('5', 'Assigned', 'Bengaluru'), vehicle('6', 'Available', 'CHN'),
    { id: '7', operationalStatus: 'Available', hub: { city: { name: 'Chennai' } } },
    { id: '7', operationalStatus: 'Available', hub: { city: { name: 'Chennai' } } },
  ])
  assert.equal(operational.getCityRtdAvailableCount(counts, 'All'), 3)
  assert.equal(operational.getCityRtdAvailableCount(counts, 'Bengaluru'), 1)
  assert.equal(operational.getCityRtdAvailableCount(counts, 'Chennai'), 2)
  assert.equal(operational.getCityRtdAvailableCount(counts, 'Mumbai'), 0)
})

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  }
  assert.ok(predicate(), 'Summary did not finish rendering')
}

test('summary loads every EV91 Vehicles page, filters cities and refreshes RTD without Current Status', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  let failInventory = false, refreshed = false, currentCalls = 0
  const inventoryPages = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    const text = String(url)
    if (text.includes('/api/ev91-vehicles')) {
      const page = Number(new URL(text, 'http://localhost').searchParams.get('page'))
      inventoryPages.push(page)
      if (failInventory) return Response.json({ success: false, message: 'Inventory unavailable' }, { status: 502 })
      return Response.json({ success: true, vehicles: page === 1
        ? [vehicle('1', refreshed ? 'Maintenance' : 'Available'), vehicle('2', 'Available - Without(Battery)'), vehicle('3', 'Assigned')]
        : [vehicle('4', 'Available', 'Hyderabad'), vehicle('5', 'Not Available', 'Hyderabad')],
      pagination: { totalPages: 2, totalItems: 5, hasNextPage: page < 2 } })
    }
    if (text.includes('current-status')) currentCalls++
    return Response.json({ success: true, data: text.includes('overall-status') ? [{
      vehicleNumber: 'TN-OLD', vehicleStatus: 'Deployed', statusDate: '2026-01-01',
      clientId: 'FE12345', clientName: 'Blinkit', cityName: 'Chennai',
    }] : [], pagination: { hasMore: false } })
  })
  await act(async () => root.render(createElement(Summary)))
  const total = () => [...container.querySelectorAll('.fdv-summary-meta span')]
    .find((node) => node.textContent.includes('RTD (Available)'))?.querySelector('strong')?.textContent
  await waitFor(() => total() === '2')
  assert.deepEqual(inventoryPages, [1, 2])
  assert.equal(currentCalls, 0)
  const citySelect = container.querySelector('.fdv-summary-filters select')
  assert.ok([...citySelect.options].some((option) => option.value === 'Hyderabad'), 'Inventory-only cities must be selectable')
  await act(async () => { citySelect.value = 'Hyderabad'; citySelect.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.equal(total(), '1')
  assert.match(container.querySelector('.fdv-summary-rtd-cities').textContent, /Hyderabad: 1/)
  await act(async () => { citySelect.value = 'All'; citySelect.dispatchEvent(new Event('change', { bubbles: true })) })
  const refresh = () => [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Refresh EV91')).click()
  failInventory = true
  await act(async () => refresh())
  await waitFor(() => total() === 'Unavailable')
  assert.match(container.querySelector('[role="alert"]').textContent, /Inventory unavailable/)
  assert.equal(container.querySelector('.fdv-summary-rtd-cities'), null)
  failInventory = false; refreshed = true
  await act(async () => refresh())
  await waitFor(() => total() === '1')
  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.deepEqual(inventoryPages, [1, 2, 1, 1, 2])
  assert.equal(currentCalls, 0)
})

test('combined option updates the summary, audit rows, summary CSV and all-cities Excel', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  const range = summaryLib.weekKeyToEv91SummaryDateRange(targetsLib.dateToWeekKey(new Date()))
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('/api/ev91-vehicles')
    ? Response.json({ success: true, vehicles: [vehicle('test')], pagination: { totalPages: 1, hasNextPage: false } })
    : Response.json({ success: true, data: deploymentEvents(range.startDate), pagination: { hasMore: false } }))
  const csvBlobs = []
  t.mock.method(URL, 'createObjectURL', (blob) => { csvBlobs.push(blob); return 'blob:summary-test' })
  t.mock.method(URL, 'revokeObjectURL', () => {})
  t.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', () => {})
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.includes(text))
  const total = (metric) => [...container.querySelectorAll('tbody tr')]
    .find((row) => row.querySelector('td')?.textContent === metric)?.querySelector('.fdv-pivot-total-col')?.textContent
  await act(async () => root.render(createElement(Summary)))
  await waitFor(() => !!button('Refresh EV91'))
  // Refresh bypasses any Overall Status cache populated by the inventory test.
  await act(async () => button('Refresh EV91').click())
  await waitFor(() => total('Ev Deployed') === '1')
  const combined = container.querySelector('input[value="api-rejoiners"]')
  assert.ok(combined)
  assert.equal(container.querySelector('input[value="api"]').checked, true)
  await act(async () => combined.click())
  assert.equal(combined.checked, true)
  assert.equal(total('Ev Deployed'), '3')
  assert.equal(total('Total Deployed'), '3')
  assert.equal(total('Return'), '1')
  assert.equal(total('Net add on'), '2')
  assert.match(container.querySelector('.fdv-summary-subtitle').textContent, /Reason NEW_RIDER \+ RE_JOINER/)

  await act(async () => button('Raw data').click())
  assert.match(container.querySelector('.ev91-raw-preview').textContent, /RE_JOINER/)
  assert.equal(container.querySelectorAll('.ev91-raw-preview tbody tr').length, 3)
  await act(async () => button('Export raw CSV').click())
  assert.match(await csvBlobs.at(-1).text(), /"RE_JOINER"/)
  await act(async () => button('Export Summary').click())
  const summaryCsv = await csvBlobs.at(-1).text()
  assert.match(summaryCsv, /"Ev Deployed","2","1","3"/)

  await act(async () => button('Export All Cities').click())
  const workbook = globalThis.__summaryWorkbook
  assert.ok(workbook)
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets['All Cities'], { header: 1 })
  const cityCount = (city) => matrix.find((row) => row[0] === 'Ev Deployed' && row[1] === city)?.at(-1)
  assert.equal(cityCount('Chennai'), 2)
  assert.equal(cityCount('Bengaluru'), 1)

  const citySelect = container.querySelector('.fdv-summary-filters select')
  await act(async () => { citySelect.value = 'Chennai'; citySelect.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.equal(total('Ev Deployed'), '2')
  assert.equal(container.querySelectorAll('.ev91-raw-preview tbody tr').length, 2)
  await act(async () => container.querySelector('input[value="api"]').click())
  assert.equal(total('Ev Deployed'), '1')
  assert.equal(container.querySelectorAll('.ev91-raw-preview tbody tr').length, 1)
})
