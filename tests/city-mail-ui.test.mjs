import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__cityMailSaves = []
const { createRoot } = await import('react-dom/client')
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false },
  cacheDir: 'node_modules/.vite-tests/city-mail-ui', optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'city-mail-data', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/cityMailDb.js')) return `
      export const cityMailError = (err) => err.message;
      export const fetchMailRows = async (table) => table === 'city_mail_contacts' ? [{id:1,city:'Chennai',name:'Head',email_id:'head@example.com',phone_number:'9876543210',cc:'a@example.com,b@example.com'}] : table === 'client_period_mail_schedules' ? [{id:1,contact_id:1,day_of_week:5,send_time:'21:05:00',is_active:true}] : [];
      export const saveCityContact = async (form) => globalThis.__cityMailSaves.push({kind:'contact',...form});
      export const saveMailSchedule = async (form) => globalThis.__cityMailSaves.push({kind:'schedule',...form});`
  } }],
})
const { default: Contacts } = await server.ssrLoadModule('/src/components/CityMailContacts.jsx')
const { default: Schedules } = await server.ssrLoadModule('/src/components/ClientPeriodSchedulePanel.jsx')
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__cityMailSaves']) delete globalThis[key]
})

test('city contact edit retains multiple CC addresses and contact details', async () => {
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
  try {
    await act(async () => root.render(createElement(Contacts, { canManage: true })))
    assert.ok(host.textContent.includes('a@example.com,b@example.com'))
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit city').click())
    assert.equal(host.querySelectorAll('input')[4].value, 'a@example.com,b@example.com')
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(globalThis.__cityMailSaves.at(-1).cc, 'a@example.com,b@example.com')
    assert.equal(globalThis.__cityMailSaves.at(-1).phone_number, '9876543210')
  } finally { await act(async () => root.unmount()); host.remove() }
})

test('schedule editing displays saved PM time, persists it and can pause', async () => {
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
  try {
    await act(async () => root.render(createElement(Schedules, { canManage: true })))
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit / pause').click())
    const selects = host.querySelectorAll('select')
    assert.equal(selects[1].value, '5'); assert.equal(selects[2].value, '9'); assert.equal(selects[3].value, '05'); assert.equal(selects[4].value, 'PM')
    await act(async () => host.querySelector('input[type=checkbox]').click())
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(globalThis.__cityMailSaves.at(-1).send_time, '21:05')
    assert.equal(globalThis.__cityMailSaves.at(-1).is_active, false)
  } finally { await act(async () => root.unmount()); host.remove() }
})
