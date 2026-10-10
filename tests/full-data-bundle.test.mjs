import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { SourceTextModule } from 'node:vm'
import { JSDOM, VirtualConsole } from 'jsdom'

test('production dashboard opens Full Data through its real sidebar and lazy module', async () => {
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
  for (const name of ['Response', 'Request', 'Headers', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder']) window[name] = globalThis[name]
  window.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
    if (url.pathname.includes('distinct_order_upload_months')) return Response.json([{ month: 'Jun-2026' }])
    if (url.pathname.endsWith('/order_upload_data')) {
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
      const module = new SourceTextModule(await readFile(url, 'utf8'), {
        context, identifier: url.href,
        initializeImportMeta(meta) { meta.url = new URL(url.pathname.split('/dist/')[1], 'http://localhost/').href },
        importModuleDynamically(specifier, referrer) { return evaluate(new URL(specifier, referrer.identifier)) },
      })
      modules.set(url.href, module)
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
  try {
    const entry = window.document.querySelector('script[type="module"]').getAttribute('src')
    await evaluate(new URL(`../dist${entry}`, import.meta.url))
    let button
    await until(() => (button = [...window.document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Full Data')))
    button.click()
    await until(() => window.document.querySelector('.full-data-sheet') || window.document.querySelector('[role="alert"]'))
    const alert = window.document.querySelector('[role="alert"]')
    assert.equal(alert, null, alert?.textContent)
    assert.ok(window.document.querySelector('aside'))
    assert.match(window.document.querySelector('.full-data-sheet').textContent, /FleetPro Full Data/)
    assert.deepEqual(errors, [])
  } finally { observer.disconnect(); dom.window.close() }
})
