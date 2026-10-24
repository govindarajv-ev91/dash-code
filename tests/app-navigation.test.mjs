import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent']) {
  globalThis[name] = name === 'window' ? dom.window : dom.window[name]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const state = globalThis.__navigationTest = { renders: [], icons: 0, modules: {}, loaded: [], onboarding: Promise.resolve([]) }
const iconNames = 'LockKeyhole Layout Activity AlertTriangle BarChart3 Bike Briefcase ChevronDown CircleDollarSign ClipboardList Database FileBarChart2 Folder FolderOpen History IdCard Layers Leaf Link2 Mail MapPin Package PieChart Radio Search Shield Table2 TrendingDown Truck UserPlus Users UserX Wallet Wrench'.split(' ')
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/app-navigation',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { 'lucide-react': 'navigation-test-icons' } },
  plugins: [{
    name: 'navigation-test-environment', enforce: 'pre',
    resolveId(source) { if (source === 'navigation-test-icons') return '\0navigation-icons' },
    load(id) {
      if (id === '\0navigation-icons') return `import { createElement } from 'react';
        ${iconNames.map((name) => `export function ${name}() { ${name === 'Layout' ? '' : 'globalThis.__navigationTest.icons++;'} return createElement('svg'); }`).join('\n')}`
    },
    transform(_code, id) {
      const file = id.replaceAll('\\', '/').split('/src/')[1]
      if (!file) return
      if (file === 'lib/supabaseFetch.js') return 'export const fetchAllData = async () => ({ data: [], totalCount: 0 })'
      if (file === 'lib/riderOnboardingDb.js') return `
        export const fetchRiderOnboardingRows = () => globalThis.__navigationTest.onboarding;
        export const clearRiderOnboardingMemoryCache = () => {};`
      if (file === 'lib/orderUploadDb.js') return `
        export const fetchAllOrderUploads = async () => [];
        export const clearOrderUploadCache = () => {};
        export const patchOrderUploadCache = rows => rows;`
      if (file === 'lib/iotDataDb.js') return 'export const clearIotRiderOrderCache = () => {}'
      if (file === 'lib/deferredCache.js') return 'export const scheduleCacheWrite = () => {}'
      // Isolate navigation from report calculations and network requests. A
      // controlled import lets the test hold a real React.lazy page pending.
      if ((/^[^/]+\.jsx$/.test(file) && file !== 'App.jsx') || file === 'components/FullDataPage.jsx') {
        const name = file.split('/').at(-1).replace('.jsx', '')
        return `import { createElement } from 'react';
          await globalThis.__navigationTest.modules[${JSON.stringify(name)}];
          globalThis.__navigationTest.loaded.push(${JSON.stringify(name)});
          export default function Report() {
            globalThis.__navigationTest.renders.push({ name: ${JSON.stringify(name)}, selected: document.querySelector('[aria-current="page"]')?.textContent.trim() });
            return createElement('h1', null, ${JSON.stringify(name)});
          }`
      }
    },
  }],
})
const { default: App } = await server.ssrLoadModule('/src/App.jsx')

after(async () => {
  await server.close(); dom.window.close()
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'IS_REACT_ACT_ENVIRONMENT', '__navigationTest']) delete globalThis[name]
})

async function mount(t) {
  window.localStorage.clear()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  t.after(async () => { await act(async () => root.unmount()); host.remove() })
  await act(async () => root.render(createElement(App)))
  return host
}
function button(host, label) {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
  assert.ok(found, `Missing button: ${label}`)
  return found
}
async function waitFor(predicate) {
  for (let index = 0; index < 100 && !predicate(); index++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  assert.ok(predicate(), 'Navigation did not finish rendering')
}

test('closed folders render no page buttons and toggling one folder leaves reports untouched', async (t) => {
  const host = await mount(t)
  assert.equal(host.querySelectorAll('.nav-item-child').length, 0)
  const beforeReports = state.renders.length
  const beforeIcons = state.icons
  await act(async () => button(host, 'Order').click())
  assert.equal(host.querySelectorAll('.nav-item-child').length, 2)
  assert.equal(state.renders.length, beforeReports)
  assert.equal(state.icons - beforeIcons, 4, 'only the changed folder and its two page icons render')
  await act(async () => button(host, 'Order').click())
  assert.equal(host.querySelectorAll('.nav-item-child').length, 0)
  assert.equal(button(host, 'Order').getAttribute('aria-expanded'), 'false')
})

test('sidebar selection commits before rendering the destination report', async (t) => {
  const host = await mount(t)
  await act(async () => button(host, 'Other').click())
  const dashboardRenders = state.renders.filter((item) => item.name === 'Dashboard').length
  await act(async () => button(host, 'Rider Attendance').click())
  assert.equal(host.querySelector('h1').textContent, 'RiderAttendance')
  assert.equal(state.renders.at(-1).selected, 'Rider Attendance', 'the new selection is already painted in the DOM when report rendering starts')
  assert.equal(state.renders.filter((item) => item.name === 'Dashboard').length, dashboardRenders, 'the previous report does not re-render for the urgent selection')
})

test('a slow page import keeps navigation responsive and cannot replace a newer selection', async (t) => {
  let release
  state.modules.RiderPaymentUpload = new Promise((resolve) => { release = resolve })
  t.after(() => { release(); delete state.modules.RiderPaymentUpload })
  const host = await mount(t)
  await act(async () => button(host, 'Payment').click())
  await act(async () => button(host, 'Payment Upload').click())
  assert.equal(host.querySelector('[aria-current="page"]').textContent.trim(), 'Payment Upload')
  assert.equal(host.querySelector('main').getAttribute('aria-busy'), 'true')
  assert.equal(host.querySelector('h1').textContent, 'Dashboard')
  assert.match(host.querySelector('[role="status"]').textContent, /Opening page/)
  await act(async () => button(host, 'Reports').click())
  assert.equal(button(host, 'Reports').getAttribute('aria-expanded'), 'true')
  await act(async () => button(host, 'Dashboard').click())
  await act(async () => {
    release()
    for (let index = 0; index < 100 && !state.loaded.includes('RiderPaymentUpload'); index++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(state.loaded.includes('RiderPaymentUpload'))
  })
  await waitFor(() => host.querySelector('main').getAttribute('aria-busy') === 'false')
  assert.equal(host.querySelector('h1').textContent, 'Dashboard')
  assert.equal(host.querySelector('[role="status"]'), null)
})

test('background data updates do not re-render sidebar icons', async (t) => {
  let release
  state.onboarding = new Promise((resolve) => { release = resolve })
  t.after(() => { state.onboarding = Promise.resolve([]) })
  const host = await mount(t)
  const before = state.icons
  await act(async () => release([{ id: 1 }]))
  assert.equal(state.icons, before)
  assert.equal(host.querySelector('h1').textContent, 'Dashboard')
})

test('IoT upload still checks access before selecting its page', async (t) => {
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const host = await mount(t)
  await act(async () => button(host, 'IoT').click())
  await act(async () => button(host, 'IoT Data Upload').click())
  assert.equal(host.querySelector('dialog').open, true)
  assert.equal(host.querySelector('[aria-current="page"]').textContent.trim(), 'Dashboard')
  assert.equal(host.querySelector('h1').textContent, 'Dashboard')
})
