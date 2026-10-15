import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'localStorage']) {
  globalThis[key] = key === 'window' ? dom.window : dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/ev91-summary-rtd',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'mock-targets-database', enforce: 'pre', transform(_code, id) {
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
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key]
})
const operational = await server.ssrLoadModule('/src/lib/ev91OperationalSummary.js')
const { default: Summary } = await server.ssrLoadModule('/src/Ev91DeployReturnSummary.jsx')
const vehicle = (id, status = 'Available', city = 'Chennai') => ({ id,
  registrationNumber: `TN-${id}`, operationalStatus: status, hub: { city: { displayName: city } } })

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
