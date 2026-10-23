import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import * as XLSX from 'xlsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  ssr: { noExternal: ['xlsx'] }, cacheDir: 'node_modules/.vite-tests/ev91-sd-wallet',
  server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'capture-wallet-download', enforce: 'pre', transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/ev91SdWalletApi.js')) {
      return `${code}\ndownloadEv91SdWallet = async (rows) => { globalThis.__walletDownloadedRows = rows };`
    }
  } }],
})
const { default: Page } = await server.ssrLoadModule('/src/Ev91SdWallet.jsx')
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__walletDownloadedRows']) delete globalThis[key]
})
const labels = ['PublicRiderId', 'City', 'ClientName', 'ClientRiderId', 'TotalSd', 'PendingSd', 'FixedDeposit']
function response(rows) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([labels, ...rows]), 'Wallet')
  return new Response(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  })
}
async function settle(predicate) {
  for (let count = 0; count < 100 && !predicate(); count++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  assert.ok(predicate(), 'wallet page did not finish loading')
}

test('page filters and totals all rows, paginates, exports every match and retains data during refresh/error/remount', async (t) => {
  const fixtures = Array.from({ length: 205 }, (_, index) => [
    `MYS-26-R${String(index + 1).padStart(6, '0')}`, index < 105 ? 'Mysore' : 'Chennai',
    index % 2 ? 'Client B' : 'Client A', String(1000 + index), 100.5, 10, 5,
  ])
  let requests = 0, pending = null
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, '/api/ev91-sd-wallet')
    requests++
    return pending || response(fixtures)
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(Page)))
  await settle(() => container.querySelectorAll('tbody tr td:first-child').length > 1)
  const visible = () => [...container.querySelectorAll('tbody tr td:first-child')].map((node) => node.textContent)
  const total = () => container.querySelector('tbody tr th:nth-child(2)')?.textContent
  const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  const change = async (selector, value) => act(async () => {
    const input = container.querySelector(selector)
    const prototype = input.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
  assert.equal(visible().length, 100)
  assert.equal(total(), '20,602.5')
  await act(async () => container.querySelector('[aria-label="Next page"]').click())
  assert.equal(visible()[0], fixtures[100][0])
  await act(async () => button('Download Excel').click())
  assert.equal(globalThis.__walletDownloadedRows.length, 205)
  await change('[aria-label="City"]', 'Mysuru')
  assert.equal(visible()[0], fixtures[0][0], 'changing filters resets pagination')
  assert.equal(total(), '10,552.5')
  await change('[aria-label="Client"]', 'Client A')
  assert.equal(visible().length, 53)
  await act(async () => button('Download Excel').click())
  assert.equal(globalThis.__walletDownloadedRows.length, 53)
  await change('[aria-label="Search SD wallets"]', fixtures[0][0])
  assert.equal(visible().length, 1)
  assert.equal(total(), '100.5')
  await change('[aria-label="Search SD wallets"]', 'missing rider')
  assert.match(container.textContent, /No wallets match/)
  assert.equal(button('Download Excel').disabled, true)
  await act(async () => button('Clear filters').click())
  let release
  pending = new Promise((resolve) => { release = resolve })
  await act(async () => button('Refresh').click())
  assert.equal(visible().length, 100, 'refresh does not blank existing rows')
  assert.match(container.querySelector('[role="status"]').textContent, /Refreshing/)
  await act(async () => release(Response.json({ message: 'Upstream unavailable' }, { status: 502 })))
  assert.match(container.querySelector('[role="alert"]').textContent, /last successfully loaded data/)
  assert.equal(total(), '20,602.5')
  pending = null
  await act(async () => root.render(null))
  await act(async () => root.render(createElement(Page)))
  assert.equal(visible().length, 100)
  assert.equal(requests, 2, 'returning to the page reuses its wallet cache')
  pending = Promise.resolve(response([fixtures[0]]))
  await act(async () => button('Refresh').click())
  await settle(() => visible().length === 1)
  assert.equal(total(), '100.5')
  assert.equal(container.querySelector('[role="alert"]'), null)
})
