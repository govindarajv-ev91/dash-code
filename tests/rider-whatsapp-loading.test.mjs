import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const state = globalThis.__whatsappLoading = { queries: [], contacts: [], pages: [], failure: null, mapping: [] }
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/rider-whatsapp-loading',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'whatsapp-loading-fixtures', enforce: 'pre', transform(_code, id) {
    const path = id.replaceAll('\\', '/')
    if (path.endsWith('/lib/ev91MisApi.js')) return `export async function fetchAllEv91MisData(endpoint) { globalThis.__whatsappLoading.mapping.push(endpoint); return { data: [] }; }`
    if (path.endsWith('/lib/supabaseClient.js')) return `export const supabase = { from(table) {
      const calls = [['from', table]];
      const query = {};
      for (const method of ['select', 'eq', 'is', 'gt', 'order', 'limit', 'or', 'range']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
      query.calls = calls; return query;
    }, rpc(name) { return this.from(name); } };`
    if (path.endsWith('/lib/supabaseFetch.js')) return `
      export async function readSupabasePage(query, label, timeout, signal) {
        globalThis.__whatsappLoading.queries.push({ calls: query.calls, timeout, signal });
        if (globalThis.__whatsappLoading.failure) return { error: globalThis.__whatsappLoading.failure, data: null };
        return { data: globalThis.__whatsappLoading.pages.shift() || [], error: null };
      }
      export async function fetchAllData(table, columns, order, options) {
        if (!options.queryModifier) {
          globalThis.__whatsappLoading.contacts.push({ table, columns, options });
          return { data: [{ id: 1, week: '4626', month: 'Nov-26', period_start: '2026-11-09' }] };
        }
        let filter;
        options.queryModifier({ in(field, ids) { filter = { field, ids }; return this; } });
        globalThis.__whatsappLoading.contacts.push({ table, columns, filter, options });
        return { data: table === 'rider_onboarding' && filter.field === 'rider_id_details' ? [{ rider_id_details: 'R1', rider_mobile_number: '9876543210' }] : [] };
      }`
  } }],
})
const { loadWhatsappPaymentData, loadWhatsappWeekOptions } = await server.ssrLoadModule('/src/lib/riderWhatsappData.js')
after(async () => { await server.close(); delete globalThis.__whatsappLoading })

test('no request runs until a valid week is selected', async () => {
  await assert.rejects(loadWhatsappPaymentData(), /Select a valid payment week/)
  assert.equal(state.queries.length, 0)
  assert.equal(state.contacts.length, 0)
})

test('payments are week scoped, short pages continue, and contacts target only paid riders', async () => {
  state.pages = [
    [{ id: 1, rider_id: 'R1', period_start: '2026-11-09', payment_status: 'Released' }],
    [{ id: 2, rider_id: 'R2', period_start: '2026-11-10', payment_status: 'Released' }, { id: 3, rider_id: 'R3', period_start: '2026-11-10', payment_status: 'Pending' }],
    [],
  ]
  const signal = new AbortController().signal
  const data = await loadWhatsappPaymentData({ week: '["4626","Nov-26"]', signal })
  assert.equal(data.payments.length, 3)
  assert.equal(state.queries.length, 3)
  for (const query of state.queries) {
    assert.ok(query.calls.some(([method, column, value]) => method === 'eq' && column === 'week' && value === '4626'))
    assert.ok(query.calls.some(([method, column, value]) => method === 'eq' && column === 'month' && value === 'Nov-26'))
    assert.equal(query.timeout, 15000)
    assert.equal(query.signal, signal)
  }
  assert.deepEqual(state.contacts[0].filter, { field: 'rider_id_details', ids: ['R1', 'R2'] })
  const fleetQueries = state.contacts.filter((query) => query.table !== 'rider_onboarding')
  assert.equal(fleetQueries.length, 2)
  for (const query of fleetQueries) assert.deepEqual(query.filter, { field: 'rider_id', ids: ['R2'] })
  assert.deepEqual(state.mapping, ['client-mapping-history'])
})

test('payment failures do not turn into empty reports or trigger contact scans', async () => {
  state.contacts = []
  state.failure = new Error('Request timed out')
  await assert.rejects(loadWhatsappPaymentData({ week: '["4626","Nov-26"]' }), /Request timed out/)
  assert.equal(state.contacts.length, 0)
})

test('dropdown queries only week metadata and continues past capped RPC pages', async () => {
  state.failure = null
  state.queries = []
  state.contacts = []
  state.pages = [[{ week: '4626', month: 'Nov-26', period_start: '2026-11-09' }], [{ week: 'Advance', month: 'Oct-26', period_start: '2026-10-01' }], []]
  const rows = await loadWhatsappWeekOptions()
  assert.deepEqual(rows.map((row) => row.label), ['4626 · Nov-26', 'Advance · Oct-26'])
  assert.equal(state.queries.length, 3)
  assert.ok(state.queries.every((query) => query.calls[0][1] === 'rider_whatsapp_payment_weeks'))
  assert.equal(state.contacts.length, 0)
})

test('week dropdown SQL returns distinct uploaded values and respects row access', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.rider_payment_data(id bigint, week text, month text, period_start text);
      insert into public.rider_payment_data values (1, '4626', 'Nov-26', '2026-11-09'),
        (2, '4626', 'Nov-26', '2026-11-10'), (3, 'Advance', 'Nov-26', null), (4, '', 'Nov-26', null);`)
    await db.exec(await readFile(new URL('../sql/create_rider_whatsapp_payment_weeks.sql', import.meta.url), 'utf8'))
    const result = await db.query('select * from public.rider_whatsapp_payment_weeks() order by week')
    assert.deepEqual(result.rows.map((row) => row.week), ['4626', 'Advance'])
    assert.equal(result.rows[0].period_start, '2026-11-10')
    await db.exec(`insert into public.rider_payment_data values
      (5, '4626', null, null), (6, '4626', '', null), (7, '   ', 'Nov-26', null);`)
    const months = await db.query("select month from public.rider_whatsapp_payment_weeks() where week = '4626' order by month nulls first")
    assert.deepEqual(months.rows.map((row) => row.month), [null, '', 'Nov-26'])
    await db.exec(`grant select on public.rider_payment_data to authenticated;
      alter table public.rider_payment_data enable row level security;
      create policy visible_week on public.rider_payment_data for select to authenticated using (week = '4626');
      set role authenticated;`)
    const restricted = await db.query('select * from public.rider_whatsapp_payment_weeks()')
    assert.deepEqual([...new Set(restricted.rows.map((row) => row.week))], ['4626'])
    await db.exec(`reset role; grant select on public.rider_payment_data to anon;
      create policy anon_visible_week on public.rider_payment_data for select to anon using (week = 'Advance');
      set role anon;`)
    const anonymous = await db.query('select * from public.rider_whatsapp_payment_weeks()')
    assert.deepEqual(anonymous.rows.map((row) => row.week), ['Advance'])
  } finally { await db.close() }
})

test('function permission errors fall back to table reads without changing access', async () => {
  state.contacts = []
  state.failure = { code: '42501', message: 'permission denied for function rider_whatsapp_payment_weeks' }
  const options = await loadWhatsappWeekOptions()
  assert.equal(options[0].label, '4626 · Nov-26')
  assert.equal(state.contacts[0].table, 'rider_payment_data')
  assert.equal(state.contacts[0].options.throwOnError, true)
  state.failure = { code: '42501', message: 'permission denied for table rider_payment_data' }
  await assert.rejects(loadWhatsappWeekOptions(), (error) => error === state.failure)
})

test('statement and request timeouts use the bounded metadata fallback', async () => {
  for (const code of ['57014', 'REQUEST_TIMEOUT']) {
    state.contacts = []
    state.failure = { code, message: 'canceling statement due to statement timeout' }
    const options = await loadWhatsappWeekOptions()
    assert.equal(options[0].label, '4626 · Nov-26')
    assert.equal(state.contacts[0].columns, 'id,week,month,period_start')
    assert.equal(state.contacts[0].options.requestTimeoutMs, 15000)
  }
})
