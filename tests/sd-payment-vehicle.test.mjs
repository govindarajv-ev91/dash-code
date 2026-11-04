import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

const riderId = 'MYS-26-R000206'
const clientId = '1065830'
const registration = 'KA09JV8699'
const overall = [{ ev91RiderId: riderId, clientId, vehicleNumber: registration,
  vehicleStatus: 'Deployed', statusDate: '2026-10-08T12:00:00.000Z' }]
const mapping = [{ ev91RiderId: riderId, clientId, lastUpdated: '2026-10-08' }]
const ev91Sd = [{ id: 1, public_rider_id: riderId, client_rider_id: clientId, total_sd: 1000 }]
const payments = [{ id: 1, rider_id: riderId, rider_name: 'Test rider', month: 'Oct-2026', week: '4126', sd: 250, ev_rent: 500 }]
globalThis.__sdVehicleFixture = { payments, collation: [], fleet: [], overall, mapping, ev91Sd }
globalThis.__sdVehicleLoad = async (source, options = {}) => {
  const fixture = globalThis.__sdVehicleFixture
  ;(fixture.sourceCalls ||= []).push({ source, force: Boolean(options.force) })
  ;(fixture.progressHandlers ||= {})[source] = options.onProgress
  if (fixture[`${source}Pending`]) return fixture[`${source}Pending`]
  if (fixture[`${source}Error`]) throw new Error(`${source} service unavailable`)
  return fixture[source]
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  ssr: { noExternal: ['xlsx'] },
  cacheDir: 'node_modules/.vite-tests/sd-payment-vehicle',
  server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'sd-vehicle-fixtures', enforce: 'pre',
    resolveId(id) { if (id === 'xlsx') return '\0sd-vehicle-xlsx' },
    load(id) {
      if (id === '\0sd-vehicle-xlsx') return `export const utils = {
        book_new: () => ({}), json_to_sheet: (rows) => rows,
        book_append_sheet: (book, rows, name) => { book[name] = rows },
      }; export const writeFile = (book) => { globalThis.__sdVehicleExport = book }`
    },
    transform(code, id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = {}'
      if (path.endsWith('/src/lib/riderPaymentDb.js')) return 'export const fetchRiderPaymentsForSdRent = (options) => globalThis.__sdVehicleLoad("payments", options)'
      if (path.endsWith('/src/lib/manualCollationDb.js')) return 'export const fetchManualCollationForSdRent = (options) => globalThis.__sdVehicleLoad("collation", options)'
      if (path.endsWith('/src/lib/fleetSdFetch.js')) return 'export const fetchFleetSdRows = (options) => globalThis.__sdVehicleLoad("fleet", options)'
      if (path.endsWith('/src/lib/ev91SdDb.js')) return `${code}\nfetchAllEv91Sd = async () => globalThis.__sdVehicleFixture.ev91Sd;`
      if (path.endsWith('/src/lib/ev91SdWalletApi.js')) return `
        export const getCachedEv91SdWallet = () => null;
        export const fetchEv91SdWallet = async ({ force } = {}) => {
          const fixture = globalThis.__sdVehicleFixture;
          (fixture.walletCalls ||= []).push(force);
          if (fixture.walletPending) return fixture.walletPending;
          if (fixture.walletError) throw new Error('Wallet service unavailable');
          return { rows: fixture.walletRows || fixture.ev91Sd, loadedAt: 1792700000000 };
        };
      `
      if (path.endsWith('/src/lib/ev91EvLookup.js')) return `${code}\nfetchEv91OverallStatusAll = async (options) => ({ data: await globalThis.__sdVehicleLoad("overall", options) });`
      if (path.endsWith('/src/lib/ev91OnboardingPending.js')) return `${code}\nfetchEv91ClientMappingAll = async (options) => ({ data: await globalThis.__sdVehicleLoad("mapping", options) });`
    },
  }],
})
const { buildSdPaymentReport, buildEvRentMonthReport, filterSdRows } = await server.ssrLoadModule('/src/lib/sdPaymentReport.js')
const { buildEv91PublicRiderIndex } = await server.ssrLoadModule('/src/lib/ev91OnboardingPending.js')
const { default: Viewer } = await server.ssrLoadModule('/src/SdPaymentViewer.jsx')
const publicIndex = buildEv91PublicRiderIndex(overall, mapping)

beforeEach(() => {
  globalThis.__sdVehicleFixture = { payments, collation: [], fleet: [], overall, mapping, ev91Sd }
  delete globalThis.__sdVehicleExport
})
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__sdVehicleFixture', '__sdVehicleExport', '__sdVehicleLoad']) delete globalThis[key]
})

const buttonIn = (container, text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
const statValues = (container) => [...container.querySelectorAll('.rp-stat-value')].map((node) => node.textContent)
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
async function mountViewer(t) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(Viewer)))
  return container
}

test('payment progress shows completed record count without exposing partial totals', async (t) => {
  const pending = deferred()
  const fixture = globalThis.__sdVehicleFixture
  fixture.paymentsPending = pending.promise
  const container = await mountViewer(t)
  await act(async () => fixture.progressHandlers.payments({ loadedRows: 25000, estimatedRows: 196747, complete: false }))
  assert.match(container.querySelector('[aria-label="Report data status"]').textContent, /Payment history: 25,000 records loaded/)
  assert.ok(statValues(container).every((value) => value === '—'))
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
  await act(async () => pending.resolve(payments))
  assert.match(container.querySelector('[aria-label="Report data status"]').textContent, /Payment history: 1 records/)
  assert.equal(buttonIn(container, 'Export Excel').disabled, false)
})
async function exportCurrent(container) {
  delete globalThis.__sdVehicleExport
  await act(async () => {
    buttonIn(container, 'Export Excel').click()
    for (let attempt = 0; attempt < 100 && !globalThis.__sdVehicleExport; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  })
  assert.ok(globalThis.__sdVehicleExport, 'dynamic Excel module exports the report')
  return Object.values(globalThis.__sdVehicleExport).flat()
}

test('EV91-only SD records resolve a vehicle through public and client rider IDs', () => {
  const report = buildSdPaymentReport([], [], [], ev91Sd, publicIndex, overall)
  assert.equal(report.rows.length, 1)
  assert.equal(filterSdRows(report.rows, { search: riderId })[0].vehicleNumber, registration)
  assert.equal(report.rows[0].ev91TotalSd, 1000)
  assert.equal(report.rows[0].fleetSdPaid, 0)
})

test('client mapping links payment and manual riders to EV91 vehicle history', () => {
  const history = overall.map((row) => ({ ...row, clientId: '' }))
  const clientPayments = payments.map((row) => ({ ...row, rider_id: clientId }))
  const manual = [{ id: 2, rider_id: clientId, purpose: 'EV Rent', deposits: 200 }]
  const sd = buildSdPaymentReport(clientPayments, [], [], [], publicIndex, history).rows[0]
  assert.equal(sd.vehicleNumber, registration)
  assert.equal(sd.paymentSdDeductionTotal, 250)
  const rent = buildEvRentMonthReport(clientPayments, manual, [], history, publicIndex)
  assert.ok(rent.every((row) => row.vehicleNumber === registration))
  assert.equal(rent.reduce((sum, row) => sum + row.totalEvRent, 0), 700)
})

test('latest known vehicle survives missing values and SD-free returns without altering SD totals', () => {
  const fleet = [
    { rider_id: riderId, vehicle_number: 'KA-OLD', vehicle_status: 'Deployee', date_record: '2026-09-01', security_deposit_paid_deployee: 500 },
    { rider_id: riderId, vehicle_number: 'KA-NEW', vehicle_status: 'Return', date_record: '2026-10-10' },
    { rider_id: riderId, vehicle_number: '', vehicle_status: 'Deployee', date_record: '2026-10-11' },
  ]
  const sd = buildSdPaymentReport(payments, [], fleet, [], publicIndex, overall).rows[0]
  assert.equal(sd.vehicleNumber, 'KA-NEW')
  assert.equal(sd.fleetSdPaid, 0)
  assert.equal(sd.paymentSdDeductionTotal, 250)
  const rent = buildEvRentMonthReport([{ ...payments[0], vehicle_number: 'KA-PAYMENT' }], [], fleet, overall, publicIndex)
  assert.equal(rent[0].vehicleNumber, 'KA-PAYMENT', 'an explicit payment vehicle remains attached to its payment')
})

test('newer EV91 events win; missing history never invents a vehicle', () => {
  const history = [
    { ...overall[0], vehicleNumber: '', statusDate: '2026-10-12' },
    { ...overall[0], vehicleNumber: 'KA-NEW', statusDate: '2026-10-10' },
    overall[0],
    { ...overall[0], ev91RiderId: 'MYS-26-R000207', clientId: 'OTHER', vehicleNumber: 'KA-OTHER', statusDate: '2026-10-15' },
  ]
  assert.equal(buildSdPaymentReport(payments, [], [], [], publicIndex, history).rows[0].vehicleNumber, 'KA-NEW')
  assert.equal(buildSdPaymentReport(payments).rows[0].vehicleNumber, '')
  assert.equal(buildSdPaymentReport([{ ...payments[0], vehicle_number: 'KA-PAYMENT' }]).rows[0].vehicleNumber, 'KA-PAYMENT')
})

test('searching the SD page displays the vehicle and both tab exports include it', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(Viewer)))
  const search = container.querySelector('input[type="text"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, riderId)
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  const vehicleCells = () => [...container.querySelectorAll('tbody tr')].map((row) => row.querySelectorAll('td')[5]?.textContent)
  for (const tab of ['SD Payment', 'EV Rent']) {
    await act(async () => button(tab).click())
    assert.deepEqual(vehicleCells(), [registration])
    const exported = await exportCurrent(container)
    assert.equal(exported.length, 1)
    assert.equal(exported[0].Vehicle, registration)
  }
})

test('ID-less wallet rows match public/client aliases once and retain API-only riders', () => {
  const wallet = { public_rider_id: riderId, client_rider_id: 'CURRENT-CLIENT',
    total_sd: 4321, pending_sd: 123, fixed_deposit: 500 }
  const walletOnly = { public_rider_id: 'MYS-26-R000207', client_rider_id: 'WALLET-ONLY',
    total_sd: 987, pending_sd: 0, fixed_deposit: 100 }
  const aliases = buildEv91PublicRiderIndex([], [{ ev91RiderId: riderId, clientId: 'OLD-CLIENT' }])
  const report = buildSdPaymentReport([{ ...payments[0], rider_id: 'OLD-CLIENT' }], [], [],
    [wallet, walletOnly], aliases, overall)
  assert.equal(report.rows.length, 2, 'matched wallet does not create a second API-only row')
  const matched = report.rows.find((row) => row.ev91PublicRiderId === riderId)
  assert.deepEqual([matched.ev91TotalSd, matched.ev91PendingSd, matched.ev91FixedDeposit], [4321, 123, 500])
  assert.equal(matched.paymentSdDeductionTotal, 250)
  assert.equal(report.rows.find((row) => row.riderId === 'WALLET-ONLY').ev91TotalSd, 987)
})

test('SD columns, cards and Excel use wallet balances; refresh keeps rows and updates all three amounts', async (t) => {
  const fixture = globalThis.__sdVehicleFixture
  fixture.walletRows = [{ public_rider_id: riderId, client_rider_id: clientId,
    total_sd: 4321, pending_sd: 123, fixed_deposit: 500 }]
  fixture.walletCalls = []
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount()); container.remove()
    delete fixture.walletRows; delete fixture.walletPending; delete fixture.walletError
  })
  await act(async () => root.render(createElement(Viewer)))
  const balances = () => [...container.querySelectorAll('tbody tr:first-child td')].slice(11, 14).map((cell) => cell.textContent)
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  assert.deepEqual(balances(), ['₹4,321', '₹123', '₹500'])
  assert.match(container.querySelector('.rp-stats-grid').textContent, /EV91 Total SD₹4,321/)
  const [exported] = await exportCurrent(container)
  assert.deepEqual([exported['EV91 TotalSd'], exported['EV91 PendingSd'], exported['EV91 FixedDeposit']], [4321, 123, 500])
  let release
  fixture.walletPending = new Promise((resolve) => { release = resolve })
  await act(async () => button('Refresh EV91 SD').click())
  assert.deepEqual(balances(), ['₹4,321', '₹123', '₹500'])
  assert.ok([...container.querySelectorAll('[role="status"]')].some((node) => /Refreshing EV91 SD wallet/.test(node.textContent)))
  await act(async () => release({ rows: [{ ...fixture.walletRows[0], total_sd: 5000, pending_sd: 0, fixed_deposit: 750 }], loadedAt: 1792700100000 }))
  assert.deepEqual(balances(), ['₹5,000', '₹0', '₹750'])
  assert.deepEqual(fixture.walletCalls, [false, true])
  delete fixture.walletPending
  fixture.walletError = true
  await act(async () => button('Refresh EV91 SD').click())
  assert.deepEqual(balances(), ['₹5,000', '₹0', '₹750'])
  assert.match(container.querySelector('[role="alert"]').textContent, /last successfully loaded wallet balances/)
})

test('failed initial wallet load shows unavailable balances instead of zeros, permits EV Rent, and retries', async (t) => {
  const fixture = globalThis.__sdVehicleFixture
  fixture.walletError = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount()); container.remove()
    delete fixture.walletError
  })
  await act(async () => root.render(createElement(Viewer)))
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  assert.match(container.querySelector('[role="alert"]').textContent, /EV91 balances are unavailable/)
  assert.deepEqual([...container.querySelectorAll('tbody tr:first-child td')].slice(11, 14).map((cell) => cell.textContent), ['—', '—', '—'])
  assert.equal(button('Export Excel').disabled, true)
  await act(async () => button('EV Rent').click())
  assert.equal(button('Export Excel').disabled, false)
  await act(async () => button('SD Payment').click())
  fixture.walletError = false
  await act(async () => button('Refresh EV91 SD').click())
  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.equal(button('Export Excel').disabled, false)
})

test('page heading and both tabs appear immediately while every source is still pending', async (t) => {
  const fixture = globalThis.__sdVehicleFixture
  for (const source of ['payments', 'collation', 'overall', 'mapping', 'fleet', 'wallet']) {
    fixture[`${source}Pending`] = new Promise(() => {})
  }
  const container = await mountViewer(t)
  assert.equal(container.querySelector('h1')?.textContent, 'SD & EV Rent')
  assert.ok(buttonIn(container, 'SD Payment'))
  assert.ok(buttonIn(container, 'EV Rent'))
  assert.equal(buttonIn(container, 'Refresh report').disabled, true)
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
  assert.equal(statValues(container).length, 7)
  assert.ok(statValues(container).every((value) => value === '—'))
  assert.doesNotMatch(container.textContent, /Upload payment.*manual collation/)
  assert.match(container.querySelector('[aria-label="Report data status"]').textContent, /Payment history: Loading/)
  await act(async () => buttonIn(container, 'EV Rent').click())
  assert.equal(statValues(container).length, 4)
  assert.ok(statValues(container).every((value) => value === '—'))
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
})

test('available payment records remain usable while rider mapping is pending, with totals/export withheld', async (t) => {
  const pending = deferred()
  globalThis.__sdVehicleFixture.mappingPending = pending.promise
  const container = await mountViewer(t)
  assert.match(container.querySelector('tbody').textContent, /Test rider/)
  assert.match(container.querySelector('tbody').textContent, /250/)
  assert.ok(statValues(container).every((value) => value === '—'))
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
  assert.match(container.querySelector('[aria-label="Report data status"]').textContent, /Rider mapping: Loading/)
  await act(async () => buttonIn(container, 'EV Rent').click())
  assert.match(container.querySelector('tbody').textContent, /Test rider/)
  assert.match(container.querySelector('tbody').textContent, /500/)
  assert.ok(statValues(container).every((value) => value === '—'))
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
  await act(async () => pending.resolve(mapping))
  assert.deepEqual(statValues(container), ['1', '1', '₹500', '₹0'])
  assert.equal(buttonIn(container, 'Export Excel').disabled, false)
  assert.equal(globalThis.__sdVehicleFixture.sourceCalls.length, 5)
})

test('an initial source failure displays an error and retry without false zeros or upload instructions', async (t) => {
  const fixture = globalThis.__sdVehicleFixture
  fixture.paymentsError = true
  fixture.walletCalls = []
  const container = await mountViewer(t)
  assert.match(container.querySelector('[role="alert"]').textContent, /Payment history: payments service unavailable/)
  assert.ok(buttonIn(container, 'Retry payment history'))
  assert.ok(statValues(container).every((value) => value === '—'))
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
  assert.doesNotMatch(container.textContent, /Upload payment.*manual collation/)
  assert.deepEqual([...container.querySelectorAll('tbody tr:first-child td')].slice(14, 18).map((node) => node.textContent),
    ['—', '—', '—', '—'], 'unavailable payment amounts never appear as zero')
  await act(async () => buttonIn(container, 'EV Rent').click())
  assert.ok(statValues(container).every((value) => value === '—'))
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
  const previousCalls = fixture.sourceCalls.slice()
  fixture.paymentsError = false
  await act(async () => buttonIn(container, 'Retry payment history').click())
  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.match(container.querySelector('tbody').textContent, /Test rider/)
  assert.deepEqual(statValues(container), ['1', '1', '₹500', '₹0'])
  assert.equal(buttonIn(container, 'Export Excel').disabled, false)
  assert.deepEqual(fixture.sourceCalls, [...previousCalls, { source: 'payments', force: true }])
  assert.deepEqual(fixture.walletCalls, [false])
})

test('report refresh preserves loaded rows, blocks stale export, and retries only its failed source', async (t) => {
  const fixture = globalThis.__sdVehicleFixture
  const container = await mountViewer(t)
  const pending = deferred()
  fixture.paymentsPending = pending.promise
  fixture.collationError = true
  await act(async () => buttonIn(container, 'Refresh report').click())
  assert.match(container.querySelector('tbody').textContent, /Test rider/)
  assert.match(container.querySelector('tbody').textContent, /250/)
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
  assert.ok(statValues(container).every((value) => value === '—'))
  assert.match(container.querySelector('[role="alert"]').textContent, /last successfully loaded records/)
  await act(async () => pending.resolve([{ ...payments[0], sd: 300 }]))
  assert.match(container.querySelector('tbody').textContent, /300/)
  assert.equal(buttonIn(container, 'Export Excel').disabled, true)
  assert.ok(statValues(container).every((value) => value === '—'))
  const previousCalls = fixture.sourceCalls.slice()
  fixture.collationError = false
  await act(async () => buttonIn(container, 'Retry manual collections').click())
  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.equal(buttonIn(container, 'Export Excel').disabled, false)
  assert.deepEqual(fixture.sourceCalls, [...previousCalls, { source: 'collation', force: true }])
  const [exported] = await exportCurrent(container)
  assert.equal(exported['Payment SD Ded. (Total)'], 300)
})
