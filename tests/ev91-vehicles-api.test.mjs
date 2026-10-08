import assert from 'node:assert/strict'
import { test } from 'node:test'

let moduleVersion = 0
const loadApi = () => import(`../src/lib/ev91VehiclesApi.js?test=${++moduleVersion}`)
const json = (body, status = 200) => Response.json(body, { status })
const pageBody = (page, totalPages = 7) => ({
  success: true,
  vehicles: [{ id: `ev91-${page}`, registrationNumber: `TN22EB${page}` }],
  pagination: { totalPages, totalItems: totalPages, hasNextPage: page < totalPages },
})

test('all inventory pages are loaded with bounded concurrency and repeat uploads reuse the cache', async (t) => {
  const api = await loadApi()
  const calls = []
  let active = 0
  let peak = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    const params = new URL(url, 'http://localhost').searchParams
    assert.equal(params.get('limit'), '100')
    assert.equal(params.has('search'), false)
    const page = Number(params.get('page'))
    calls.push(page)
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active--
    return json(pageBody(page))
  })
  const [first, simultaneous] = await Promise.all([api.fetchAllEv91Vehicles(), api.fetchAllEv91Vehicles()])
  assert.equal(first, simultaneous)
  assert.deepEqual(calls, [1, 2, 3, 4, 5, 6, 7])
  assert.equal(peak, 4)
  assert.equal(first.at(-1).registrationNumber, 'TN22EB7')
  assert.equal(await api.fetchAllEv91Vehicles(), first)
  assert.equal(calls.length, 7)
  await api.fetchAllEv91Vehicles({ force: true })
  assert.equal(calls.length, 14)
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 5 * 60 * 1000 + 1)
  await api.fetchAllEv91Vehicles()
  assert.equal(calls.length, 21)
})

test('failed pages are not cached and the next attempt reloads a complete inventory', async (t) => {
  const api = await loadApi()
  let fail = true
  let firstPageCalls = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    if (page === 1) firstPageCalls++
    if (page === 2 && fail) return json({ message: 'Upstream unavailable' }, 502)
    return json(pageBody(page, 2))
  })
  await assert.rejects(api.fetchAllEv91Vehicles(), /Upstream unavailable/)
  fail = false
  assert.equal((await api.fetchAllEv91Vehicles()).length, 2)
  assert.equal(firstPageCalls, 2)
})

test('hasNextPage pagination works when totalPages is absent', async (t) => {
  const api = await loadApi()
  t.mock.method(globalThis, 'fetch', async (url) => {
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    const body = pageBody(page, 3)
    delete body.pagination.totalPages
    return json(body)
  })
  assert.equal((await api.fetchAllEv91Vehicles()).length, 3)
})

test('HTML, empty inventories, and incomplete inventories stop upload preparation', async (t) => {
  let response
  t.mock.method(globalThis, 'fetch', async () => response())
  for (const [makeResponse, expected] of [
    [() => new Response('<html/>', { headers: { 'content-type': 'text/html' } }), /rewrite/],
    [() => json({ success: true, vehicles: [], pagination: { totalPages: 1, totalItems: 0 } }), /no vehicles/],
    [() => json({ success: true, vehicles: [{}], pagination: { totalPages: 1, totalItems: 2 } }), /incomplete/],
    [() => json({ success: true, vehicles: [], pagination: { totalPages: 2 } }), /incomplete/],
  ]) {
    response = makeResponse
    const api = await loadApi()
    await assert.rejects(api.fetchAllEv91Vehicles(), expected)
  }
})
