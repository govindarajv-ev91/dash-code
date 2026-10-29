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
globalThis.__sourceWiseXlsxRead = XLSX.read
globalThis.__sourceWiseOrderFetches = []
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
    transform(code, id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/lib/sourceWiseExcelExport.js')) return `${code}
        downloadSourceWiseExcel = async (sheets) => {
          const buffer = await buildSourceWiseWorkbook(sheets).xlsx.writeBuffer();
          globalThis.__sourceWiseWorkbook = globalThis.__sourceWiseXlsxRead(buffer, { type: 'buffer', cellStyles: true });
        };`
      if (path.endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = {}'
      if (path.endsWith('/src/lib/sourceMasterDb.js')) return `export const fetchSourceMaster = async () => {
        if (globalThis.__sourceWiseMaster instanceof Error) throw globalThis.__sourceWiseMaster;
        return globalThis.__sourceWiseMaster;
      }`
      if (path.endsWith('/src/lib/orderUploadDb.js')) return `${code}
        fetchOrderUploadMonths = async () => ['Jun-2026'];
        fetchOrderUploadsForDateRange = async (from, to) => {
          globalThis.__sourceWiseOrderFetches.push({ from, to });
          return globalThis.__sourceWiseOrders.filter((row) => row.date_record >= from && row.date_record <= to);
        };`
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
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__sourceWiseMaster', '__sourceWiseOrders', '__sourceWiseWorkbook', '__sourceWiseXlsxRead', '__sourceWiseOrderFetches']) delete globalThis[key]
})

test('latest-client switch defaults on, updates both views and exports, and loads the prior-month window', async (t) => {
  const previousMaster = globalThis.__sourceWiseMaster
  const previousOrders = globalThis.__sourceWiseOrders
  t.after(() => {
    globalThis.__sourceWiseMaster = previousMaster
    globalThis.__sourceWiseOrders = previousOrders
  })
  globalThis.__sourceWiseMaster = [{ city: 'Bangalore', source_name: 'Alpha Team', is_active: true }]
  globalThis.__sourceWiseOrderFetches = []
  globalThis.__sourceWiseOrders = [
    { worker_code: 'A1', client: 'Amazon', date_record: '2026-05-28', delivered: 8 },
    { worker_code: 'A1', client: 'Amazon', date_record: '2026-06-01', delivered: 2 },
    { worker_code: 'A1', client: 'Amazon', date_record: '2026-06-19', delivered: 5 },
    { worker_code: 'A1', client: 'Amazon', date_record: '2026-06-23', delivered: 6 },
    { worker_code: 'Z1', client: 'Zomato', date_record: '2026-06-26', delivered: 3 },
    { worker_code: 'Z1', client: 'Zomato', date_record: '2026-06-28', delivered: 4 },
  ].map((row, i) => ({ ...row, id: i + 1, city: 'Bengaluru', type1: 'NON-EV' }))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(SourceWise, { onboardingData: [
    { rider_id_details: 'A1', source_name: 'Alpha Team' },
    { rider_id_details: 'Z1', source_name: 'Alpha Team' },
  ] })))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 450)))
  assert.deepEqual(globalThis.__sourceWiseOrderFetches[0], { from: '2026-05-28', to: '2026-06-30' })
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  const toggle = container.querySelector('[role="switch"]')
  assert.equal(toggle.getAttribute('aria-checked'), 'true')
  const tableRows = () => {
    const headers = [...container.querySelectorAll('thead th')].map((node) => node.textContent.replace(/ [↑↓]$/, ''))
    return [...container.querySelectorAll('tbody tr')].map((row) => Object.fromEntries(
      [...row.querySelectorAll('td')].map((cell, i) => [headers[i], cell.textContent])
    ))
  }
  await t.test('dropdown scroll positioning ignores independent scrollers and batches ancestor events', async (t) => {
    const clientButton = [...container.querySelectorAll('label')]
      .find((label) => label.querySelector('span')?.textContent.trim() === 'Client').querySelector('button')
    const frames = new Map()
    let frameId = 0
    const measure = t.mock.method(clientButton, 'getBoundingClientRect', () => ({ top: 100, bottom: 130, left: 20, width: 160 }))
    const request = t.mock.method(window, 'requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId })
    const cancel = t.mock.method(window, 'cancelAnimationFrame', (id) => frames.delete(id))
    try {
      await act(async () => clientButton.click())
      assert.equal(measure.mock.callCount(), 1)
      const menuScroller = document.querySelector('[role="option"]').parentElement
      const tableScroller = container.querySelector('.rp-table-scroll')
      await act(async () => {
        for (let i = 0; i < 25; i++) {
          menuScroller.dispatchEvent(new Event('scroll'))
          tableScroller.dispatchEvent(new Event('scroll'))
        }
      })
      assert.equal(request.mock.callCount(), 0, 'menu/table scroll must not trigger layout reads or React position updates')
      await act(async () => {
        for (let i = 0; i < 25; i++) document.dispatchEvent(new Event('scroll'))
      })
      assert.equal(frames.size, 1, 'ancestor scroll events share one animation frame')
      await act(async () => {
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach((callback) => callback(0))
      })
      assert.equal(measure.mock.callCount(), 2)
      await act(async () => window.dispatchEvent(new Event('resize')))
      assert.equal(frames.size, 1)
      await act(async () => clientButton.click())
      assert.equal(frames.size, 0, 'closing the dropdown cancels pending position work')
    } finally {
      measure.mock.restore(); request.mock.restore(); cancel.mock.restore()
    }
  })
  for (const tab of ['By Client', 'Source Total']) {
    await act(async () => button(tab).click())
    let rows = tableRows()
    const activeTotal = () => tableRows().reduce((sum, row) => sum + Number(row['Active Rider Count (last 4 days)']), 0)
    assert.equal(activeTotal(), 2)
    if (tab === 'By Client') {
      const amazon = rows.find((row) => row.Client === 'Amazon')
      assert.equal(amazon['Active window end'], '2026-06-23')
      assert.equal(amazon['Active window dates'], '2026-06-19, 2026-06-20, 2026-06-21, 2026-06-22')
    }
    await downloadExcel(button('Download Excel'))
    const book = globalThis.__sourceWiseWorkbook
    assert.deepEqual(book.SheetNames.slice(0, 2), ['Source by Client', 'Source Total'])
    for (const name of ['Source by Client', 'Source Total']) {
      assert.equal(sheetRows(book, name).reduce((sum, row) => sum + row['Active Rider Count (last 4 days)'], 0), 2)
      assert.equal(sheetRows(book, name).reduce((sum, row) => sum + row['Total Order'], 0), 20)
    }
    assert.equal(sheetRows(book, 'Raw Orders').reduce((sum, row) => sum + row['Total Order'], 0), 20)
    assert.equal(sheetRows(book, 'Client Active Windows').find((row) => row.Client === 'Amazon')['Active window end'], '2026-06-23')
    await act(async () => toggle.click())
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    assert.equal(activeTotal(), 1)
    await downloadExcel(button('Download Excel'))
    assert.equal(globalThis.__sourceWiseWorkbook.Sheets['Client Active Windows'], undefined)
    for (const name of ['Source by Client', 'Source Total']) {
      assert.equal(sheetRows(globalThis.__sourceWiseWorkbook, name).reduce((sum, row) => sum + row['Active Rider Count (last 4 days)'], 0), 1)
    }
    await act(async () => toggle.click())
  }
  const clientSelect = () => [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent.trim() === 'Client')
  const pickClient = async (client) => {
    assert.ok(clientSelect(), 'Client filter must remain visible in Source Total')
    await act(async () => clientSelect().querySelector('button').click())
    const option = [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent === client)
    assert.ok(option, `Client option ${client} must be available`)
    await act(async () => option.click())
  }
  await pickClient('Amazon')
  for (const tab of ['Source Total', 'By Client']) {
    await act(async () => button(tab).click())
    assert.match(clientSelect().textContent, /Amazon/)
    const [row] = tableRows()
    assert.equal(tableRows().length, 1)
    assert.equal(row['Total Order'], '13')
    assert.equal(row['Unique Rider Count'], '1')
    assert.equal(row['Active Rider Count (last 4 days)'], '1')
    assert.equal(row['Active window end'], '2026-06-23')
    await downloadExcel(button('Download Excel'))
    const book = globalThis.__sourceWiseWorkbook
    const summaryName = tab === 'By Client' ? 'Source by Client' : 'Source Total'
    assert.equal(sheetRows(book, summaryName)[0]['Total Order'], 13)
    for (const name of ['Source by Client', 'Source Total']) assert.equal(sheetRows(book, name)[0]['Total Order'], 13)
    assert.ok(sheetRows(book, 'Raw Orders').every((order) => order.Client === 'Amazon'))
    assert.equal(sheetRows(book, 'Raw Orders').reduce((sum, order) => sum + order['Total Order'], 0), 13)
    assert.deepEqual(sheetRows(book, 'Client Active Windows').map((window) => window.Client), ['Amazon'])
    assert.equal(sheetRows(book, 'Active Summary').find((entry) => entry.Metric === 'Total Active Riders').Value, 1)
  }
  await pickClient('All')
  await act(async () => button('Source Total').click())
  assert.equal(tableRows()[0]['Total Order'], '20')
  // Narrow the report to June 1–3: Amazon must use May 28–31 for activity.
  const [fromInput, toInput] = container.querySelectorAll('input[type="date"]')
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setValue.call(fromInput, '2026-06-01')
    fromInput.dispatchEvent(new Event('input', { bubbles: true }))
    setValue.call(toInput, '2026-06-03')
    toInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 450)))
  const [amazon] = tableRows()
  assert.equal(amazon['Active Rider Count (last 4 days)'], '1')
  assert.equal(amazon['Total Order'], '2')
  assert.equal(amazon['Active window dates'], '2026-05-28, 2026-05-29, 2026-05-30, 2026-05-31')
})

const sheetRows = (book, name) => XLSX.utils.sheet_to_json(book.Sheets[name])
async function downloadExcel(button) {
  const previous = globalThis.__sourceWiseWorkbook
  const disabled = button.disabled
  await act(async () => {
    button.click()
    if (disabled) return
    for (let attempt = 0; attempt < 100 && globalThis.__sourceWiseWorkbook === previous; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.notEqual(globalThis.__sourceWiseWorkbook, previous, 'Excel download must complete')
  })
}
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
    await downloadExcel(button('Download Excel'))
    const book = globalThis.__sourceWiseWorkbook
    assert.ok(book, container.textContent)
    const summaryName = tab === 'By Client' ? 'Source by Client' : 'Source Total'
    const summary = sheetRows(book, summaryName)
    assert.deepEqual(summary.map((row) => row.Source).sort(), ['Alpha Team', 'Beta Team', 'Unknown'])
    assert.equal(summary.reduce((sum, row) => sum + row['Total Order'], 0), 60)
    assert.deepEqual(sheetRows(book, 'Raw Orders').map((row) => row.Source).sort(), ['Alpha Team', 'Beta Team', 'Unknown'])
    for (const name of ['Source by Client', 'Source Total', 'Raw Orders']) assertSourceStatuses(book, name)
    // Check the serialized XLSX too, including headers and status values.
    const roundTrip = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    for (const name of ['Source by Client', 'Source Total', 'Raw Orders']) assertSourceStatuses(roundTrip, name)
  }
  // Source search is also display-only, even if it produces zero visible rows.
  const input = container.querySelector('input[placeholder="Source, city…"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'No match')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal(button('Download Excel').disabled, false)
  await downloadExcel(button('Download Excel'))
  assert.equal(sheetRows(globalThis.__sourceWiseWorkbook, 'Raw Orders').length, 3)
  // A lookup failure must not turn every source into an inactive source.
  const previousBook = globalThis.__sourceWiseWorkbook
  globalThis.__sourceWiseMaster = new Error('Source list unavailable')
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert.equal(button('Download Excel').disabled, true)
  await downloadExcel(button('Download Excel'))
  assert.equal(globalThis.__sourceWiseWorkbook, previousBook)
  globalThis.__sourceWiseMaster = []
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert.doesNotMatch(container.querySelector('tbody').textContent, /Alpha Team|Beta Team|Unknown/)
  assert.equal(button('Download Excel').disabled, false)
  await downloadExcel(button('Download Excel'))
  for (const name of ['Source by Client', 'Source Total', 'Raw Orders']) {
    const rows = sheetRows(globalThis.__sourceWiseWorkbook, name)
    assert.equal(rows.length, 3)
    assert.ok(rows.every((row) => row['Source Status'] === 'In Active'))
  }
})

test('one workbook always includes both reports with distinct-client riders deduplicated in Source Total', async (t) => {
  const previousMaster = globalThis.__sourceWiseMaster
  const previousOrders = globalThis.__sourceWiseOrders
  t.after(() => { globalThis.__sourceWiseMaster = previousMaster; globalThis.__sourceWiseOrders = previousOrders })
  globalThis.__sourceWiseMaster = [{ city: 'Bangalore', source_name: 'Alpha Team', is_active: true }]
  globalThis.__sourceWiseOrders = [
    { worker_code: 'SHARED', client: 'Amazon', date_record: '2026-06-19', delivered: 5, city: 'Bengaluru' },
    { worker_code: 'SHARED', client: 'Amazon', date_record: '2026-06-23', delivered: 7, city: 'Bengaluru' },
    { worker_code: 'SHARED', client: 'Zomato', date_record: '2026-06-26', delivered: 3, city: 'Bengaluru' },
    { worker_code: 'SHARED', client: 'Zomato', date_record: '2026-06-28', delivered: 4, city: 'Bengaluru' },
    { worker_code: 'DELHI', client: 'Swiggy', date_record: '2026-06-26', delivered: 10, city: 'Delhi' },
    { worker_code: 'DELHI', client: 'Swiggy', date_record: '2026-06-28', delivered: 10, city: 'Delhi' },
  ].map((row, i) => ({ ...row, id: i + 1, type1: 'NON-EV' }))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(SourceWise, { onboardingData: [
    { rider_id_details: 'SHARED', source_name: 'Alpha Team' },
    { rider_id_details: 'DELHI', source_name: 'Alpha Team' },
  ] })))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 450)))
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  const citySelect = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent.trim() === 'City')
  await act(async () => citySelect.querySelector('button').click())
  await act(async () => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent === 'Bengaluru').click())
  let previousSheets
  for (const tab of ['By Client', 'Source Total']) {
    await act(async () => button(tab).click())
    await downloadExcel(button('Download Excel'))
    const book = globalThis.__sourceWiseWorkbook
    assert.deepEqual(book.SheetNames, ['Source by Client', 'Source Total', 'Raw Orders', 'Active Summary', 'Client Active Windows'])
    const clientRows = sheetRows(book, 'Source by Client')
    const [sourceRow] = sheetRows(book, 'Source Total')
    for (const name of ['Source by Client', 'Source Total']) {
      const sheet = book.Sheets[name]
      const [headers] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
      const column = headers.indexOf('Active Rider Count (last 4 days)')
      for (let row = 0; row <= sheetRows(book, name).length; row++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]
        assert.equal(cell.s.patternType, 'solid')
        assert.equal(cell.s.fgColor.rgb, 'FFFF00')
      }
    }
    assert.equal(clientRows.length, 2)
    assert.equal(sourceRow['Unique Rider Count'], 1, 'Source Total must be rebuilt, not summed across clients')
    assert.equal(sourceRow['Active Rider Count (last 4 days)'], 1)
    assert.equal(clientRows.reduce((sum, row) => sum + row['Active Rider Count (last 4 days)'], 0), 2)
    for (const name of ['Source by Client', 'Source Total', 'Raw Orders']) {
      const rows = sheetRows(book, name)
      assert.ok(rows.every((row) => row.City === 'Bengaluru'))
      assert.equal(rows.reduce((sum, row) => sum + row['Total Order'], 0), 19)
    }
    assert.equal(sheetRows(book, 'Active Summary').find((row) => row.Metric === 'Total Active Riders').Value, 1)
    assert.deepEqual(sheetRows(book, 'Client Active Windows').map((row) => row.Client), ['Amazon', 'Zomato'])
    const sheets = Object.fromEntries(book.SheetNames.map((name) => [name, sheetRows(book, name)]))
    if (previousSheets) assert.deepEqual(sheets, previousSheets, 'export contents must not depend on the open tab')
    previousSheets = sheets
  }
})

test('rider city correction applies to the page, both Excel reports, raw rows and city filters', async (t) => {
  const previousMaster = globalThis.__sourceWiseMaster
  const previousOrders = globalThis.__sourceWiseOrders
  t.after(() => { globalThis.__sourceWiseMaster = previousMaster; globalThis.__sourceWiseOrders = previousOrders })
  globalThis.__sourceWiseMaster = [{ city: 'Mumbai', source_name: 'Alpha Team', is_active: true }]
  globalThis.__sourceWiseOrders = [
    { date_record: '2026-06-14', city: 'Mumbai', delivered: 10 },
    { date_record: '2026-06-15', city: 'Chennai', delivered: 20 },
    { date_record: '2026-06-16', city: 'Mumbai', delivered: 10 },
    { date_record: '2026-06-27', city: 'Mumbai', delivered: 5 },
    { date_record: '2026-06-28', city: 'Mumbai', delivered: 7 },
    { date_record: '2026-06-28', city: 'Chennai', delivered: 0 },
  ].map((row, id) => ({ ...row, id, worker_code: 'FE10258926', client: 'Blinkit', type1: 'NON-EV' }))
  const original = structuredClone(globalThis.__sourceWiseOrders)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(SourceWise, { onboardingData: [
    { rider_id_details: 'FE10258926', source_name: 'Alpha Team' },
  ] })))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 450)))
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  for (const tab of ['By Client', 'Source Total']) {
    await act(async () => button(tab).click())
    assert.equal(container.querySelectorAll('tbody tr').length, 1)
    assert.equal(container.querySelector('tbody tr td:nth-child(2)').textContent, 'Mumbai')
    await downloadExcel(button('Download Excel'))
    const book = globalThis.__sourceWiseWorkbook
    for (const name of ['Source by Client', 'Source Total']) {
      const [row] = sheetRows(book, name)
      assert.equal(row.City, 'Mumbai')
      assert.equal(row['Unique Rider Count'], 1)
      assert.equal(row['Total Order'], 52)
      assert.equal(row['Source Status'], 'Active')
    }
    const raw = sheetRows(book, 'Raw Orders')
    assert.equal(raw.length, 6)
    assert.ok(raw.every((row) => row.City === 'Mumbai' && row['Source Status'] === 'Active'))
    assert.equal(raw.find((row) => row.Date === '2026-06-15')['Uploaded City'], 'Chennai')
  }
  const pickCity = async (city) => {
    const select = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent.trim() === 'City')
    await act(async () => select.querySelector('button').click())
    await act(async () => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent === city).click())
  }
  await pickCity('Chennai')
  assert.equal(container.querySelectorAll('tbody tr').length, 0)
  assert.equal(button('Download Excel').disabled, true)
  await pickCity('Mumbai')
  await downloadExcel(button('Download Excel'))
  assert.equal(sheetRows(globalThis.__sourceWiseWorkbook, 'Raw Orders').length, 6)
  assert.deepEqual(globalThis.__sourceWiseOrders, original)
})
