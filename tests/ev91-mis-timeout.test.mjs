import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-tests/ev91-mis-timeout',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'mis-transport-environment', enforce: 'pre', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/lib/ev91MisApi.js')) return
    return code.replaceAll('import.meta.env?.DEV', 'globalThis.__misTestDev')
      .replaceAll('import.meta.env?.VITE_EV91_MIS_PROXY_URL', 'globalThis.__misTestProxy')
  } }],
})
const api = await server.ssrLoadModule('/src/lib/ev91MisApi.js')

beforeEach(() => {
  api.clearEv91AllCache()
  globalThis.__misTestDev = false
  globalThis.__misTestProxy = ''
})
after(async () => {
  await server.close()
  delete globalThis.__misTestDev
  delete globalThis.__misTestProxy
})

function mockTimeouts(t) {
  const controllers = new Map()
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    assert.equal(milliseconds, 30_000)
    const controller = new AbortController()
    controllers.set(controller.signal, controller)
    return controller.signal
  })
  return controllers
}

function abortRequest(controllers, signal, error) {
  assert.ok(controllers.has(signal), 'transport must pass its timeout signal to fetch')
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    controllers.get(signal).abort(error)
  })
}

function success(data = [{ id: 'complete' }], hasMore = false) {
  return Response.json({ success: true, data, pagination: { hasMore } })
}

for (const route of ['local', 'amplify', 'direct-header', 'direct-query', 'absolute-proxy']) {
  for (const phase of ['fetch', 'body']) {
    test(`${route}: a ${phase} timeout stops without retrying another route`, async (t) => {
      const controllers = mockTimeouts(t)
      t.mock.method(console, 'warn', () => {})
      globalThis.__misTestDev = route === 'local'
      if (route === 'absolute-proxy') globalThis.__misTestProxy = 'https://proxy.example.test/api/mis'
      const calls = []
      const failure = new DOMException('Request timed out', 'TimeoutError')
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push(String(url))
        assert.ok(controllers.has(options.signal))
        if (route.startsWith('direct') && String(url).startsWith('/api/ev91/')) return new Response('', { status: 404 })
        if (route === 'direct-query' && options.headers['x-api-key']) throw new TypeError('Failed to fetch')
        if (phase === 'fetch') return abortRequest(controllers, options.signal, failure)
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
          json: () => abortRequest(controllers, options.signal, failure) }
      })
      await assert.rejects(api.fetchEv91MisData('overall-status'), (error) => error === failure)
      assert.equal(calls.length, route === 'direct-query' ? 3 : route === 'direct-header' ? 2 : 1)
      const last = calls.at(-1)
      if (route === 'local') assert.match(last, /^\/api\/ev91-mis\?/)
      else if (route === 'amplify') assert.match(last, /^\/api\/ev91\/overall-status\?/)
      else if (route === 'absolute-proxy') assert.match(last, /^https:\/\/proxy\.example\.test\/api\/mis\?/)
      else assert.match(last, /^https:\/\/dashboard\.ev91riderz\.com\//)
    })
  }
}

test('body AbortError remains an abort and cannot become a route fallback', async (t) => {
  const controllers = mockTimeouts(t)
  globalThis.__misTestDev = true
  const failure = new DOMException('The operation was aborted', 'AbortError')
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, { signal }) => ({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    json: () => abortRequest(controllers, signal, failure),
  }))
  await assert.rejects(api.fetchEv91MisData('client-mapping-history'), (error) => error === failure)
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('a timed-out later page rejects shared callers, clears inflight state and never caches partial history', async (t) => {
  const controllers = mockTimeouts(t)
  const failure = new DOMException('Request timed out', 'TimeoutError')
  const offsets = []
  let fail = true
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    assert.ok(controllers.has(signal))
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'))
    offsets.push(offset)
    if (fail && offset === 1) return {
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: () => abortRequest(controllers, signal, failure),
    }
    return success([{ id: `${fail ? 'partial' : 'retry'}-${offset}` }], offset === 0)
  })
  const results = await Promise.allSettled([
    api.fetchAllEv91MisData('overall-status'),
    api.fetchAllEv91MisData('overall-status'),
  ])
  for (const result of results) {
    assert.equal(result.status, 'rejected')
    assert.equal(result.reason, failure)
  }
  assert.deepEqual(offsets, [0, 1])
  fail = false
  const retried = await api.fetchAllEv91MisData('overall-status')
  assert.deepEqual(retried.data, [{ id: 'retry-0' }, { id: 'retry-1' }])
  assert.deepEqual(offsets, [0, 1, 0, 1])
  assert.equal(await api.fetchAllEv91MisData('overall-status'), retried)
  assert.deepEqual(offsets, [0, 1, 0, 1], 'a completed retry should reuse the normal full-history cache')
})

test('ordinary unavailable routes still fall back through local, Amplify and direct query authentication', async (t) => {
  const controllers = mockTimeouts(t)
  t.mock.method(console, 'warn', () => {})
  globalThis.__misTestDev = true
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(String(url))
    assert.ok(controllers.has(options.signal))
    if (String(url).startsWith('/api/ev91-mis')) return new Response('', { status: 404 })
    if (String(url).startsWith('/api/ev91/')) return new Response('<html/>', { headers: { 'content-type': 'text/html' } })
    if (options.headers['x-api-key']) throw new TypeError('Failed to fetch')
    assert.ok(new URL(url).searchParams.has('api_key'))
    return success()
  })
  assert.deepEqual((await api.fetchEv91MisData('overall-status')).data, [{ id: 'complete' }])
  assert.equal(calls.length, 4)
})

for (const failure of ['empty-page', 'page-limit']) {
  test(`${failure}: incomplete MIS history rejects and is never cached as complete`, async (t) => {
    mockTimeouts(t)
    let incomplete = true
    const offsets = []
    t.mock.method(globalThis, 'fetch', async (url) => {
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'))
      offsets.push(offset)
      if (!incomplete) return success([{ id: 'complete' }])
      return success(failure === 'empty-page' && offset === 1 ? [] : [{ id: `row-${offset}` }], true)
    })
    await assert.rejects(api.fetchAllEv91MisData('overall-status'), { code: 'INCOMPLETE_HISTORY' })
    assert.equal(offsets.length, failure === 'empty-page' ? 2 : 50)
    incomplete = false
    const complete = await api.fetchAllEv91MisData('overall-status')
    assert.deepEqual(complete.data, [{ id: 'complete' }])
    assert.equal(offsets.at(-1), 0)
    const before = offsets.length
    assert.equal(await api.fetchAllEv91MisData('overall-status'), complete)
    assert.equal(offsets.length, before)
  })
}
