import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__whatsappExport = null
globalThis.__whatsappLoads = []
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/rider-whatsapp-page',
  ssr: { noExternal: ['xlsx'] },
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'whatsapp-fixtures', enforce: 'pre',
    resolveId(source) { if (source === 'xlsx') return '\0whatsapp-xlsx' },
    load(id) {
      if (id === '\0whatsapp-xlsx') return `export const utils = {
        json_to_sheet: rows => ({ rows }), book_new: () => ({}),
        book_append_sheet: (book, sheet) => { book.sheet = sheet; }
      }; export const writeFile = (book, name) => { globalThis.__whatsappExport = { book, name }; };`
    },
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/lib/riderWhatsappData.js')) return `
        export async function loadWhatsappWeekOptions() { return ['4626', '4526', '4426', '4326'].map(week => ({ value: JSON.stringify([week, 'Nov-26']), label: week + ' · Nov-26' })); }
        export async function loadWhatsappPaymentData({ week }) {
          globalThis.__whatsappLoads.push(week);
          week = JSON.parse(week)[0];
          if (week === '4526') return { payments: [{ id: 3, week, rider_id: 'R1', rider_name: 'Old rider', month: 'Nov-26', period_start: '2026-11-02', client_name: 'Alpha', city: 'Chennai', payment_status: 'Released', final_net_payout: 300 }], contacts: { onboardingRows: [{ rider_id_details: 'R1', rider_mobile_number: '9876543210' }] } };
          if (week === '4426') return { payments: [{ week, month: 'Nov-26', period_start: '2026-10-26', payment_status: 'Pending' }], contacts: {} };
          if (week === '4326') throw new Error('Connection failed');
          return {
          payments: [
            { id: 1, week, rider_id: 'R1', rider_name: 'Ready rider', month: 'Nov-26', period_start: '2026-11-09', client_name: 'Alpha', city: 'Chennai', payment_status: 'Released', final_net_payout: 100 },
            { id: 2, week, rider_id: 'R2', rider_name: 'Missing rider', month: 'Nov-26', period_start: '2026-11-09', client_name: 'Beta', city: 'Delhi', payment_status: 'Released', final_net_payout: 200 }
          ], contacts: { onboardingRows: [{ rider_id_details: 'R1', rider_mobile_number: '9876543210' }] }
        }; }`
    },
  }],
})
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT', '__whatsappExport', '__whatsappLoads']) delete globalThis[key]
})

test('page filters one week and downloads only contactable riders with NA', async () => {
  const { default: Page } = await server.ssrLoadModule('/src/RiderWhatsappDownload.jsx')
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Page)))
    assert.match(host.textContent, /Select a week to load rider payments/)
    assert.deepEqual(globalThis.__whatsappLoads, [])
    const weekInput = host.querySelector('select[aria-label="Week"]')
    assert.equal(host.querySelector('input[type="week"]'), null)
    assert.match(weekInput.textContent, /4626 · Nov-26/)
    const selectWeek = async (value) => {
      await act(async () => {
        weekInput.value = JSON.stringify([value, 'Nov-26'])
        weekInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      })
    }
    await selectWeek('4626')
    assert.deepEqual(globalThis.__whatsappLoads, ['["4626","Nov-26"]'])
    assert.match(host.textContent, /2 payout entries · 1 ready to download · 1 missing/)
    assert.equal(host.querySelectorAll('input[type="checkbox"]').length, 4)
    const csv = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Download CSV')
    await act(async () => csv.click())
    for (let attempt = 0; attempt < 50 && !globalThis.__whatsappExport; attempt++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
    assert.equal(globalThis.__whatsappExport.name, 'Rider_WhatsApp_4626_Nov-26.csv')
    assert.equal(globalThis.__whatsappExport.book.sheet.rows.length, 1)
    assert.equal(globalThis.__whatsappExport.book.sheet.rows[0].Others, 'NA')
    assert.equal(globalThis.__whatsappExport.book.sheet.rows[0].Mobnumber, '919876543210')
    assert.equal(globalThis.__whatsappExport.book.sheet.rows[0]['Rider ID'], 'R1')
    assert.match(host.querySelector('thead').textContent, /Rider ID/)
    const alpha = [...host.querySelectorAll('label')].find((label) => label.textContent === 'Alpha').querySelector('input')
    await act(async () => alpha.click())
    assert.match(host.textContent, /1 payout entries · 0 ready to download · 1 missing/)
    assert.equal(csv.disabled, true)
    const allClients = host.querySelector('[aria-label="Select all clients"]')
    await act(async () => allClients.click())
    assert.equal([...host.querySelectorAll('input[type="checkbox"]')].every((input) => input.checked), true)
    for (const filter of ['clients', 'cities']) {
      await act(async () => host.querySelector(`[aria-label="Unselect all ${filter}"]`).click())
      assert.match(host.textContent, /0 payout entries/)
      assert.equal(csv.disabled, true)
      const fieldset = host.querySelector(`[aria-label="Select all ${filter}"]`).closest('fieldset')
      assert.equal([...fieldset.querySelectorAll('input')].every((input) => !input.checked), true)
      await act(async () => host.querySelector(`[aria-label="Select all ${filter}"]`).click())
      assert.match(host.textContent, /2 payout entries/)
      assert.equal([...fieldset.querySelectorAll('input')].every((input) => input.checked), true)
    }
    await selectWeek('4526')
    assert.match(host.querySelector('tbody').textContent, /Old rider/)
    assert.doesNotMatch(host.querySelector('tbody').textContent, /Missing rider/)
    await selectWeek('4426')
    assert.match(host.textContent, /none have a completed payout status/)
    assert.match(host.textContent, /Pending: 1/)
    await selectWeek('4326')
    assert.match(host.textContent, /Connection failed/)
    assert.doesNotMatch(host.querySelector('tbody').textContent, /No completed payouts/)
  } finally { await act(async () => root.unmount()); host.remove() }
})
