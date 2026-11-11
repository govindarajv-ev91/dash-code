import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__mailPanelCalls = []
const { createRoot } = await import('react-dom/client')
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false },
  cacheDir: 'node_modules/.vite-tests/client-period-mail-panel', optimizeDeps: { noDiscovery: true, include: [] },
  define: { 'import.meta.env.VITE_CLIENT_PERIOD_MAILER_SCRIPT_URL': JSON.stringify('https://script.google.com/macros/s/test/exec') },
  plugins: [{ name: 'mail-panel-data', enforce: 'pre', transform(_source, id) {
    const path = id.replaceAll('\\', '/')
    if (path.endsWith('/src/lib/riderPaymentDb.js')) return `export async function fetchRiderPaymentsForPeriod(params) {
      globalThis.__mailPanelQuery = params;
      return [{id:1, rider_id:'R1', rider_name:'Example', city:'Bangalore', client_name:'Blinkit',source_name:'Alpha',
        month:'Nov-2026',week:'4526', period_start:params.toDate, gross_payout:100}];
    }`
    if (path.endsWith('/src/lib/sourceMasterDb.js')) return `export const fetchSourceMaster = async () => [{city:'Bangalore',source_name:'Alpha',is_active:true}]`
    if (path.endsWith('/src/lib/riderOnboardingDb.js')) return 'export const fetchRiderOnboardingRows = async () => []'
    if (path.endsWith('/src/lib/clientPeriodMailLogo.js')) return "export const loadClientPeriodMailLogo = async () => 'data:image/jpeg;base64,YWJj'"
    if (path.endsWith('/src/lib/clientPeriodMailTransport.js')) return `export async function readMailStatus(url, requestId) { return {requestId, status:'sent', to:'govindaraj.v@ev91riderz.com'} }
    export async function sendClientPeriodTestMail(options) {
      globalThis.__mailPanelCalls.push(options); return {to:'govindaraj.v@ev91riderz.com', status:'sent'};
    }`
  } }],
})
const { default: Panel } = await server.ssrLoadModule('/src/components/ClientPeriodMailPanel.jsx')
after(async () => {
  await server.close(); dom.window.close()
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT', '__mailPanelQuery', '__mailPanelCalls']) delete globalThis[key]
})

test('dashboard previews and sends both periods independently of page filters', async () => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Panel, { cities: ['Bengaluru', 'Chennai'] })))
    const button = (text) => [...host.querySelectorAll('button')].find((item) => item.textContent.includes(text))
    const toggle = button('City report email')
    const content = host.querySelector(`#${toggle.getAttribute('aria-controls')}`)
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(content.hidden, true)
    await act(async () => toggle.click())
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    assert.equal(content.hidden, false)
    const preparePreview = async () => {
      await act(async () => button('Preview email').click())
      for (let attempt = 0; attempt < 50 && !host.querySelector('iframe') && !host.querySelector('[role="alert"]'); attempt++) {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
      }
      assert.equal(host.querySelector('[role="alert"]'), null, host.textContent)
      assert.ok(host.querySelector('iframe'), host.textContent)
    }
    assert.equal(host.querySelector('[aria-label="Email period"]'), null)
    assert.equal(button('Preview email').disabled, true)
    assert.equal(globalThis.__mailPanelCalls.length, 0)
    const city = host.querySelector('[aria-label="Mail city"]')
    await act(async () => { city.value = 'Bengaluru'; city.dispatchEvent(new Event('change', { bubbles: true })) })
    await preparePreview()
    await act(async () => toggle.click())
    assert.equal(content.hidden, true)
    await act(async () => toggle.click())
    assert.equal(content.hidden, false)
    assert.equal(host.querySelector('[aria-label="Mail city"]').value, 'Bengaluru')
    assert.ok(host.querySelector('iframe').getAttribute('srcdoc').includes('Bengaluru'))
    assert.equal(globalThis.__mailPanelCalls.length, 0)
    assert.equal(host.querySelector('[aria-label="Mail access key"]'), null)
    assert.equal(button('Send test email').disabled, false)
    assert.equal((host.querySelector('iframe').getAttribute('srcdoc').match(/<table /g) || []).length, 8)
    await act(async () => button('Send test email').click())
    assert.equal(globalThis.__mailPanelCalls.length, 1)
    assert.equal(globalThis.__mailPanelCalls[0].report.city, 'Bengaluru')
    assert.equal(globalThis.__mailPanelCalls[0].report.mode, 'both')
    assert.equal(globalThis.__mailPanelCalls[0].report.logo, 'data:image/jpeg;base64,YWJj')
    assert.deepEqual(globalThis.__mailPanelCalls[0].report.reports.map((report) => report.mode), ['weekly', 'monthly'])
    assert.equal(host.querySelector('iframe'), null, 'accepted mail closes its preview')
    assert.equal(globalThis.__mailPanelCalls[0].accessKey, undefined)
    assert.match(host.querySelector('[role="status"]').textContent, /Accepted by Google/)
    await act(async () => button('Check email status').click())
    assert.equal(globalThis.__mailPanelCalls.length, 1, 'checking status must not resend')
    assert.match(host.textContent, /Preview closed/)
    assert.equal(globalThis.__mailPanelQuery.monthly, true)
    assert.equal(globalThis.__mailPanelQuery.fromDate, '2026-03-30')
    assert.equal(host.querySelector('[aria-label="Test recipient"]').value, 'govindaraj.v@ev91riderz.com')
    assert.equal(globalThis.__mailPanelCalls.length, 1)
  } finally { await act(async () => root.unmount()); host.remove() }
})
