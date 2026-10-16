import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import * as XLSX from 'xlsx'
import { buildOverviewAttritionPhoneIndex, lookupOverviewAttritionPhone, buildOverviewAttritionNameIndex, lookupOverviewAttritionName } from '../src/lib/overviewAttritionContacts.js'
import { buildOverviewAttritionWorkbook } from '../src/lib/overviewRiderAttritionExcelExport.js'

test('attrition phone lookup uses all four sources and exact normalized rider IDs', () => {
  const index = buildOverviewAttritionPhoneIndex({
    onboardingRows: [{ rider_id_details: 'FE11893572', rider_mobile_number: '+91 93458 89303' },
      { merge: 'voiceFE11083660', rider_mobile_number: '9113579053' }],
    fleetRows: [{ rider_id: 'CHN61_R0196', rider_contact_number: '9876543210' }],
    newFleetRows: [{ rider_id: '00123', rider_contact_number: '9876543211' }],
    kycRows: [{ rider_id: '899696.0', rider_mobile_number: 9876543212 }],
  })
  for (const [id, phone] of [[' fe11893572 ', '9345889303'], ['FE11083660', '9113579053'],
    ['chn61-r0196', '9876543210'], ['00123', '9876543211'], ['899696', '9876543212']]) {
    assert.equal(lookupOverviewAttritionPhone(index, id), phone)
  }
  for (const id of ['123', 'OTHER11893572', '11893572', 'FE899696', 'Santhosh', 'unknown', '']) {
    assert.equal(lookupOverviewAttritionPhone(index, id), '')
  }
})

test('onboarding wins, then newest dated contact across both fleet tables, then KYC', () => {
  const sources = {
    onboardingRows: [{ rider_id_details: 'r1', rider_mobile_number: '9000000001' },
      { rider_id_details: 'r2', rider_mobile_number: 'N/A' }],
    fleetRows: [
      { rider_id: 'r1', rider_contact_number: '9000000002', date_record: '2026-10-16' },
      { rider_id: 'r2', rider_contact_number: '9000000003', date_record: '15/10/2026' },
      { rider_id: 'r2', rider_contact_number: '9000000004', date_record: '2026-10-01', updated_at: '2026-10-16T12:00:00Z' },
      { rider_id: 'r3', rider_contact_number: '0000000000' },
    ],
    newFleetRows: [
      { rider_id: 'r2', rider_contact_number: '9000000005', date_record: '2026-10-14' },
      { rider_id: 'r4', rider_contact_number: '9000000006', date_record: '2026-10-16' },
    ],
    kycRows: [{ rider_id: 'r2', rider_mobile_number: '9000000007' }, { rider_id: 'r3', rider_mobile_number: '9000000008' }],
  }
  for (const input of [sources, Object.fromEntries(Object.entries(sources).map(([key, rows]) => [key, [...rows].reverse()]))]) {
    const index = buildOverviewAttritionPhoneIndex(input)
    assert.equal(lookupOverviewAttritionPhone(index, 'r1'), '9000000001')
    assert.equal(lookupOverviewAttritionPhone(index, 'r2'), '9000000003')
    assert.equal(lookupOverviewAttritionPhone(index, 'r3'), '9000000008')
    assert.equal(lookupOverviewAttritionPhone(index, 'r4'), '9000000006')
  }
})

test('invalid, nominee and ambiguous contacts never supply another rider phone', () => {
  const index = buildOverviewAttritionPhoneIndex({
    onboardingRows: [
      { rider_id_details: 'a', rider_mobile_number: '9000000001' },
      { rider_id_details: 'a', rider_mobile_number: '9000000002' },
      { rider_id_details: 'a', rider_mobile_number: '9000000001' },
      { rider_id_details: 'b', rider_name: 'Santhosh', rider_mobile_number: 'FE9345889303' },
      { rider_id_details: 'c', rider_mobile_number: '123456' },
      { rider_id_details: 'd', rider_mobile_number: '12349345889303' },
    ],
    fleetRows: [{ rider_id: 'b', nominee_phone_number_deployee: '9000000003', rider_alternate_phone_number_deployee: '9000000004' }],
    kycRows: [{ rider_id: 'a', rider_mobile_number: '9000000005' }],
  })
  assert.equal(lookupOverviewAttritionPhone(index, 'a'), '9000000005')
  for (const id of ['b', 'c', 'd', 'Santhosh']) assert.equal(lookupOverviewAttritionPhone(index, id), '')
})

test('updated onboarding and KYC records supersede older phone numbers', () => {
  const index = buildOverviewAttritionPhoneIndex({
    onboardingRows: [
      { rider_id_details: 'a', rider_mobile_number: '9000000001', updated_at: '2026-10-01T00:00:00Z' },
      { rider_id_details: 'a', rider_mobile_number: '9000000002', updated_at: '2026-10-15T00:00:00Z' },
    ],
    kycRows: [
      { rider_id: 'b', rider_mobile_number: '9000000003', created_at: '2026-10-15T00:00:00Z' },
      { rider_id: 'b', rider_mobile_number: '9000000004', created_at: '2026-10-01T00:00:00Z' },
    ],
  })
  assert.equal(lookupOverviewAttritionPhone(index, 'a'), '9000000002')
  assert.equal(lookupOverviewAttritionPhone(index, 'b'), '9000000003')
})

test('Excel phone numbers stay text and missing phones stay blank for every chart period', () => {
  const phoneIndex = buildOverviewAttritionPhoneIndex({ kycRows: [{ rider_id: '00123', rider_mobile_number: '0123456789' }] })
  for (const period of ['daily', 'weekly', 'monthly']) {
    const report = { period, series: [], totals: { ev: 1, nonEv: 0, total: 1 }, details: [
      { workerCode: '00123', workerName: 'Rider One' }, { workerCode: 'missing' },
    ] }
    const workbook = buildOverviewAttritionWorkbook(report, { phoneIndex })
    const reopened = XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' })
    const sheet = reopened.Sheets['Rider Details']
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    assert.equal(rows[0]['Phone Number'], '0123456789')
    assert.equal(rows[1]['Phone Number'], '')
    assert.equal(sheet.D2.t, 's')
    assert.equal(rows[0]['Rider ID'], '00123')
    assert.equal(report.details[0].phone, undefined, 'export enrichment does not mutate the chart')
  }
})

test('names use all four tables, source priority and latest records independently of phones', () => {
  const sources = {
    onboardingRows: [
      { rider_id_details: 'a', rider_name: '  Onboarding   Name  ', rider_mobile_number: '' },
      { merge: 'voiceFE11893572', rider_name: 'Merge Name' },
      { rider_id_details: 'a', rider_name: 'Old Name', updated_at: '2026-10-01T00:00:00Z' },
      { rider_id_details: 'a', rider_name: 'Current Name', updated_at: '2026-10-15T00:00:00Z' },
      { rider_id_details: 'b', rider_name: 'N/A', rider_mobile_number: '9000000001' },
    ],
    fleetRows: [
      { rider_id: 'a', rider_name: 'Fleet Name', rider_contact_number: '9000000002', date_record: '2026-10-16' },
      { rider_id: 'b', rider_name: 'Old Fleet Name', date_record: '2026-10-01' },
      { rider_id: 'c', rider_name: 'Legacy Fleet Name', date_record: '15/10/2026' },
    ],
    newFleetRows: [
      { rider_id: 'b', rider_name: 'New Fleet Name', date_record: '2026-10-15' },
      { rider_id: 'c', rider_name: 'Older Form Name', date_record: '2026-10-14', updated_at: '2026-10-16T00:00:00Z' },
    ],
    kycRows: [
      { rider_id: 'a', rider_name: 'KYC Name' },
      { rider_id: 'd', rider_name: 'KYC Old Name', updated_at: '2026-10-01T00:00:00Z' },
      { rider_id: 'd', rider_name: 'KYC Current Name', updated_at: '2026-10-15T00:00:00Z' },
    ],
  }
  for (const input of [sources, Object.fromEntries(Object.entries(sources).map(([key, rows]) => [key, [...rows].reverse()]))]) {
    const names = buildOverviewAttritionNameIndex(input)
    for (const [id, name] of [['a', 'Current Name'], ['b', 'New Fleet Name'], ['c', 'Legacy Fleet Name'], ['d', 'KYC Current Name'], ['fe11893572', 'Merge Name']]) {
      assert.equal(lookupOverviewAttritionName(names, id), name)
    }
    const phones = buildOverviewAttritionPhoneIndex(input)
    assert.equal(lookupOverviewAttritionPhone(phones, 'a'), '9000000002')
    assert.equal(lookupOverviewAttritionPhone(phones, 'b'), '9000000001')
  }
})

test('unmatched, conflicting and placeholder names fall back to activity without matching names or digits', () => {
  const names = buildOverviewAttritionNameIndex({
    onboardingRows: [
      { rider_id_details: 'FE11083660', rider_name: 'Santhosh' },
      { rider_id_details: 'a', rider_name: 'First Name' },
      { rider_id_details: 'a', rider_name: 'Different Name' },
      { rider_id_details: 'b', rider_name: 'Unknown' },
      { rider_id_details: 'c', rider_name: '—' },
    ],
    kycRows: [{ rider_id: 'b', rider_name: 'KYC Fallback' }],
  })
  assert.equal(lookupOverviewAttritionName(names, 'b'), 'KYC Fallback')
  for (const id of ['a', 'c', 'FE11893572', '11083660', 'OTHER11083660', 'Santhosh']) {
    assert.equal(lookupOverviewAttritionName(names, id, 'Activity Name'), 'Activity Name')
    assert.equal(lookupOverviewAttritionName(names, id, 'N/A'), '')
  }
})

test('Excel exports mapped names with activity fallback in Month, Week and Days views', () => {
  const nameIndex = buildOverviewAttritionNameIndex({
    onboardingRows: [{ rider_id_details: '00123', rider_name: 'Mapped Rider Name' }],
  })
  for (const period of ['monthly', 'weekly', 'daily']) {
    const report = { period, series: [], totals: { ev: 0, nonEv: 0, total: 0 }, details: [
      { workerCode: '00123', workerName: 'Old Activity Name' },
      { workerCode: 'missing', workerName: 'Activity Fallback' }, { workerCode: 'no-name' },
    ] }
    const workbook = buildOverviewAttritionWorkbook(report, { nameIndex })
    const reopened = XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json(reopened.Sheets['Rider Details'], { defval: '' })
    assert.equal(rows[0]['Rider Name'], 'Mapped Rider Name')
    assert.equal(rows[1]['Rider Name'], 'Activity Fallback')
    assert.equal(rows[2]['Rider Name'], '')
    assert.equal(report.details[0].workerName, 'Old Activity Name')
  }
})

const queries = []
let respond = () => ({ data: [], error: null })
globalThis.__attritionContactTestClient = {
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'order', 'limit', 'gt']) {
      builder[method] = (...args) => { query[method] = args; return builder }
    }
    builder.then = (resolve, reject) => { queries.push(query); return Promise.resolve(respond(query)).then(resolve, reject) }
    return builder
  },
}
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/overview-attrition-contacts',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'attrition-contacts-test-db', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__attritionContactTestClient'
  } }],
})
after(async () => { await server.close(); delete globalThis.__attritionContactTestClient })
const { fetchOverviewAttritionContactIndexes } = await server.ssrLoadModule('/src/lib/overviewAttritionContactDb.js')

test('export fetches fresh narrow contacts from every table, including capped pages', async () => {
  queries.length = 0
  const rows = {
    rider_onboarding: [{ id: 'a', rider_id_details: 'r1', rider_mobile_number: '9000000001' },
      { id: 'b', rider_id_details: 'r2', rider_mobile_number: '9000000002' },
      { id: 'c', rider_id_details: 'r3', rider_mobile_number: '9000000003' }],
    fleet_data: [{ id: 1, rider_id: 'r4', rider_contact_number: '9000000004' }],
    new_fleet_data: [{ id: 1, rider_id: 'r5', rider_contact_number: '9000000005' }],
    rider_kyc: [{ id: 'a', rider_id: 'r6', rider_mobile_number: '9000000006', rider_name: 'KYC Rider' }],
  }
  respond = (query) => ({ data: rows[query.table].filter((row) => !query.gt || row.id > query.gt[1]).slice(0, 2), error: null })
  const { phoneIndex: index, nameIndex } = await fetchOverviewAttritionContactIndexes()
  for (let i = 1; i <= 6; i++) assert.equal(lookupOverviewAttritionPhone(index, `r${i}`), `900000000${i}`)
  assert.equal(lookupOverviewAttritionName(nameIndex, 'r6'), 'KYC Rider')
  assert.ok(queries.every((query) => query.select[0] !== '*' && query.select[0].split(',').includes('rider_name') && query.order[0] === 'id' && query.limit))
  assert.equal(queries.filter((query) => query.table === 'rider_onboarding').length, 3)
  queries.length = 0
  await fetchOverviewAttritionContactIndexes()
  assert.ok(queries.length > 0, 'repeat exports reload current contacts')
})

test('a failed contact table stops export instead of returning a partial phone map', async () => {
  queries.length = 0
  respond = (query) => query.table === 'rider_kyc'
    ? { data: null, error: { code: '42703', message: 'rider_mobile_number does not exist' } }
    : { data: [], error: null }
  await assert.rejects(fetchOverviewAttritionContactIndexes(), (error) => error.code === '42703')
  assert.equal(new Set(queries.map((query) => query.table)).size, 4)
})
