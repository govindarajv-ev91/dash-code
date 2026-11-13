import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const calls = globalThis.__evZeroLoading = { builds: 0, riders: 0, options: 0, filters: [] }
const { createRoot } = await import('react-dom/client')
const server = await createServer({ configFile: false,
  cacheDir: 'node_modules/.vite-tests/overview-ev-zero-loading',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'zero-order-loading-data', enforce: 'pre', transform(_code, id) {
    const path = id.replaceAll('\\', '/')
    if (path.endsWith('/src/lib/overviewEvZeroOrder.js')) return `
      export function collectOverviewEvZeroOrderFilterOptions() {
        globalThis.__evZeroLoading.options++;
        return { cities: ['Chennai', 'Bengaluru'], clients: ['Amazon', 'Blinkit'] };
      }
      export async function buildOverviewEvZeroOrderReport() {
        globalThis.__evZeroLoading.builds++;
        return { series: [], withFilters(city, clients) {
          globalThis.__evZeroLoading.filters.push([city, [...clients]]);
          return { series: [], getDetails: () => [] };
        } };
      }`
    if (path.endsWith('/src/lib/ev91RiderPerformance.js')) return `
      export async function fetchEv91RiderDetails() {
        globalThis.__evZeroLoading.riders++;
        return new Map();
      }`
  } }],
})
const { default: Chart } = await server.ssrLoadModule('/src/components/OverviewEvZeroOrderChart.jsx')
after(async () => {
  await server.close()
  dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__evZeroLoading']) delete globalThis[key]
})

test('city and client changes reuse prepared counts; date changes rebuild them', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = { orderRows: [], overallRows: [{}], currentRows: [], dateFrom: '2026-10-01', dateTo: '2026-10-02', loading: false, error: '' }
  async function settleBuilds(expected) {
    for (let i = 0; i < 100 && (calls.builds < expected || host.textContent.includes('Loading EV')); i++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    }
    assert.equal(calls.builds, expected)
    assert.ok(!host.textContent.includes('Loading EV'))
  }
  try {
    await act(async () => root.render(createElement(Chart, props)))
    await settleBuilds(1)
    const city = host.querySelector('select')
    await act(async () => { city.value = 'Chennai'; city.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => host.querySelector('input[type=checkbox]').click())
    assert.deepEqual(calls.filters.at(-1), ['Chennai', ['Amazon']])
    assert.equal(calls.builds, 1)
    assert.equal(calls.riders, 1)
    assert.equal(calls.options, 1)
    assert.ok(!host.textContent.includes('Loading EV'))
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Reset to all clients').click())
    assert.deepEqual(calls.filters.at(-1), ['Chennai', []])
    await act(async () => root.render(createElement(Chart, { ...props, dateTo: '2026-10-03' })))
    await settleBuilds(2)
    assert.equal(calls.riders, 2)
    assert.deepEqual(calls.filters.at(-1), ['Chennai', []])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
