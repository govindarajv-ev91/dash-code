import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
let rows = []
let failure = null
let queries = []
globalThis.__sourceManagementClient = {
  from(table) {
    assert.equal(table, 'source_master')
    const query = { action: 'read', filters: [] }
    const builder = {}
    for (const method of ['select', 'order', 'limit', 'single']) builder[method] = () => builder
    for (const method of ['eq', 'gt']) builder[method] = (key, value) => { query.filters.push({ method, key, value }); return builder }
    for (const method of ['insert', 'update', 'delete']) builder[method] = (values) => { query.action = method; query.values = values; return builder }
    builder.then = (resolve, reject) => {
      queries.push(query)
      if (failure) return Promise.resolve({ error: failure }).then(resolve, reject)
      const selected = rows.filter((row) => query.filters.every(({ method, key, value }) => method === 'gt' ? row[key] > value : row[key] === value))
      let data = selected.map((row) => ({ ...row }))
      if (query.action === 'insert') {
        if (rows.some((row) => row.city === query.values.city && row.source_name === query.values.source_name)) return Promise.resolve({ error: { code: '23505' } }).then(resolve, reject)
        data = { id: 10, ...query.values }; rows.push(data)
      } else if (query.action === 'update') {
        selected.forEach((row) => Object.assign(row, query.values)); data = selected[0]
      } else if (query.action === 'delete') {
        rows = rows.filter((row) => !selected.includes(row)); data = selected[0]
      }
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    }
    return builder
  },
}
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/source-master-management',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'source-management-database', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__sourceManagementClient'
  } }],
})
const { default: SourceMaster } = await server.ssrLoadModule('/src/SourceMaster.jsx')
const db = await server.ssrLoadModule('/src/lib/sourceMasterDb.js')
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__sourceManagementClient']) delete globalThis[key]
})

async function mount(t, canManage) {
  rows = [{ id: 1, city: 'Bangalore', source_name: 'Alpha', is_active: true }, { id: 2, city: 'Delhi', source_name: 'Beta', is_active: false }]
  queries = []; failure = null
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(createElement(SourceMaster, { canManage })))
  return container
}
const button = (container, text) => [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
const input = async (element, value) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
})
const submit = async (container) => act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

test('administrator can add/edit/toggle/remove sources; duplicate and database errors remain visible', async (t) => {
  const container = await mount(t, true)
  assert.equal(container.querySelectorAll('tbody tr').length, 2, 'includes inactive sources')
  await input(container.querySelector('input[list]'), ' Bengaluru ')
  await input(container.querySelector('input[placeholder="Enter source name"]'), '  New   Team ')
  await submit(container)
  assert.deepEqual(rows.at(-1), { id: 10, city: 'Bangalore', source_name: 'New Team', is_active: true })
  assert.match(container.querySelector('[role="status"]').textContent, /Source added/)
  const sourceRow = () => [...container.querySelectorAll('tbody tr')].find((row) => row.textContent.includes('New Team'))
  await act(async () => button(sourceRow(), 'Edit').click())
  await input(container.querySelector('input[placeholder="Enter source name"]'), 'Edited team')
  await submit(container)
  assert.equal(rows.find((row) => row.id === 10).source_name, 'Edited team')
  const editedRow = () => [...container.querySelectorAll('tbody tr')].find((row) => row.textContent.includes('Edited team'))
  assert.equal(button(editedRow(), 'Active').getAttribute('aria-pressed'), 'true')
  await act(async () => button(editedRow(), 'Inactive').click())
  assert.equal(rows.find((row) => row.id === 10).is_active, false)
  assert.equal(button(editedRow(), 'Inactive').getAttribute('aria-pressed'), 'true')
  await act(async () => button(editedRow(), 'Active').click())
  assert.equal(rows.find((row) => row.id === 10).is_active, true)
  await input(container.querySelector('input[list]'), 'Bangalore')
  await input(container.querySelector('input[placeholder="Enter source name"]'), 'Alpha')
  await submit(container)
  assert.match(container.querySelector('[role="alert"]').textContent, /already exists/)
  await act(async () => button(editedRow(), 'Remove').click())
  await act(async () => button(container.querySelector('[role="alertdialog"]'), 'Cancel').click())
  assert.equal(rows.length, 3)
  await act(async () => button(editedRow(), 'Remove').click())
  failure = { code: '42501' }
  await act(async () => button(container, 'Confirm remove').click())
  assert.match(container.querySelector('[role="alert"]').textContent, /administrator account/)
  assert.equal(rows.length, 3)
  failure = null
  await act(async () => button(container, 'Confirm remove').click())
  assert.equal(rows.length, 2)
  assert.equal(container.querySelector('[role="alertdialog"]'), null)
})

test('viewers see disabled status buttons and can filter sources; report reads stay active-only', async (t) => {
  const container = await mount(t, false)
  assert.equal(container.querySelector('form'), null)
  assert.equal(button(container, 'Remove'), undefined)
  assert.match(container.textContent, /administrator account/)
  const filter = container.querySelector('[aria-label="Filter sources by status"]')
  const rowButtons = [...container.querySelectorAll('tbody button')]
  assert.deepEqual(rowButtons.map((node) => node.textContent), ['Active', 'Inactive', 'Active', 'Inactive'])
  assert.ok(rowButtons.every((node) => node.disabled))
  await act(async () => button(filter, 'Inactive').click())
  assert.equal(container.querySelectorAll('tbody tr').length, 1)
  assert.match(container.querySelector('tbody').textContent, /Beta/)
  await act(async () => button(filter, 'Active').click())
  assert.match(container.querySelector('tbody').textContent, /Alpha/)
  assert.doesNotMatch(container.querySelector('tbody').textContent, /Beta/)
  await act(async () => button(filter, 'All').click())
  await input(container.querySelector('input[type="search"]'), 'beta')
  assert.equal(container.querySelectorAll('tbody tr').length, 1)
  assert.match(container.querySelector('tbody').textContent, /Inactive/)
  await act(async () => button(container.querySelector('tbody'), 'Active').click())
  assert.equal(queries.filter((query) => query.action !== 'read').length, 0)
  assert.deepEqual((await db.fetchSourceMaster()).map((row) => row.source_name), ['Alpha'])
  await assert.rejects(db.saveSourceMaster({ city: ' ', source_name: 'x' }), /required/)
})

test('status errors distinguish missing database grants, blocked rows, stale records and expired sessions', () => {
  assert.match(db.sourceMasterError({ code: '42501', message: 'permission denied for table source_master' }), /database permissions are missing/)
  assert.match(db.sourceMasterError({ code: '42501', message: 'new row violates row-level security policy' }), /current session is not allowed/)
  const noRow = db.sourceMasterError({ code: 'PGRST116', message: 'The result contains 0 rows' })
  assert.match(noRow, /No source was changed/)
  assert.doesNotMatch(noRow, /require an administrator/)
  assert.match(db.sourceMasterError({ code: 'PGRST303' }), /session has expired/)
})
