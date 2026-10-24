import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__sourceSearchPayments = [
  { rider_id: 'A1', source_name: 'Alpha Team', gross_payout: 100 },
  { rider_id: 'A2', source_name: 'Alpha Team', gross_payout: 50 },
  { rider_id: 'B1', source_name: 'Beta Team', gross_payout: 200 },
].map((row, index) => ({ ...row, id: index + 1, week: '1526', month: 'Apr-2026', period_start: '2026-04-06',
  period_label: 'Week 15', city: 'Chennai', client_name: 'Blinkit' }))
globalThis.__sourceMasterRows = [
  { city: 'Chennai', source_name: 'Alpha Team', is_active: true },
  { city: 'Chennai', source_name: 'Beta Team', is_active: true },
]
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/client-period-source-search',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'source-search-payments', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/riderPaymentDb.js')) {
      return 'export const fetchRiderPaymentsForPeriod = async (params) => { globalThis.__sourcePaymentQuery = params; return globalThis.__sourceSearchPayments }'
    }
    if (id.replaceAll('\\', '/').endsWith('/src/lib/sourceMasterDb.js')) {
      return `export const fetchSourceMaster = async () => {
        if (globalThis.__sourceMasterPending) return globalThis.__sourceMasterPending;
        if (globalThis.__sourceMasterFailure) throw new Error('Unavailable');
        return globalThis.__sourceMasterRows;
      }`
    }
    if (id.replaceAll('\\', '/').endsWith('/src/lib/clientPeriodExcelExport.js')) {
      return 'export const downloadClientPeriodExcel = async (data) => { globalThis.__sourceExport = data }'
    }
  } }],
})
const { default: Trend } = await server.ssrLoadModule('/src/Ev91ClientPeriodTrend.jsx')
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__sourceSearchPayments', '__sourceMasterRows', '__sourceMasterFailure', '__sourceMasterPending', '__sourcePaymentQuery', '__sourceExport']) delete globalThis[key]
})

test('client revenue includes all sources while rider/source tables retain active-source visibility and exports retain everything', async (t) => {
  const previous = globalThis.__sourceSearchPayments
  const master = globalThis.__sourceMasterRows
  globalThis.__sourceMasterRows = [
    { city: 'Chennai', source_name: ' aLPHa  Team ', is_active: true },
    { city: 'Chennai', source_name: 'Beta Team', is_active: false },
    { city: 'Delhi', source_name: 'Wrong city', is_active: true },
  ]
  globalThis.__sourceSearchPayments = [...previous,
    { ...previous[0], id: 4, rider_id: 'C1', source_name: 'Unlisted', gross_payout: 400,
      period_start: '2026-04-13', period_label: 'Week 16', week: '1626' },
    { ...previous[0], id: 5, rider_id: 'D1', source_name: 'Wrong city', gross_payout: 500 },
    { ...previous[0], id: 6, rider_id: 'E1', source_name: '', gross_payout: 600 },
  ]
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount()); container.remove()
    globalThis.__sourceSearchPayments = previous
    globalThis.__sourceMasterRows = master
  })
  await act(async () => root.render(createElement(Trend)))
  const tables = () => [...container.querySelectorAll('section tbody')]
  for (const mode of ['weekly', 'monthly']) {
    await act(async () => container.querySelector(`input[value="${mode}"]`).click())
    const totals = tables().map((table, index) => table.querySelector(index < 2 ? 'tr th:last-child' : 'tr th:nth-child(2)')?.textContent)
    assert.deepEqual(totals, ['1,850', '2', '2', '150'])
    assert.doesNotMatch(tables()[2].textContent, /Beta Team|Unlisted|Wrong city|Unknown/)
    await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export').click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)))
    const exported = globalThis.__sourceExport
    assert.ok(exported, container.textContent)
    assert.equal(exported.rawRows.length, 6)
    const revenue = exported.summarySheets[0].rows.at(-1)
    assert.equal(revenue.Total, 1850)
    assert.equal(exported.summarySheets[1].rows.at(-1).Total, 6)
    const sourceRevenue = exported.summarySheets[3].rows
    for (const name of ['Alpha Team', 'Beta Team', 'Unlisted', 'Wrong city', 'Unknown']) {
      assert.ok(sourceRevenue.some((row) => row.Source === name), `${name} remains exported`)
    }
    if (mode === 'weekly') assert.deepEqual(exported.periods, ['Week 15', 'Week 16'])
  }
  // An intentionally empty list hides all displayed data, but export stays enabled.
  globalThis.__sourceMasterRows = []
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert.equal(tables()[0].querySelector('tr th:last-child').textContent, '1,850')
  assert.ok(tables().slice(1).every((table) => !table.querySelector('th')))
  const exportButton = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export')
  assert.equal(exportButton.disabled, false)
  await act(async () => exportButton.click())
  assert.equal(globalThis.__sourceExport.rawRows.length, 6)
  // Fetch failures never fall back to showing every source.
  globalThis.__sourceMasterFailure = true
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert.match(container.querySelector('[role="alert"]').textContent, /Unable to load the source list/)
  assert.equal(tables()[0].querySelector('tr th:last-child').textContent, '1,850')
  assert.ok(tables().slice(1).every((table) => !table.querySelector('th')))
  delete globalThis.__sourceMasterFailure
})

test('source searches filter their own table and totals, with separate clearing in weekly and monthly views', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(Trend)))
  const riderInput = container.querySelector('[aria-label="Search sources in rider count"]')
  const revenueInput = container.querySelector('[aria-label="Search sources in payout revenue"]')
  const riderTable = riderInput.closest('section').querySelector('tbody')
  const revenueTable = revenueInput.closest('section').querySelector('tbody')
  const sources = (table) => [...table.querySelectorAll('tr td:first-child')].map((cell) => cell.textContent)
  const total = (table) => table.querySelector('tr th:nth-child(2)')?.textContent
  const change = async (input, value) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.deepEqual(sources(riderTable), ['Alpha Team', 'Beta Team'])
  assert.equal(total(riderTable), '3')
  assert.equal(total(revenueTable), '350')
  await change(riderInput, ' ALP ')
  assert.deepEqual(sources(riderTable), ['Alpha Team'])
  assert.equal(total(riderTable), '2')
  assert.equal(sources(revenueTable).length, 2)
  assert.equal(total(revenueTable), '350')
  await change(revenueInput, 'bEt')
  assert.deepEqual(sources(revenueTable), ['Beta Team'])
  assert.equal(total(revenueTable), '200')
  assert.deepEqual(sources(riderTable), ['Alpha Team'])
  await change(riderInput, 'no-such-source')
  assert.match(riderTable.textContent, /No sources match your search/)
  assert.deepEqual(sources(revenueTable), ['Beta Team'])
  await act(async () => container.querySelector('[aria-label="Clear search sources in rider count"]').click())
  assert.equal(sources(riderTable).length, 2)
  assert.equal(revenueInput.value, 'bEt')
  await act(async () => container.querySelector('input[value="monthly"]').click())
  assert.equal(total(riderTable), '3')
  assert.deepEqual(sources(revenueTable), ['Beta Team'])
  assert.equal(total(revenueTable), '200')
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Clear Filters')).click())
  assert.equal(riderInput.value, '')
  assert.equal(revenueInput.value, '')
  assert.equal(sources(revenueTable).length, 2)
  assert.equal(total(revenueTable), '350')
})

test('table radio selection shows the chosen table and preserves each source search when switching', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(Trend)))
  const choose = async (value) => act(async () => container.querySelector(`input[name="trend-table"][value="${value}"]`).click())
  const headings = () => [...container.querySelectorAll('section h3')].map((node) => node.textContent)
  const search = async (label, value) => act(async () => {
    const input = container.querySelector(`[aria-label="${label}"]`)
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal(container.querySelectorAll('.data-table').length, 4)
  for (const [value, title] of [['client-revenue', /gross payout revenue/], ['client-riders', /client unique rider count/],
    ['source-riders', /source-wise rider count/], ['source-revenue', /source gross payout revenue/]]) {
    await choose(value)
    assert.equal(container.querySelectorAll('.data-table').length, 1)
    assert.match(headings()[0], title)
    assert.equal(document.querySelectorAll('.ev91-client-trend-sticky-header').length, 1)
    assert.equal(document.querySelectorAll('.ev91-client-trend-page-scrollbar').length, 1)
  }
  await search('Search sources in payout revenue', 'Beta')
  await choose('source-riders')
  await search('Search sources in rider count', 'Alpha')
  await choose('source-revenue')
  assert.equal(container.querySelector('[aria-label="Search sources in payout revenue"]').value, 'Beta')
  assert.doesNotMatch(container.querySelector('section tbody').textContent, /Alpha Team/)
  await act(async () => container.querySelector('input[value="monthly"]').click())
  assert.match(headings()[0], /Monthly source gross payout revenue/)
  assert.equal(container.querySelector('input[name="trend-table"]:checked').value, 'source-revenue')
  await choose('all')
  assert.equal(container.querySelectorAll('.data-table').length, 4)
  assert.equal(container.querySelector('[aria-label="Search sources in rider count"]').value, 'Alpha')
  assert.equal(container.querySelector('[aria-label="Search sources in payout revenue"]').value, 'Beta')
})

test('September client gross payout reconciles to all payments regardless of active sources', async (t) => {
  const previous = globalThis.__sourceSearchPayments
  const base = previous[0]
  globalThis.__sourceSearchPayments = [
    { ...base, id: 1, month: 'Sep-26', week: '3626', period_start: '2026-08-31', gross_payout: 52106581 },
    { ...base, id: 2, month: 'Sep-26', week: '3726', period_start: '2026-09-07',
      source_name: 'Unlisted', client_name: 'Other client', city: 'Delhi', gross_payout: 10267896 },
  ]
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount()); container.remove()
    globalThis.__sourceSearchPayments = previous
  })
  await act(async () => root.render(createElement(Trend)))
  await act(async () => container.querySelector('input[value="monthly"]').click())
  const change = async (selector, value) => act(async () => {
    const input = container.querySelector(selector)
    const prototype = input.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await change('input[type="date"]', '2026-09-01')
  const endInput = container.querySelectorAll('input[type="date"]')[1]
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(endInput, '2026-09-30')
    endInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal(globalThis.__sourcePaymentQuery.monthly, true)
  assert.equal(globalThis.__sourcePaymentQuery.fromDate, '2026-09-01')
  assert.equal(globalThis.__sourcePaymentQuery.toDate, '2026-09-30')
  const revenue = container.querySelector('section tbody')
  assert.equal(revenue.querySelector('tr th:nth-child(2)').textContent, '6,23,74,477')
  assert.match(revenue.textContent, /Other client/)
  assert.ok([...container.querySelectorAll('select')[0].options].some((option) => option.value === 'Delhi'))
  await change('select', 'Delhi')
  assert.equal(revenue.querySelector('tr th:nth-child(2)').textContent, '1,02,67,896')
})

test('monthly client and source rider counts deduplicate weeks in the tables and Excel export', async (t) => {
  const previous = globalThis.__sourceSearchPayments
  const payment = (id, rider, week, start, month, payout, overrides = {}) => ({
    id, rider_id: rider, rider_name: 'Same Name', source_name: 'Alpha Team', city: 'Chennai',
    client_name: 'Blinkit', week, period_start: start, month, gross_payout: payout,
    period_label: `Week ${Math.floor(Number(week) / 100)}`,
    rider_key: `${overrides.client_name || 'Blinkit'}|${week}|${rider}`, ...overrides,
  })
  globalThis.__sourceSearchPayments = [
    payment(1, 'A1', '1526', '2026-04-06', 'Apr-2026', 100),
    payment(2, 'A1', '1626', '2026-04-13', 'Apr-2026', 100),
    payment(3, 'A1', '1626', '2026-04-13', 'Apr-2026', 50),
    payment(4, 'A2', '1626', '2026-04-13', 'Apr-2026', 200),
    payment(5, 'A1', '1626', '2026-04-13', 'Apr-2026', 300, { client_name: 'Swiggy' }),
    payment(6, 'A1', '1826', '2026-05-04', 'May-2026', 400),
    payment(7, 'A1', '1926', '2026-05-11', 'May-2026', 500),
    payment(8, 'B1', '1626', '2026-04-13', 'Apr-2026', 100, { source_name: 'Beta Team' }),
  ]
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount()); container.remove()
    globalThis.__sourceSearchPayments = previous
  })
  await act(async () => root.render(createElement(Trend)))
  const tables = () => [...container.querySelectorAll('section tbody')]
  const rowValues = (table, name) => {
    const row = [...table.querySelectorAll('tr')].find((row) => row.firstElementChild.textContent === name)
    assert.ok(row, `Missing row: ${name}`)
    return [...row.children].slice(1).map((cell) => cell.textContent)
  }
  assert.deepEqual(rowValues(tables()[1], 'Blinkit'), ['1', '3', '1', '1', '6'])
  await act(async () => container.querySelector('input[value="monthly"]').click())
  assert.deepEqual(rowValues(tables()[1], 'Blinkit'), ['3', '1', '4'])
  assert.deepEqual(rowValues(tables()[1], 'Swiggy'), ['1', '0', '1'])
  assert.deepEqual(rowValues(tables()[2], 'Alpha Team'), ['2', '1'])
  assert.deepEqual(rowValues(tables()[2], 'Beta Team'), ['1', '0'])
  assert.deepEqual(rowValues(tables()[2], 'Total'), ['3', '1'])
  assert.deepEqual(rowValues(tables()[0], 'Total'), ['850', '900', '1,750'])
  assert.match(container.textContent, /Each rider once per client per month/)
  assert.match(container.textContent, /Each rider once per source per month/)

  delete globalThis.__sourceExport
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Export').click())
  for (let index = 0; index < 100 && !globalThis.__sourceExport; index++) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  }
  const exported = globalThis.__sourceExport
  assert.ok(exported, 'Excel export completed')
  assert.equal(exported.rawRows.length, 8, 'every payment remains in the raw export')
  assert.deepEqual(exported.periods, ['Apr 2026', 'May 2026'])
  assert.deepEqual(exported.summarySheets[1].rows.find((row) => row.Name === 'Blinkit'),
    { Name: 'Blinkit', 'Apr 2026': 3, 'May 2026': 1, Total: 4 })
  assert.deepEqual(exported.summarySheets[2].rows.find((row) => row.Source === 'Alpha Team'),
    { Source: 'Alpha Team', 'Apr 2026': 2, 'May 2026': 1 })
  assert.equal(exported.summarySheets[0].rows.at(-1).Total, 1750)

  // A client filter still limits the population before monthly deduplication.
  const client = container.querySelectorAll('select')[1]
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(client, 'Swiggy')
    client.dispatchEvent(new Event('change', { bubbles: true }))
  })
  assert.deepEqual(rowValues(tables()[1], 'Swiggy'), ['1', '1'])
  assert.deepEqual(rowValues(tables()[2], 'Alpha Team'), ['1'])
  assert.doesNotMatch(tables()[1].textContent, /Blinkit/)
})

test('returning focus keeps tables visible during refresh, then applies source changes', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => {
    delete globalThis.__sourceMasterPending
    await act(async () => root.unmount()); container.remove()
  })
  await act(async () => root.render(createElement(Trend)))
  const totals = () => [...container.querySelectorAll('section tbody')]
    .map((table) => table.querySelector('tr th:nth-child(2)')?.textContent)
  const before = totals()
  let release
  globalThis.__sourceMasterPending = new Promise((resolve) => { release = resolve })
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert.match(container.querySelector('[role="status"]').textContent, /Loading source list/)
  assert.deepEqual(totals(), before)
  await act(async () => root.render(null))
  await act(async () => root.render(createElement(Trend)))
  assert.deepEqual(totals(), before, 'returning to the page reuses the last successful source list')
  await act(async () => release([]))
  assert.deepEqual(totals(), ['350', undefined, undefined, undefined])
})
