import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { SourceTextModule } from 'node:vm'
import { JSDOM, VirtualConsole } from 'jsdom'

test('production login, Full Data, admin settings and IoT upload access work through their real lazy modules', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => {
    if (error.type === 'unhandled exception') errors.push(error)
  })
  const dom = new JSDOM(html, { url: 'http://localhost', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const { window } = dom
  window.addEventListener('error', (event) => errors.push(event.error || event.message))
  window.addEventListener('unhandledrejection', (event) => errors.push(event.reason))
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false }
  for (const name of ['Response', 'Request', 'Headers', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder']) window[name] = globalThis[name]
  let dashboardRole = 'user'
  let loginRequired = true
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
    if (url.pathname.endsWith('/auth/v1/token')) {
      const payload = Buffer.from(JSON.stringify({ sub: 'test-staff', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
      return Response.json({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-refresh',
        token_type: 'bearer', expires_in: 3600, user: { id: 'test-staff', email: 'staff@example.com', role: 'authenticated' } })
    }
    if (url.pathname.endsWith('/rpc/dashboard_login_enabled')) return Response.json(loginRequired)
    if (url.pathname.endsWith('/rpc/set_dashboard_login_enabled')) {
      if (dashboardRole !== 'admin') return Response.json({ code: '42501', message: 'Administrator access is required.' }, { status: 403 })
      loginRequired = JSON.parse(init.body).p_enabled
      return Response.json(loginRequired)
    }
    if (url.pathname.endsWith('/dashboard_users')) return Response.json([{ id: 'test-staff', email: 'staff@example.com', role: dashboardRole }])
    if (url.pathname.endsWith('/functions/v1/dashboard-admin')) {
      const body = JSON.parse(init.body || '{}')
      if (body.action === 'set-login-enabled') { loginRequired = body.login_enabled; return Response.json({ login_enabled: loginRequired }) }
      return Response.json({ users: [{ id: 'test-staff', email: 'staff@example.com', role: 'admin' }], total: 1 })
    }
    if (url.pathname.includes('distinct_order_upload_months')) return Response.json([{ month: 'Jun-2026' }])
    if (url.pathname.endsWith('/order_upload_data')) {
      if (url.searchParams.getAll('id').some((filter) => filter.startsWith('gt.'))) return Response.json([])
      return Response.json([{ id: 1, month: 'Jun-2026', date_record: '2026-06-03', worker_code: 'FE1', delivered: 5, city: 'Chennai', client: 'Blinkit', type1: 'EV' }])
    }
    if (url.pathname.includes('/rest/v1/')) return Response.json([])
    return Response.json({ success: true, data: [], vehicles: [], pagination: { hasMore: false, totalPages: 1 } })
  }
  // JSDOM does not download preloaded CSS; complete those load events locally.
  const observer = new window.MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.tagName === 'LINK') setTimeout(() => node.dispatchEvent(new window.Event('load')), 0)
    }
  })
  observer.observe(window.document.head, { childList: true })
  const context = dom.getInternalVMContext()
  const modules = new Map()
  const loading = new Map()
  async function getModule(url) {
    if (!modules.has(url.href)) {
      // Cache the promise before reading. Concurrent shared-chunk imports must
      // receive the same module (and the same React instance), as in a browser.
      modules.set(url.href, (async () => new SourceTextModule(await readFile(url, 'utf8'), {
        context, identifier: url.href,
        initializeImportMeta(meta) { meta.url = new URL(url.pathname.split('/dist/')[1], 'http://localhost/').href },
        importModuleDynamically(specifier, referrer) { return evaluate(new URL(specifier, referrer.identifier)) },
      }))())
    }
    return modules.get(url.href)
  }
  async function evaluate(url) {
    if (!loading.has(url.href)) loading.set(url.href, (async () => {
      const module = await getModule(url)
      if (module.status === 'unlinked') await module.link((specifier, referrer) => getModule(new URL(specifier, referrer.identifier)))
      if (module.status === 'linked') await module.evaluate()
      return module
    })())
    return loading.get(url.href)
  }
  async function until(predicate) {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return
      if (errors.length) throw errors[0]
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(predicate(), window.document.body.textContent.slice(-1200))
  }
  function findButton(text) {
    return [...window.document.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  }
  async function openIotUpload() {
    if (!findButton('IoT Data Upload')) {
      findButton('EV91 DB Data').click()
      await until(() => findButton('IoT Data Upload'))
    }
    findButton('IoT Data Upload').click()
  }
  try {
    const entry = window.document.querySelector('script[type="module"]').getAttribute('src')
    await evaluate(new URL(`../dist${entry}`, import.meta.url))
    await until(() => window.document.querySelector('#login-email'))
    assert.equal(window.document.querySelector('aside'), null, 'Dashboard must be gated before login')
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    for (const [id, value] of [['login-email', 'staff@example.com'], ['login-password', 'test-password']]) {
      setValue.call(window.document.getElementById(id), value)
      window.document.getElementById(id).dispatchEvent(new window.Event('input', { bubbles: true }))
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    window.document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    let button
    await until(() => (button = [...window.document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Full Data')))
    button.click()
    await until(() => window.document.querySelector('.full-data-sheet') || window.document.querySelector('[role="alert"]'))
    const alert = window.document.querySelector('[role="alert"]')
    assert.equal(alert, null, alert?.textContent)
    assert.ok(window.document.querySelector('aside'))
    assert.match(window.document.querySelector('.full-data-sheet').textContent, /FleetPro Full Data/)
    await openIotUpload()
    await until(() => window.document.querySelector('#iot-upload-password'))
    assert.ok(window.document.querySelector('.full-data-sheet'), 'Ordinary users must unlock before navigating')
    window.document.querySelector('.iot-password-cancel').click()
    await until(() => !window.document.querySelector('.iot-password-dialog'))
    const ev91Items = [...window.document.querySelectorAll('aside button')].map((node) => node.textContent.trim())
    assert.equal(ev91Items[ev91Items.indexOf('Onboarding Pending') + 1], 'FL Pending')
    findButton('FL Pending').click()
    await until(() => window.document.querySelector('[aria-label="FL rider details"]'))
    assert.match(window.document.querySelector('h1').textContent, /FL Pending/)
    assert.match(window.document.querySelector('[aria-label="FL rider details"]').textContent, /Client ID not in onboarding/)
    assert.equal(window.document.querySelector('[role="alert"]'), null)
    window.location.hash = 'admin'
    await until(() => window.document.querySelector('h1')?.textContent === 'Administrator access required')
    assert.equal(window.document.querySelector('.admin-page'), null)
    dashboardRole = 'admin'
    window.dispatchEvent(new window.Event('focus'))
    await until(() => window.document.querySelector('.admin-page [role="switch"]'))
    assert.equal(window.document.querySelector('#login-settings-tab').getAttribute('aria-selected'), 'true')
    assert.equal(window.document.querySelector('#user-management-panel').hidden, true)
    assert.equal(window.document.querySelector('[role="switch"]').getAttribute('aria-checked'), 'true')
    window.location.hash = 'dashboard'
    await until(() => window.document.querySelector('aside a[href="#admin"]'))
    await openIotUpload()
    await until(() => window.document.querySelector('h1')?.textContent === 'IoT Data Upload')
    assert.equal(window.document.querySelector('.iot-password-dialog'), null, 'Verified admins must skip the upload password')
    assert.ok(window.document.querySelector('input[type="file"]'), 'The upload form must open directly')
    window.location.hash = 'admin'
    await until(() => window.document.querySelector('.admin-page [role="switch"]'))
    window.document.querySelector('[role="switch"]').click()
    await until(() => window.document.querySelector('[aria-label="Confirm public dashboard"]'))
    assert.equal(loginRequired, true, 'Public access requires explicit confirmation')
    ;[...window.document.querySelectorAll('button')].find((node) => node.textContent === 'Confirm disable login').click()
    await until(() => window.document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false')
    window.document.querySelector('.account-menu button').click()
    await until(() => window.document.querySelector('#login-email'))
    assert.match(window.document.body.textContent, /Admin sign in/)
    window.location.hash = 'dashboard'
    await until(() => window.document.querySelector('.public-admin-link'))
    assert.equal(window.document.querySelector('#login-email'), null)
    await openIotUpload()
    await until(() => window.document.querySelector('#iot-upload-password'))
    assert.notEqual(window.document.querySelector('h1')?.textContent, 'IoT Data Upload', 'Signed-out visitors must unlock before navigating')
    window.document.querySelector('.iot-password-cancel').click()
    await until(() => !window.document.querySelector('.iot-password-dialog'))
    window.location.hash = 'admin'
    await until(() => window.document.querySelector('#login-email'))
    assert.equal(window.document.querySelector('.admin-page'), null)
    assert.deepEqual(errors, [])
  } finally { observer.disconnect(); dom.window.close() }
})
