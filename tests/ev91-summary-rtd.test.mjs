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
    if (id.replaceAll('\\', '/').endsWith('/src/lib/sourceMasterDb.js')) return `
      export const fetchSourceMaster = async (options) => {
        globalThis.__summarySourceOptions = options;
        if (globalThis.__summarySourceError) throw globalThis.__summarySourceError;
        return globalThis.__summarySources || [];
      };
    `
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
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', '__summaryXlsxUtils', '__summaryWorkbook', '__summarySources', '__summarySourceOptions', '__summarySourceError']) delete globalThis[key]
})
const operational = await server.ssrLoadModule('/src/lib/ev91OperationalSummary.js')
const summaryLib = await server.ssrLoadModule('/src/lib/ev91DeployReturnSummary.js')
const sourceLib = await server.ssrLoadModule('/src/lib/onboardingSourceLookup.js')
const sourceMasterLib = await server.ssrLoadModule('/src/lib/sourceMaster.js')
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

test('audit source names match rider IDs and phones, fall back to row sources and preserve counts', () => {
  const onboardingSourceIndex = sourceLib.buildOnboardingSourceLookupIndex([
    { merge: 'voiceFE123456', source_name: 'Alpha Team' },
    { rider_id_details: 'CHE-26-R002008', source_name: 'Beta Team' },
    { rider_mobile_number: '9876543210', source_name: 'Phone Team' },
    { rider_id: 'IC1', source_name: 'IC Team' },
  ])
  const options = { startDate: '2026-10-25', endDate: '2026-10-31', evDeployedSource: 'overall' }
  const event = (id, extra = {}) => ({ vehicleNumber: `TN-${id}`, vehicleStatus: 'Deployed',
    statusDate: '2026-10-26', cityName: 'Chennai', clientName: 'Blinkit', clientId: id, ...extra })
  const events = [event('123456.0', { source: 'API fallback' }),
    event('other', { ev91RiderId: 'CHE_26_R002008' }),
    event('return', { vehicleStatus: 'Returned', riderContact: '+91 98765 43210' }),
    event('fallback', { sourceName: '-', source_name: 'Raw source' }),
    event('missing', { source: 'Unknown', riderName: 'Alpha Team' })]
  const orders = [{ worker_code: 'IC1', date_record: '2026-10-26', city: 'Chennai', client: 'Blinkit', type1: 'NON-EV' },
    { worker_code: 'EV1', mob_number: '9876543210', date_record: '2026-10-26', city: 'Chennai', client: 'Blinkit', type1: 'EV' }]
  const summary = summaryLib.buildEv91ClientWiseSummary(events, orders, options)
  const enriched = summaryLib.buildEv91ClientWiseSummary(events, orders, { ...options, includeDetails: true, onboardingSourceIndex })
  assert.deepEqual(enriched.totals, summary.totals)
  const sources = new Map(enriched.details.evRows.map((row) => [row.riderId, row.sourceName]))
  assert.equal(sources.get('123456.0'), 'Alpha Team')
  assert.equal(sources.get('other'), 'Beta Team')
  assert.equal(sources.get('fallback'), 'Raw source')
  assert.equal(sources.get('missing'), '')
  assert.equal(enriched.details.returnRows[0].sourceName, 'Phone Team')
  assert.equal(enriched.details.icRows[0].sourceName, 'Ic Team')
  assert.equal(enriched.details.icRows[0].source, 'order_upload')
  const orderDetails = summaryLib.buildEv91SummaryRawDetails(events, summaryLib.buildFirstOrderIndex(orders), {
    ...options, evDeployedSource: 'order', onboardingSourceIndex,
  })
  assert.equal(orderDetails.evRows[0].sourceName, 'Phone Team')
  assert.equal(orderDetails.evRows[0].source, 'order_upload')
})

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  }
  assert.ok(predicate(), 'Summary did not finish rendering')
}

test('raw email sources resolve from Source List across all kinds without changing audit counts', () => {
  const sourceMasterEmailIndex = sourceMasterLib.buildSourceMasterEmailIndex([
    { city: 'CHN', email_id: 'team@example.com', source_name: 'Chennai Source', is_active: false },
    { city: 'Bangalore', email_id: 'team@example.com', source_name: 'Bangalore Source', is_active: true },
  ])
  const event = { vehicleNumber: 'TN-1', vehicleStatus: 'Deployed', statusDate: '2026-10-26',
    cityName: 'Chennai', clientName: 'Blinkit', clientId: 'R1', reason: 'NEW_RIDER', source: ' TEAM@Example.com ' }
  const events = [event, { ...event, vehicleStatus: 'Returned', reason: 'Exiting' }]
  const orders = ['EV', 'NON-EV'].map((type1) => ({ worker_code: type1, type1, date_record: '2026-10-26',
    city: 'Chennai', client: 'Blinkit', source_name: 'team@example.com' }))
  const options = { startDate: '2026-10-25', endDate: '2026-10-31', sourceMasterEmailIndex }
  for (const evDeployedSource of ['api', 'api-rejoiners', 'overall', 'order']) {
    const plain = summaryLib.buildEv91SummaryRawDetails(events, orders, { ...options, evDeployedSource, sourceMasterEmailIndex: null })
    const details = summaryLib.buildEv91SummaryRawDetails(events, orders, { ...options, evDeployedSource })
    for (const kind of ['evRows', 'icRows', 'returnRows']) {
      assert.equal(details[kind].length, plain[kind].length)
      assert.ok(details[kind].length > 0)
      assert.ok(details[kind].every((row) => row.sourceName === 'Chennai Source'))
    }
  }
})

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
  await waitFor(() => total('Ev Deployed') === '3')
  assert.equal(container.querySelector('input[value="api-rejoiners"]').checked, true)
  await act(async () => container.querySelector('input[value="api"]').click())
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
  const breakdown = () => container.querySelector('.ev91-raw-reason-counts')?.textContent
  assert.match(breakdown(), /NEW_RIDER: 1 · RE_JOINER: 2/)
  const rawClientSelect = container.querySelectorAll('.ev91-raw-preview select')[1]
  await act(async () => { rawClientSelect.value = 'Zepto'; rawClientSelect.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.match(breakdown(), /NEW_RIDER: 0 · RE_JOINER: 1/)
  await act(async () => { rawClientSelect.value = 'All'; rawClientSelect.dispatchEvent(new Event('change', { bubbles: true })) })
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
  assert.match(breakdown(), /NEW_RIDER: 1 · RE_JOINER: 1/)
  await act(async () => container.querySelector('input[value="api"]').click())
  assert.equal(total('Ev Deployed'), '1')
  assert.equal(container.querySelectorAll('.ev91-raw-preview tbody tr').length, 1)
  assert.match(breakdown(), /NEW_RIDER: 1 · RE_JOINER: 0/)
  const rawTypeSelect = container.querySelector('.ev91-raw-preview select')
  await act(async () => { rawTypeSelect.value = 'Return'; rawTypeSelect.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.equal(breakdown(), undefined)
})

test('raw tables and CSV resolve onboarding email sources from Source List for EV, Return, IC and order EV', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  globalThis.__summarySources = [
    { city: 'Chennai', email_id: 'api@example.com', source_name: 'API Listed Team', is_active: true },
    { city: 'Chennai', email_id: 'return@example.com', source_name: 'Return Listed Team', is_active: false },
    { city: 'Chennai', email_id: 'ic@example.com', source_name: 'Referral, "Team"', is_active: true },
    { city: 'Chennai', email_id: 'order@example.com', source_name: 'Order Listed Team', is_active: true },
  ]
  t.after(() => { delete globalThis.__summarySources; delete globalThis.__summarySourceError })
  const range = summaryLib.weekKeyToEv91SummaryDateRange(targetsLib.dateToWeekKey(new Date()))
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('/api/ev91-vehicles')
    ? Response.json({ success: true, vehicles: [], pagination: { totalPages: 1, hasNextPage: false } })
    : Response.json({ success: true, data: deploymentEvents(range.startDate), pagination: { hasMore: false } }))
  const csvBlobs = []
  t.mock.method(URL, 'createObjectURL', (blob) => { csvBlobs.push(blob); return 'blob:source-test' })
  t.mock.method(URL, 'revokeObjectURL', () => {})
  t.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', () => {})
  const props = { onboardingData: [
    { rider_id: 'R1', source_name: ' API@Example.com ' },
    { rider_id: 'R4', source_name: 'return@example.com' },
    { worker_code: 'IC1', source_name: 'ic@example.com' },
    { worker_code: 'EV1', source_name: 'order@example.com' },
  ], riderData: [
    { worker_code: 'IC1', date_record: range.startDate, city: 'Chennai', client: 'Blinkit', type1: 'NON-EV', _data_source: 'order_upload' },
    { worker_code: 'EV1', date_record: range.startDate, city: 'Chennai', client: 'Blinkit', type1: 'EV', _data_source: 'order_upload' },
  ] }
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.includes(text))
  await act(async () => root.render(createElement(Summary, props)))
  await waitFor(() => !!button('Refresh EV91'))
  await act(async () => button('Refresh EV91').click())
  await act(async () => button('Raw data').click())
  const preview = () => container.querySelector('.ev91-raw-preview')
  const checkSource = async (source) => {
    assert.ok([...preview().querySelectorAll('th')].some((node) => node.textContent === 'Source Name'))
    assert.ok([...preview().querySelectorAll('tbody td')].some((node) => node.textContent === source))
    await act(async () => button('Export raw CSV').click())
    const csv = XLSX.utils.sheet_to_json(XLSX.read(await csvBlobs.at(-1).text(), { type: 'string' }).Sheets.Sheet1)
    assert.ok(csv.some((row) => row['Source Name'] === source))
  }
  const selectKind = async (kind) => act(async () => {
    const select = preview().querySelector('select')
    select.value = kind
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  assert.deepEqual(globalThis.__summarySourceOptions, { includeInactive: true })
  await checkSource('API Listed Team')
  globalThis.__summarySources = globalThis.__summarySources.map((row) => ({ ...row,
    source_name: row.email_id === 'api@example.com' ? 'Renamed Listed Team' : row.source_name,
  }))
  await act(async () => button('Refresh EV91').click())
  await checkSource('Renamed Listed Team')
  await act(async () => root.render(createElement(Summary, { ...props,
    onboardingData: [{ rider_id: 'R1', source_name: 'Updated Team' }, ...props.onboardingData.slice(1)],
  })))
  await checkSource('Updated Team')
  await selectKind('Return')
  await checkSource('Return Listed Team')
  await selectKind('IC')
  await checkSource('Referral, "Team"')
  assert.match(preview().textContent, /order_upload/)
  await selectKind('EV')
  await act(async () => container.querySelector('input[value="order"]').click())
  await checkSource('Order Listed Team')
  globalThis.__summarySourceError = new Error('Source List unavailable')
  await act(async () => button('Refresh EV91').click())
  await checkSource('Order@example.com')
  assert.match(preview().querySelector('[role="alert"]').textContent, /Source List unavailable/)
})
