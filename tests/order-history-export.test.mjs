import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  ssr: { noExternal: ['xlsx'] },
  cacheDir: 'node_modules/.vite-tests/order-history-export',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'order-history-fixtures', enforce: 'pre',
    resolveId(id) { if (id === 'xlsx') return '\0history-xlsx' },
    load(id) {
      if (id === '\0history-xlsx') return `export const utils = {
        json_to_sheet: rows => rows, book_new: () => ({}),
        book_append_sheet: (book, rows, name) => { book[name] = rows },
      }; export const writeFile = (book, filename) => { globalThis.__historyExport = { book, filename } }`
    },
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/orderUploadDb.js')) return `
        export const orderUploadMonthLabelsForRange = (from, to) => from > to ? [] : (globalThis.__historyLabels || ['Oct-2026', 'Nov-2026']);
        export const fetchOrderUploadMonths = async () => ['Nov-2026', 'Oct-2026'];
        export const clearOrderUploadCache = () => {};
        export const fetchOrderUploadsForHistory = (month, options) => globalThis.__historyLoad(month, options);
      `
    },
  }],
})
const { default: OrderHistory } = await server.ssrLoadModule('/src/OrderHistory.jsx')
const { buildOrderHistoryRows, filterOrderHistory } = await server.ssrLoadModule('/src/lib/orderHistoryReport.js')
after(async () => { await server.close(); dom.window.close() })

function row(id, date, month) {
  return { id, date_record: date, month, worker_code: `R${id}`, city: 'Chennai', client: 'Client', type1: 'EV', delivered: 5 }
}
async function change(input, value) {
  await act(async () => {
    const proto = input.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}

test('range download includes both boundary days across months and all pages; waits for completion', async () => {
  let finish
  let pending = false
  const october = Array.from({ length: 105 }, (_, i) => row(i + 1, '2026-10-31', 'Oct-2026'))
  const november = [row(200, '2026-11-01', 'Nov-2026'), row(201, '2026-11-02', 'Nov-2026')]
  globalThis.__historyLoad = async (month, options) => {
    const rows = month === 'Oct-2026' ? october : november
    options.onProgress(rows.length, rows)
    if (pending && month === 'Nov-2026') await new Promise(resolve => { finish = resolve })
    return rows
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(OrderHistory)))
    const dates = container.querySelectorAll('input[type="date"]')
    await change(dates[0], '2026-10-31')
    pending = true
    await change(dates[1], '2026-11-01')
    const download = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Export Excel'))
    assert.equal(download.disabled, true)
    await act(async () => finish())
    assert.equal(download.disabled, false)
    await act(async () => download.click())
    const { book, filename } = globalThis.__historyExport
    assert.equal(book['Order History'].length, 106)
    assert.equal(book['Order History'].filter(r => r.Date === '2026-10-31').length, 105)
    assert.ok(book['Order History'].some(r => r.Date === '2026-11-01'))
    assert.match(filename, /2026-10-31_to_2026-11-01/)
    await change(dates[0], '2026-11-03')
    assert.equal(download.disabled, true)
    assert.match(container.textContent, /From date must be on or before To date/)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

test('dated exports exclude undated records and retain other active filters', () => {
  const rows = buildOrderHistoryRows([row(1, '', 'Oct-2026'), row(2, '31-10-2026', 'Oct-2026'),
    { ...row(3, '2026-10-31', 'Oct-2026'), city: 'Delhi' }])
  const filtered = filterOrderHistory(rows, { dateFrom: '2026-10-31', dateTo: '2026-10-31', cities: ['Chennai'] })
  assert.deepEqual(filtered.map(r => r.workerCode), ['R2'])
})

test('six-month report overlaps three reads and keeps only a small preview during progress', async () => {
  const labels = ['Jun-2026', 'Jul-2026', 'Aug-2026', 'Sep-2026', 'Oct-2026', 'Nov-2026']
  globalThis.__historyLabels = labels
  const pending = new Map()
  let rangeMode = false
  let active = 0, peak = 0
  globalThis.__historyLoad = async (month, options) => {
    if (!rangeMode) return []
    active++
    peak = Math.max(peak, active)
    const index = labels.indexOf(month)
    const date = `2026-${String(index + 6).padStart(2, '0')}-01`
    const rows = Array.from({ length: 1000 }, (_, i) => row(index * 1000 + i, date, month))
    options.onProgress(500, rows.slice(0, 500))
    await new Promise(resolve => pending.set(month, resolve))
    options.onProgress(1000, rows.slice(500))
    active--
    return rows
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(OrderHistory)))
    const dates = container.querySelectorAll('input[type="date"]')
    await change(dates[0], '2026-06-01')
    rangeMode = true
    await change(dates[1], '2026-11-16')
    assert.equal(active, 3)
    assert.match(container.querySelector('[role="status"]').textContent, /1,500 rows received/)
    const orderHeading = [...container.querySelectorAll('h3')].find(node => node.textContent.includes('Order rows'))
    assert.equal(orderHeading.querySelector('.status-badge').textContent, '100')
    for (const month of labels) await act(async () => pending.get(month)())
    assert.equal(peak, 3)
    assert.equal(container.querySelector('[role="status"]'), null)
    const download = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Export Excel'))
    assert.equal(download.disabled, false)
    await act(async () => download.click())
    assert.equal(globalThis.__historyExport.book['Order History'].length, 6000)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete globalThis.__historyLabels
  }
})
