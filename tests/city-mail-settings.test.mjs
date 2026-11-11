import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { PGlite } from '@electric-sql/pglite'
import { emailList, scheduleDue, scheduleTime } from '../src/lib/cityMailSettings.js'

test('CC validation, deduplication and 12-hour conversion', () => {
  assert.equal(emailList(' Boss@example.com,other@example.com, boss@example.com '), 'boss@example.com,other@example.com')
  assert.equal(emailList(''), '')
  assert.throws(() => emailList('', true))
  assert.throws(() => emailList('boss@example.com\r\nBcc: attacker@example.com'))
  assert.throws(() => emailList('bad,good@example.com'))
  assert.equal(scheduleTime('12', '05', 'AM'), '00:05')
  assert.equal(scheduleTime('12', '05', 'PM'), '12:05')
  assert.equal(scheduleTime('9', '30', 'PM'), '21:30')
  assert.throws(() => scheduleTime('0', '30', 'PM'))
})

test('scheduler uses IST weekday, same-day catch-up and creation/edit time', () => {
  const row = { is_active: true, day_of_week: 5, send_time: '09:00:00', created_at: '2026-11-05T00:00:00Z' }
  assert.equal(scheduleDue(row, new Date('2026-11-06T03:29:00Z')), false)
  assert.equal(scheduleDue(row, new Date('2026-11-06T03:30:00Z')), true)
  assert.equal(scheduleDue(row, new Date('2026-11-06T12:30:00Z')), true)
  assert.equal(scheduleDue(row, new Date('2026-11-07T03:30:00Z')), false)
  assert.equal(scheduleDue({ ...row, day_of_week: null }, new Date('2026-11-07T03:30:00Z')), true)
  assert.equal(scheduleDue({ ...row, is_active: false }, new Date('2026-11-06T03:30:00Z')), false)
  assert.equal(scheduleDue({ ...row, updated_at: '2026-11-06T04:00:00Z' }, new Date('2026-11-06T05:00:00Z')), false)
})

test('city schema is rerunnable; admin-only contacts/schedules; service-only durable run claims', async (t) => {
  const db = await PGlite.create(); t.after(() => db.close())
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth, public to authenticated, service_role, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.dashboard_users (id uuid, role text);
    insert into public.dashboard_users values ('00000000-0000-0000-0000-000000000001', 'admin');`)
  const sql = await readFile(new URL('../sql/create_city_mail_settings.sql', import.meta.url), 'utf8')
  await db.exec(sql); await db.exec(sql)
  await db.exec("select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false); set role authenticated")
  await db.exec("insert into city_mail_contacts(city,name,email_id,cc) values ('Chennai','City head','head@example.com','one@example.com, two@example.com')")
  await assert.rejects(db.exec("insert into city_mail_contacts(city,name,email_id,cc) values ('Delhi','City head','head@example.com','invalid')"), /check constraint/)
  await db.exec("insert into client_period_mail_schedules(contact_id,day_of_week,send_time) values (1,5,'09:00')")
  await assert.rejects(db.exec("insert into client_period_mail_schedules(contact_id,day_of_week,send_time) values (1,5,'09:00')"), /unique constraint/)
  await assert.rejects(db.exec("insert into client_period_mail_runs(schedule_id,run_date,status) values (1,'2026-11-06','sent')"), /permission denied/)
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false); set role authenticated")
  assert.equal((await db.query('select * from city_mail_contacts')).rows.length, 0)
  assert.equal((await db.query('update client_period_mail_schedules set is_active=false returning id')).rows.length, 0)
  await assert.rejects(db.exec("insert into city_mail_contacts(city,name,email_id) values ('Delhi','Staff','staff@example.com')"), /row-level security/)
  await db.exec('reset role; set role service_role')
  await db.exec("insert into client_period_mail_runs(schedule_id,run_date,status) values (1,'2026-11-06','preparing')")
  await assert.rejects(db.exec("insert into client_period_mail_runs(schedule_id,run_date,status) values (1,'2026-11-06','preparing')"), /unique constraint/)
  await db.exec('reset role; set role anon')
  await assert.rejects(db.exec('select * from city_mail_contacts'), /permission denied/)
})

const bundle = await readFile(new URL('../scripts/client-period-mailer-appscript.gs', import.meta.url), 'utf8')
function runner({ sendError = false, quota = 10, changed = false, prepareError = false } = {}) {
  const runs = [], sent = []
  const instant = new Date('2026-11-06T03:31:00Z').getTime()
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])) } static now() { return instant } }
  const context = vm.createContext({ Date: Clock, Set,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { getRemainingDailyQuota: () => quota, sendEmail: (mail) => { if (sendError) throw new Error('Acceptance unknown'); sent.push(mail) } },
  })
  vm.runInContext(bundle, context)
  const schedule = { id: 1, contact_id: 1, is_active: true, day_of_week: 5, send_time: '09:00:00', created_at: '2026-11-05T00:00:00Z', updated_at: '2026-11-05T00:00:00Z' }
  const contact = { id: 1, city: 'Chennai', email_id: 'head@example.com', cc: 'one@example.com, two@example.com' }
  context.clientPeriodDbRows_ = (table) => table === 'city_mail_contacts' ? [contact] : [schedule]
  context.clientPeriodDbRequest_ = (path, method, payload) => {
    if (method === 'post') { if (runs.length) return null; runs.push({ id: 1, ...payload }); return runs }
    if (method === 'patch') {
      if (path.includes('&status=eq.failed') && runs[0]?.status !== 'failed') return []
      Object.assign(runs[0], payload); return runs
    }
    if (path.startsWith('city_mail_contacts')) return [contact]
    return [{ ...schedule, is_active: !changed }]
  }
  context.clientPeriodScheduledReport_ = () => { if (prepareError) throw new Error('Incomplete scan'); return { city: 'Chennai', mode: 'both', toDate: '2026-11-06' } }
  context.clientPeriodMailContent_ = () => ({ html: 'all eight tables', inlineImages: {} })
  return { context, runs, sent }
}

test('scheduled mail uses saved To/CC once, independent of browser and manual test limit', () => {
  const state = runner(); state.context.runClientPeriodSchedules(); state.context.runClientPeriodSchedules()
  assert.equal(state.sent.length, 1)
  assert.equal(state.sent[0].to, 'head@example.com')
  assert.equal(state.sent[0].cc, 'one@example.com,two@example.com')
  assert.equal(state.runs[0].status, 'sent')
})

test('quota, preparation failure, changed settings and uncertain acceptance cannot cause repeat sends', () => {
  for (const options of [{ quota: 1 }, { changed: true }, { prepareError: true }, { sendError: true }]) {
    const state = runner(options); state.context.runClientPeriodSchedules(); state.context.runClientPeriodSchedules()
    assert.equal(state.sent.length, 0)
    assert.equal(state.runs[0].status, options.sendError ? 'uncertain' : 'failed')
  }
})

test('mail sparklines omit the partial month and week but retain their table values', () => {
  const context = vm.createContext({}); vm.runInContext(bundle, context)
  const core = context.ClientPeriodMailCore
  const payment = { id: 1, rider_id: 'A', city: 'Chennai', client_name: 'Client', source_name: 'Alpha', month: 'Nov-2026', week: '4526', period_start: '2026-11-02', gross_payout: 98765 }
  for (const mode of ['weekly', 'monthly']) {
    const report = core.buildClientPeriodMailReport({ payments: [payment], onboarding: [], sourceIndex: core.buildSourceMasterIndex([{ city: 'Chennai', source_name: 'Alpha', is_active: true }]), city: 'Chennai', mode, today: '2026-11-06' })
    const html = core.renderClientPeriodMailHtml(report)
    assert.ok(html.includes('98,765'))
    assert.ok(html.includes(report.periods.at(-1).label))
    const trends = [...html.matchAll(/alt="Line trend, oldest to newest: ([^"]*)"/g)]
    assert.ok(trends.length)
    assert.ok(trends.every((match) => !match[1].includes('98765') && match[1].split(', ').length === report.periods.length - 1))
  }
})

test('manual retry recovers failed preparation without retrying accepted or uncertain emails', () => {
  const state = runner({ prepareError: true })
  state.context.runClientPeriodSchedules()
  assert.equal(state.runs[0].status, 'failed')
  state.context.clientPeriodScheduledReport_ = () => ({ city: 'Chennai', mode: 'both', toDate: '2026-11-06' })
  state.context.runClientPeriodSchedules()
  assert.equal(state.sent.length, 0)
  state.context.retryFailedClientPeriodSchedules()
  assert.equal(state.runs[0].status, 'sent')
  assert.equal(state.sent.length, 1)
  state.context.retryFailedClientPeriodSchedules()
  assert.equal(state.sent.length, 1)
  const uncertain = runner({ sendError: true })
  uncertain.context.runClientPeriodSchedules()
  uncertain.context.retryFailedClientPeriodSchedules()
  assert.equal(uncertain.runs[0].status, 'uncertain')
})

test('database errors name missing columns without leaking response values or credentials', () => {
  let body = { code: '42703', message: 'column rider_onboarding.rider_id does not exist' }
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === 'SUPABASE_URL' ? 'https://test.supabase.co' : 'private-key' }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 400, getContentText: () => JSON.stringify(body) }) },
  })
  vm.runInContext(bundle, context)
  assert.throws(() => context.clientPeriodDbRequest_('rider_onboarding?select=rider_id'), /400.*rider_onboarding.*42703.*column rider_onboarding.rider_id does not exist/)
  body = { code: '23514', message: 'Secret rider payment value', details: 'private-key' }
  assert.throws(() => context.clientPeriodDbRequest_('rider_payment_data?select=id'), (error) => !error.message.includes('Secret rider') && !error.message.includes('private-key'))
})

test('scheduled report fetches complete capped pages and preserves accounting-month/source rules', () => {
  const context = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) } })
  vm.runInContext(bundle, context)
  const rows = [
    { id: 1, rider_id: 'R1', city: 'Chennai', client_name: 'Client', source_name: 'Unlisted', month: 'Nov-2026', week: '4526', period_start: '2026-11-02', gross_payout: 100 },
    { id: 2, rider_id: 'R1', city: 'Chennai', client_name: 'Client', source_name: 'Unlisted', month: 'Mar-2026', week: '1026', period_start: '2026-03-02', gross_payout: 300 },
  ]
  context.clientPeriodDbRequest_ = (path, _method, params) => {
    if (path.startsWith('rpc/client_period_mail_payment_page')) {
      assert.ok(params.p_city_keys.includes('chennai'))
      let selected = rows.filter((row) => params.p_month ? row.month === params.p_month : row.period_start >= params.p_from && row.period_start <= params.p_to)
      selected.sort((a, b) => params.p_month ? a.id - b.id : a.period_start.localeCompare(b.period_start) || a.id - b.id)
      if (params.p_after_id) selected = selected.filter((row) => params.p_month ? row.id > Number(params.p_after_id) : row.period_start > params.p_after_period || row.period_start === params.p_after_period && row.id > Number(params.p_after_id))
      return selected.slice(0, 1)
    }
    if (path.startsWith('rpc/')) return [{ month: 'Mar-2026' }, { month: 'Nov-2026' }]
    const url = new URL('https://db.example/' + path), cursor = Number((url.searchParams.get('id') || 'gt.0').slice(3))
    if (url.pathname.includes('rider_onboarding')) assert.ok(['*', 'id,rider_id_details,source_name'].includes(url.searchParams.get('select')), 'only discovered onboarding fields may be requested')
    let data = url.pathname.includes('source_master') ? [{ id: 1, city: 'Chennai', source_name: 'Alpha', is_active: true }]
      : url.pathname.includes('rider_onboarding') ? [{ id: 1, rider_id_details: 'R1', source_name: 'Alpha' }] : rows
    data = data.filter((row) => row.id > cursor)
    const month = url.searchParams.get('month')
    if (month) data = data.filter((row) => row.month === month.slice(3))
    if (url.searchParams.has('period_start')) {
      data = data.filter((row) => row.period_start >= url.searchParams.get('period_start').slice(4))
      const after = url.searchParams.get('or')?.match(/period_start\.gt\.([\d-]+),and\(period_start\.eq\.[\d-]+,id\.gt\.(\d+)/)
      if (after) data = data.filter((row) => row.period_start > after[1] || row.period_start === after[1] && row.id > Number(after[2]))
      data.sort((a, b) => a.period_start.localeCompare(b.period_start) || a.id - b.id)
    }
    return data.slice(0, 1) // Simulate a server cap below requested page size.
  }
  const report = context.clientPeriodScheduledReport_('Chennai', '2026-11-06', Date.now() + 30000)
  assert.match(report.logo, /^data:image\/jpeg;base64,/)
  assert.ok(report.logo.length < 70000)
  const sum = (table) => table.rows.reduce((total, row) => total + row.values.reduce((a, b) => a + b, 0), 0)
  assert.equal(report.reports[0].paymentRowCount, 1)
  assert.equal(report.reports[1].paymentRowCount, 2)
  assert.equal(sum(report.reports[1].tables[0]), 400)
  assert.equal(sum(report.reports[1].tables[3]), 400)
  assert.equal(report.reports[1].tables[2].rows[0].name, 'Alpha')
})

test('city payment RPC restricts rows to aliases and preserves complete monthly/date cursor pages', async (t) => {
  const db = await PGlite.create(); t.after(() => db.close())
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to service_role, anon, authenticated;
    create table public.rider_payment_data(id bigint primary key, city text, month text, period_start text);
    grant select on public.rider_payment_data to service_role;
    insert into public.rider_payment_data values
      (900,'Hyderabad','Oct-2026','2026-10-26'), (2,' HYD ','Nov-2026','2026-11-02'),
      (3,'hyd','Nov-2026','2026-11-02'), (4,'Chennai','Nov-2026','2026-11-02'),
      (5,'Hyderabad','Mar-2026',null);`)
  const sql = await readFile(new URL('../sql/create_client_period_mail_payment_page.sql', import.meta.url), 'utf8')
  await db.exec(sql); await db.exec(sql)
  await db.exec('set role service_role')
  const query = 'select * from public.client_period_mail_payment_page($1,$2,$3,$4,$5,$6,$7)'
  const first = (await db.query(query, [['hyderabad', 'hyd'], '2026-08-31', '2026-11-06', null, null, null, 1])).rows
  assert.equal(Number(first[0].id), 900)
  const second = (await db.query(query, [['hyderabad', 'hyd'], '2026-08-31', '2026-11-06', null, first[0].period_start, first[0].id, 10])).rows
  assert.deepEqual(second.map((row) => Number(row.id)), [2, 3])
  const monthly = (await db.query(query, [['hyderabad', 'hyd'], null, null, 'Mar-2026', null, null, 10])).rows
  assert.equal(Number(monthly[0].id), 5)
  await db.exec('reset role; set role authenticated')
  await assert.rejects(db.query(query, [['hyderabad'], null, null, 'Nov-2026', null, null, 10]), /permission denied/)
})

test('city RPC timeout shrinks pages and missing installation gives a precise setup error', () => {
  const context = vm.createContext({}); vm.runInContext(bundle, context)
  const limits = []
  context.clientPeriodDbRequest_ = (_path, _method, params) => {
    limits.push(params.p_limit)
    if (params.p_limit > 125) { const error = new Error('Timeout'); error.code = '57014'; throw error }
    return []
  }
  context.clientPeriodCityPayments_('Hyderabad', 'id', { month: 'Nov-2026' }, Date.now() + 30000)
  assert.deepEqual(limits, [500, 250, 125])
  context.clientPeriodDbRequest_ = () => { const error = new Error('Not found'); error.code = 'PGRST202'; throw error }
  assert.throws(() => context.clientPeriodCityPayments_('Hyderabad', 'id', { month: 'Nov-2026' }, Date.now() + 30000), /create_client_period_mail_payment_page.sql/)
})

test('payment range scan follows date/id index, shrinks timed-out pages, and retains out-of-order IDs', () => {
  const context = vm.createContext({}); vm.runInContext(bundle, context)
  const rows = [{ id: 900, period_start: '2026-10-26' }, { id: 2, period_start: '2026-11-02' }, { id: 3, period_start: '2026-11-02' }]
  const limits = []
  context.clientPeriodDbRequest_ = (path) => {
    const url = new URL('https://db.example/' + path)
    assert.equal(url.searchParams.get('order'), 'period_start.asc,id.asc')
    assert.equal(url.searchParams.get('id'), null)
    const size = Number(url.searchParams.get('limit')); limits.push(size)
    if (size > 125) { const error = new Error('Query canceled'); error.code = '57014'; throw error }
    const lower = url.searchParams.getAll('period_start')[0].slice(4)
    const after = url.searchParams.get('or')?.match(/period_start\.gt\.([\d-]+),and\(period_start\.eq\.[\d-]+,id\.gt\.(\d+)/)
    return rows.filter((row) => row.period_start >= lower && (!after || row.period_start > after[1] || row.period_start === after[1] && row.id > Number(after[2]))).slice(0, 1)
  }
  const result = context.clientPeriodDbRows_('rider_payment_data', 'id,period_start', '', Date.now() + 30000, { fromDate: '2026-08-31', toDate: '2026-11-06' })
  assert.deepEqual(Array.from(result, (row) => row.id), [900, 2, 3])
  assert.deepEqual(limits.slice(0, 3), [500, 250, 125])
})

test('payment timeout at minimum page size fails instead of publishing partial totals', () => {
  const context = vm.createContext({}); vm.runInContext(bundle, context)
  let requests = 0
  context.clientPeriodDbRequest_ = () => { requests++; const error = new Error('Query canceled'); error.code = '57014'; throw error }
  assert.throws(() => context.clientPeriodDbRows_('rider_payment_data', 'id', 'month=eq.Nov-2026', Date.now() + 30000), /Query canceled/)
  assert.equal(requests, 4)
})
