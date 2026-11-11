import { inflateSync } from 'node:zlib'
import { clientPeriodSparklinePng } from '../src/lib/clientPeriodMailSparkline.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { buildSourceMasterIndex } from '../src/lib/sourceMaster.js'
import { sendClientPeriodTestMail } from '../src/lib/clientPeriodMailTransport.js'

const code = await readFile(new URL('../scripts/client-period-mailer-appscript.gs', import.meta.url), 'utf8')
const core = vm.runInNewContext(code + '\nClientPeriodMailCore;')
const now = '2026-11-05'
const payment = (id, overrides = {}) => ({ id, rider_id: 'FE123456', rider_name: 'Test Rider', city: 'Bangalore', client_name: 'Blinkit',
  source_name: 'Alpha', month: 'Oct-2026', week: '4426', period_start: '2026-10-26', gross_payout: 100, ...overrides })
const sources = buildSourceMasterIndex([{ city: 'Bangalore', source_name: 'Alpha', is_active: true },
  { city: 'Bangalore', source_name: 'Inactive', is_active: false }, { city: 'Chennai', source_name: 'Other City', is_active: true }])
const build = (payments, mode = 'weekly', more = {}) => core.buildClientPeriodMailReport({ payments, mode, city: 'Bengaluru',
  onboarding: [], sourceIndex: sources, today: now, ...more })
const sum = (table) => table.rows.reduce((total, row) => total + row.values.reduce((a, b) => a + b, 0), 0)

test('weekly report isolates one canonical city and its active sources, while client revenue includes every source', () => {
  const report = build([payment(1), payment(2), payment(3, { city: 'BLR', rider_id: 'SECOND', source_name: 'Inactive', gross_payout: 50 }),
    payment(4, { city: 'Chennai', gross_payout: 900 }), payment(5, { period_start: '2026-08-24', gross_payout: 1000 }),
    payment(6, { period_start: '2026-11-09', gross_payout: 1000 })])
  assert.equal(report.city, 'Bengaluru')
  assert.equal(report.fromDate, '2026-08-31')
  assert.equal(report.periods.length, 10)
  assert.equal(report.periods.at(-1).start, '2026-11-02')
  assert.equal(report.periods.at(-1).isPartial, true)
  assert.equal(sum(report.tables[0]), 250)
  assert.equal(sum(report.tables[1]), 1)
  assert.equal(sum(report.tables[2]), 1)
  assert.equal(sum(report.tables[3]), 200)
  assert.deepEqual(Array.from(report.tables[2].rows, (row) => row.name), ['Alpha'])
})

test('monthly report uses full accounting months from March, deduplicates weeks and resolves onboarding sources', () => {
  const report = build([payment(1, { period_start: '2026-03-02', month: 'Mar-2026', week: '1026', source_name: 'Old' }),
    payment(2, { period_start: '2026-03-30', month: 'Mar-2026', week: '1426', source_name: 'Old' }),
    payment(3, { month: 'Feb-2026', source_name: 'Old' }), payment(4, { month: 'Dec-2026', source_name: 'Old' })], 'monthly',
  { onboarding: [{ rider_id_details: 'FE123456', source_name: 'Alpha' }] })
  assert.equal(report.periods.length, 9)
  assert.equal(report.periods[0].label, 'Mar 2026')
  assert.equal(report.periods.at(-1).label, 'Nov 2026')
  assert.equal(sum(report.tables[0]), 200)
  assert.equal(sum(report.tables[1]), 1)
  assert.equal(sum(report.tables[2]), 1)
  assert.equal(sum(report.tables[3]), 200)
})

test('HTML renders all four tables, numeric totals and safely escaped names', () => {
  const report = build([payment(1, { client_name: '<img src=x onerror=alert(1)>' })])
  const html = core.renderClientPeriodMailHtml(report)
  for (const title of core.MAIL_TABLE_TITLES) assert.ok(html.includes(title))
  assert.equal((html.match(/<table /g) || []).length, 4)
  assert.ok(html.includes('&lt;img'))
  assert.ok(!html.includes('<img src=x onerror='))
  assert.ok(html.includes('Bengaluru'))
  assert.ok(!html.includes('Chennai'))
  assert.throws(() => build([payment(1)], 'weekly', { city: 'All' }), /one city/)
})

test('combined mail has eight ranked tables, section buttons, heatmap and trend bars', () => {
  const rows = [payment(1, { client_name: 'Small', gross_payout: 10 }),
    payment(2, { client_name: 'Large', gross_payout: 100 }),
    payment(3, { client_name: 'Middle', gross_payout: 55 })]
  const report = { version: 1, city: 'Bengaluru', mode: 'both', toDate: now,
    reports: [build(rows), build(rows, 'monthly')] }
  const original = JSON.stringify(report)
  const html = core.renderClientPeriodMailHtml(report)
  assert.equal((html.match(/<table /g) || []).length, 8)
  assert.equal((html.match(/Hi Team,/g) || []).length, 1)
  assert.equal((html.match(/Please find the/g) || []).length, 1)
  assert.ok(html.includes('summary for 2026-03-30 through 2026-11-05.'))
  assert.ok(!html.includes('(IST)'))
  assert.ok(html.includes('href="#weekly"') && html.includes('id="monthly"'))
  assert.ok(html.indexOf('>Large</td>') < html.indexOf('>Middle</td>'))
  assert.ok(html.indexOf('>Middle</td>') < html.indexOf('>Small</td>'))
  for (const color of ['#f87171', '#facc15', '#4ade80']) assert.ok(html.includes(color))
  assert.equal((html.match(/>Trend<\/th>/g) || []).length, 8)
  assert.match(html, /data:image\/png;base64,/)
  assert.match(html, /<th[^>]*>Trend<\/th><th[^>]*>Client<\/th>/)
  assert.ok(html.includes('background:#0f172a;'))
  assert.ok(!html.includes('background:#fee2e2'))
  assert.equal(JSON.stringify(report), original, 'rendering must not reorder stored report data')
  assert.match(core.clientPeriodMailSubject(report), /Weekly & Monthly/)
  assert.throws(() => core.validateClientPeriodMailReport({ ...report, reports: [report.reports[0], { ...report.reports[1], city: 'Chennai' }] }), /same city/)
  assert.throws(() => core.validateClientPeriodMailReport({ ...report, logo: 'javascript:alert(1)' }), /PNG or JPEG/)
})

function service({ quota = 10, sendError = false } = {}) {
  const state = new Map(), sends = [], properties = new Map()
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key), setProperty: (key, value) => properties.set(key, value) }) },
    CacheService: { getScriptCache: () => ({ get: (key) => state.get(key), put: (key, value) => state.set(key, value) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, hasLock: () => true, releaseLock() {} }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(value).digest()),
      base64Decode: (value) => Array.from(Buffer.from(value, 'base64')),
      newBlob: (value, contentType, name) => ({ getBytes: () => Buffer.from(value), contentType, name }) },
    MailApp: { getRemainingDailyQuota: () => quota, sendEmail: (message) => {
      if (sendError) throw new Error('Mail service unavailable')
      sends.push(message)
    } },
    ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
      createTextOutput: (value) => ({ text: value, setMimeType() { return this } }) },
  })
  vm.runInContext(code, context)
  const requestId = '00000000-0000-4000-8000-000000000001'
  const post = (overrides = {}) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
    action: 'sendClientPeriodTest', accessKey: 'private-key', requestId, report: build([payment(1)]), ...overrides,
  }) } }).text)
  return { context, sends, post, requestId }
}

test('Apps Script needs no key, fixes the recipient, and deduplicates manual retries', () => {
  const view = service()
  assert.equal(view.post({ to: 'other@example.com', cc: 'other@example.com', htmlBody: 'untrusted' }).status, 'sent')
  assert.equal(view.sends.length, 1)
  assert.equal(view.sends[0].to, 'govindaraj.v@ev91riderz.com')
  assert.equal(view.sends[0].cc, undefined)
  assert.ok(view.sends[0].htmlBody.includes('Client payout revenue'))
  assert.equal(view.post().status, 'sent')
  assert.equal(view.sends.length, 1)
})

test('Apps Script embeds the chosen logo and sends both report sections in one email', () => {
  const view = service()
  const report = { version: 1, mode: 'both', city: 'Bengaluru', toDate: now, fromDate: '2026-03-30',
    reports: [build([payment(1)]), build([payment(1)], 'monthly')],
    logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=' }
  assert.equal(view.post({ report }).status, 'sent')
  assert.equal(view.sends.length, 1)
  assert.match(view.sends[0].htmlBody, /src="cid:companyLogo"/)
  assert.ok(!view.sends[0].htmlBody.includes('data:image'))
  assert.equal(view.sends[0].inlineImages.companyLogo.contentType, 'image/png')
  assert.equal((view.sends[0].htmlBody.match(/<table /g) || []).length, 8)
})

function expandedReport(count) {
  const reports = [build([payment(1)]), build([payment(1)], 'monthly')]
  for (const report of reports) {
    for (const table of report.tables) {
      table.rows = Array.from({ length: count }, (_, index) => ({ name: 'Entity ' + String(index).padStart(4, '0'), values: report.periods.map((_, period) => (index + 1) * (period + 1)) }))
    }
  }
  return { version: 1, city: 'Bengaluru', mode: 'both', toDate: now, fromDate: '2026-03-30', reports }
}

test('compact formatting keeps a sizeable city inline with every table and row', () => {
  const view = service(), report = expandedReport(20)
  assert.equal(view.post({ report }).status, 'sent')
  assert.equal(view.sends.length, 1)
  const mail = view.sends[0]
  assert.equal(mail.attachments.length, 0)
  assert.equal((mail.htmlBody.match(/<table /g) || []).length, 8)
  assert.equal((mail.htmlBody.match(/>Entity 0019<\/td>/g) || []).length, 8)
  assert.ok(Buffer.byteLength(mail.htmlBody) < 180000)
  assert.ok(mail.htmlBody.includes('cellpadding="7"'))
})

test('oversized cities send one complete standalone HTML attachment instead of failing or truncating', () => {
  const view = service(), report = expandedReport(120)
  assert.equal(view.post({ report }).status, 'sent')
  assert.equal(view.sends.length, 1)
  const mail = view.sends[0]
  assert.equal(mail.attachments.length, 1)
  assert.equal(Object.keys(mail.inlineImages).length, 0)
  assert.match(mail.body, /full report is attached/i)
  assert.ok(Buffer.byteLength(mail.htmlBody) < 180000)
  const attachment = mail.attachments[0]
  assert.equal(attachment.contentType, 'text/html')
  assert.match(attachment.name, /^EV91-Bengaluru-.*\.html$/)
  const html = attachment.getBytes().toString('utf8')
  assert.equal((html.match(/<table /g) || []).length, 8)
  assert.equal((html.match(/>Entity 0119<\/td>/g) || []).length, 8)
  assert.match(html, /data:image\/png;base64,/)
  assert.ok(!html.includes('src="cid:'))
  assert.equal(view.post({ report }).status, 'sent')
  assert.equal(view.sends.length, 1, 'retry remains deduplicated')
})

test('failed input and exhausted quota send no mail; status callback cannot inject code', () => {
  const view = service({ quota: 0 })
  assert.equal(view.post().status, 'failed')
  assert.equal(view.sends.length, 0)
  assert.equal(view.post({ report: { city: 'All' } }).status, 'failed')
  const response = view.context.doGet({ parameter: { action: 'status', requestId: view.requestId, callback: 'alert(1)' } })
  assert.equal(JSON.parse(response.text).status, 'failed')
})

test('a MailApp failure is visible to the status poll without exposing report data', () => {
  const view = service({ sendError: true })
  assert.equal(view.post().status, 'failed')
  const callback = 'ev91MailStatus_' + 'a'.repeat(32)
  const response = view.context.doGet({ parameter: { action: 'status', requestId: view.requestId, callback } }).text
  const payload = JSON.parse(response.slice(callback.length + 1, -2))
  assert.equal(payload.status, 'failed')
  assert.match(payload.message, /Check the inbox before retrying/)
  assert.equal(payload.report, undefined)
})

test('browser transport needs no key and waits for explicit acceptance status', async (t) => {
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch }
  t.after(() => {
    for (const [name, value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  })
  const requestId = '00000000-0000-4000-8000-000000000001'
  let posted = 0, checked = 0
  globalThis.window = {}
  globalThis.document = { createElement: () => ({ remove() {} }), head: { appendChild(script) {
    const url = new URL(script.src)
    assert.ok(!script.src.includes('private-key'))
    checked++
    queueMicrotask(() => globalThis.window[url.searchParams.get('callback')]({ requestId, status: 'sent', to: 'govindaraj.v@ev91riderz.com' }))
  } } }
  globalThis.fetch = async (url, options) => {
    assert.ok(!url.includes('private-key'))
    assert.equal(JSON.parse(options.body).accessKey, undefined)
    assert.equal(options.mode, 'no-cors')
    assert.equal(checked, 0)
    posted++
    return { type: 'opaque' }
  }
  const result = await sendClientPeriodTestMail({ url: 'https://script.google.com/macros/s/test/exec', accessKey: 'private-key', requestId, report: build([payment(1)]) })
  assert.equal(result.status, 'sent')
  assert.equal(posted, 1)
  assert.equal(checked, 1)
  await assert.rejects(sendClientPeriodTestMail({ url: 'https://other.example/exec', accessKey: 'private-key', requestId, report: {} }), /not connected/)
  assert.equal(posted, 1)
})

test('keyless service limits test mail to five attempts per day', () => {
  const view = service()
  for (let n = 1; n <= 5; n++) assert.equal(view.post({ requestId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0') }).status, 'sent')
  const response = view.post({ requestId: '00000000-0000-4000-8000-000000000006' })
  assert.equal(response.status, 'failed')
  assert.match(response.message, /5 emails per day/)
  assert.equal(view.sends.length, 5)
})

test('line sparklines contain valid indexed PNG pixels for changing and flat values', () => {
  for (const values of [[1, 10, 3, 7], [0, 0, 0]]) {
    const data = Buffer.from(clientPeriodSparklinePng(values).split(',')[1], 'base64')
    assert.equal(data.subarray(1, 4).toString(), 'PNG')
    assert.equal(data.readUInt32BE(16), 96)
    assert.equal(data.readUInt32BE(20), 28)
    let offset = 8, compressed
    while (offset < data.length) {
      const length = data.readUInt32BE(offset), name = data.subarray(offset + 4, offset + 8).toString()
      if (name === 'IDAT') compressed = data.subarray(offset + 8, offset + 8 + length)
      offset += length + 12
    }
    const pixels = inflateSync(compressed)
    assert.equal(pixels.length, 28 * 13)
    assert.ok(pixels.some((value) => value > 0))
  }
})
