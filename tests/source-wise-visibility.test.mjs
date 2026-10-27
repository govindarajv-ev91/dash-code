import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'
import * as XLSX from 'xlsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
globalThis.__sourceWiseMaster = [
  { city: 'Bangalore', source_name: ' ALPHA   team ', is_active: true },
  { city: 'Bangalore', source_name: 'Beta Team', is_active: false },
  { city: 'Delhi', source_name: 'Unknown', is_active: true },
]
globalThis.__sourceWiseXlsxUtils = XLSX.utils
globalThis.__sourceWiseOrders = ['A1', 'B1', 'C1'].map((worker, i) => ({
  id: i + 1, worker_code: worker, date_record: '2026-06-05',
  city: 'Bengaluru', client: 'Zomato', delivered: (i + 1) * 10, type1: 'NON-EV',
}))
const onboarding = [
  { rider_id_details: 'A1', source_name: 'Alpha Team' },
  { rider_id_details: 'B1', source_name: 'Beta Team' },
]
const server = await createServer({
  ssr: { noExternal: ['xlsx'] },
  cacheDir: 'node_modules/.vite-tests/source-wise-visibility',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'source-wise-fixtures', enforce: 'pre',
    resolveId(id) { if (id === 'xlsx') return '\0capture-source-xlsx' },
    load(id) {
      if (id === '\0capture-source-xlsx') return `export const utils = globalThis.__sourceWiseXlsxUtils;
        export const writeFile = (book) => { globalThis.__sourceWiseWorkbook = book }`
    },
    transform(code, id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = {}'
      if (path.endsWith('/src/lib/sourceMasterDb.js')) return `export const fetchSourceMaster = async () => {
        if (globalThis.__sourceWiseMaster instanceof Error) throw globalThis.__sourceWiseMaster;
        return globalThis.__sourceWiseMaster;
      }`
      if (path.endsWith('/src/lib/orderUploadDb.js')) return `${code}
        fetchOrderUploadMonths = async () => ['Jun-2026'];
        fetchOrderUploadsForDateRange = async () => globalThis.__sourceWiseOrders;`
      if (path.endsWith('/src/lib/ev91EvLookup.js')) return `${code}
        fetchEv91OverallStatusAll = async () => ({ data: [] });
        fetchEv91CurrentStatusAll = async () => ({ data: [] });`
      if (path.endsWith('/src/lib/ev91OnboardingPending.js')) return `${code}
        fetchEv91ClientMappingAll = async () => ({ data: [] });`
    },
  }],
})
const { default: SourceWise } = await server.ssrLoadModule('/src/SourceWiseData.jsx')
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__sourceWiseMaster', '__sourceWiseOrders', '__sourceWiseWorkbook', '__sourceWiseXlsxUtils']) delete globalThis[key]
})

const sheetRows = (book, name) => XLSX.utils.sheet_to_json(book.Sheets[name])
function assertSourceStatuses(book, name) {
  const rows = sheetRows(book, name)
  assert.ok(rows.every((row) => row.City === 'Bengaluru'))
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.Source, row['Source Status']])), {
    'Alpha Team': 'Active', 'Beta Team': 'In Active', Unknown: 'In Active',
  })
  const [headers] = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1 })
  assert.deepEqual(headers.slice(headers.indexOf('Source'), headers.indexOf('City') + 2), ['Source', 'City', 'Source Status'])
}

test('both source tabs and dropdown hide inactive sources; Excel summary/raw data retain all, even with an empty list', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(SourceWise, { onboardingData: onboarding })))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 450)))
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  const tableSources = () => [...container.querySelectorAll('tbody tr')].map((row) => row.querySelector('td')?.textContent)
  for (const tab of ['By Client', 'Source Total']) {
    await act(async () => button(tab).click())
    assert.deepEqual(tableSources(), ['Alpha Team'])
    const sourceSelect = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent.trim() === 'Source')
    await act(async () => sourceSelect.querySelector('button').click())
    assert.deepEqual([...document.querySelectorAll('[role="option"]')].map((row) => row.textContent), ['All', 'Alpha Team'])
    await act(async () => document.querySelector('[role="option"][aria-selected="true"]').click())
    assert.equal(button('Download Excel').disabled, false, container.textContent)
    await act(async () => button('Download Excel').click())
    const book = globalThis.__sourceWiseWorkbook
    assert.ok(book, container.textContent)
    const summaryName = tab === 'By Client' ? 'Source by Client' : 'Source Total'
    const summary = sheetRows(book, summaryName)
    assert.deepEqual(summary.map((row) => row.Source).sort(), ['Alpha Team', 'Beta Team', 'Unknown'])
    assert.equal(summary.reduce((sum, row) => sum + row['Total Order'], 0), 60)
    assert.deepEqual(sheetRows(book, 'Raw Orders').map((row) => row.Source).sort(), ['Alpha Team', 'Beta Team', 'Unknown'])
    assertSourceStatuses(book, summaryName)
    assertSourceStatuses(book, 'Raw Orders')
    // Check the serialized XLSX too, including headers and status values.
    const roundTrip = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    assertSourceStatuses(roundTrip, summaryName)
    assertSourceStatuses(roundTrip, 'Raw Orders')
  }
  // Source search is also display-only, even if it produces zero visible rows.
  const input = container.querySelector('input[placeholder="Source, city…"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'No match')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal(button('Download Excel').disabled, false)
  await act(async () => button('Download Excel').click())
  assert.equal(sheetRows(globalThis.__sourceWiseWorkbook, 'Raw Orders').length, 3)
  // A lookup failure must not turn every source into an inactive source.
  const previousBook = globalThis.__sourceWiseWorkbook
  globalThis.__sourceWiseMaster = new Error('Source list unavailable')
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert.equal(button('Download Excel').disabled, true)
  await act(async () => button('Download Excel').click())
  assert.equal(globalThis.__sourceWiseWorkbook, previousBook)
  globalThis.__sourceWiseMaster = []
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert.doesNotMatch(container.querySelector('tbody').textContent, /Alpha Team|Beta Team|Unknown/)
  assert.equal(button('Download Excel').disabled, false)
  await act(async () => button('Download Excel').click())
  for (const name of ['Source Total', 'Raw Orders']) {
    const rows = sheetRows(globalThis.__sourceWiseWorkbook, name)
    assert.equal(rows.length, 3)
    assert.ok(rows.every((row) => row['Source Status'] === 'In Active'))
  }
})
