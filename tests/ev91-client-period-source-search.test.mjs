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
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/client-period-source-search',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'source-search-payments', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/riderPaymentDb.js')) {
      return 'export const fetchRiderPaymentsForPeriod = async () => globalThis.__sourceSearchPayments'
    }
  } }],
})
const { default: Trend } = await server.ssrLoadModule('/src/Ev91ClientPeriodTrend.jsx')
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__sourceSearchPayments']) delete globalThis[key]
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
