import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import * as XLSX from 'xlsx'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const queries = []
let reply = () => ({ data: [], error: null })
globalThis.__iotTestClient = {
  from(table) {
    const query = { table }
    const builder = {}
    for (const method of ['select', 'eq', 'gte', 'lte', 'gt', 'order', 'range', 'limit', 'abortSignal']) {
      builder[method] = (...args) => {
        query[method] = args
        if (method === 'eq') (query.eqFilters ||= []).push(args)
        return builder
      }
    }
    builder.then = (resolve, reject) => {
      queries.push(query)
      return Promise.resolve(reply(query)).then(resolve, reject)
    }
    return builder
  },
  rpc(name, args) {
    const query = { rpc: name, args }
    return {
      abortSignal(signal) { query.abortSignal = signal; return this },
      then(resolve, reject) {
        queries.push(query)
        return Promise.resolve(reply(query)).then(resolve, reject)
      },
    }
  },
}
const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'mock-iot-database', enforce: 'pre',
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) {
        return 'export const supabase = globalThis.__iotTestClient'
      }
    },
  }],
})
after(async () => { await server.close(); delete globalThis.__iotTestClient })
const parser = await server.ssrLoadModule('/src/lib/iotDataParse.js')
const db = await server.ssrLoadModule('/src/lib/iotDataDb.js')
const { default: IotData } = await server.ssrLoadModule('/src/IotData.jsx')

function uploadRow(overrides = {}) {
  return { vehicle_number: 'TN22EB2091', raw_vehicle_id: 'TN22EB2091', run_date: '2026-10-07',
    total_distance: 42, data_source: 'opspod_ev91', upload_batch_id: 'same-file-retry', ...overrides }
}

test('all four exact vendor templates parse in Excel and CSV with historical source values', () => {
  for (const [source, template] of Object.entries(parser.IOT_SOURCE_TEMPLATES)) {
    const sheet = XLSX.utils.aoa_to_sheet([template.headers, template.sampleRow])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Report')
    for (const bookType of ['xlsx', 'csv']) {
      const parsed = parser.parseIotWorkbookArrayBuffer(XLSX.write(book, { type: 'array', bookType }), source)
      assert.equal(parsed.rows.length, 1)
      assert.equal(parsed.rows[0].data_source, source)
      assert.equal(parsed.rows[0].run_date, '2026-06-18')
      assert.equal(parsed.rows[0].raw_vehicle_id, 'TN22EB2091')
      assert.equal(parsed.rows[0].total_distance, Number(template.sampleRow[template.headers.indexOf(template.requiredFields.distance)]))
    }
  }
  assert.match(parser.IOT_DATA_SOURCES.vehicle_day_report.label, /stridegreen/)
  assert.match(parser.IOT_DATA_SOURCES.Recent_Details.label, /Motvolt/)
})

test('Motvolt uses daily distance instead of start/end odometer', () => {
  const [row] = parser.parseIotWorkbookRows([{ 'Reg No': 'TN22EB2091', 'Report Date': '2026-10-07', 'Start Odo': 1000, 'End Odo': 1042, Distance: 42 }], 'Recent_Details')
  assert.equal(row.total_distance, 42)
})

test('chassis, motor, and composite IDs use the original date-aware vehicle lookup', () => {
  const master = [{ id: 5, vehicle_number: 'TN22EB2091', chassis_number: 'VIN123', engine_motor_number: 'MOTOR123', master_date: '2026-06-01' }]
  for (const identifier of ['VIN123', 'MOTOR123', 'TN22EB2091-VIN123']) {
    const rows = parser.parseIotWorkbookRows([{ Object: identifier, Date: '2026-10-07', 'Total Distance': 42 }], 'opspod_ev91')
    const [resolved] = parser.attachVehicleLookup(rows, master)
    assert.equal(resolved.vehicle_number, 'TN22EB2091')
    assert.equal(resolved.vehicle_master_id, 5)
    assert.equal(resolved.lookup_matched, true)
  }
})

test('EV91 inventory resolves all providers without treating API UUIDs as vehicle master IDs', () => {
  const vehicles = [
    { id: 'ev91-uuid-1', registrationNumber: 'TN22EB2091', chassisNumber: 'VIN123', motorNumber: 'MOTOR123' },
    { id: 'ev91-uuid-2', registrationNumber: 'TN22EB2023', chassisNumber: 'VIN456', motorNumber: null },
    { id: 'unregistered', registrationNumber: null, chassisNumber: 'UNKNOWN' },
  ]
  for (const [source, template] of Object.entries(parser.IOT_SOURCE_TEMPLATES)) {
    for (const [identifier, expected, matchType] of [
      ['tn-22-eb-2091', 'TN22EB2091', 'vehicle_number'],
      ['VIN123', 'TN22EB2091', 'chassis_number'],
      ['MOTOR123', 'TN22EB2091', 'engine_motor_number'],
      ['TN22EB2091-VIN456', 'TN22EB2023', 'chassis_number'],
      ['UNKNOWN', null, null],
    ]) {
      const raw = Object.fromEntries(template.headers.map((header, index) => [header, template.sampleRow[index]]))
      raw[template.requiredFields.vehicle] = identifier
      // Isolate the primary ID from the template's sample VIN/chassis.
      for (const key of ['VIN', 'Chassis No', 'VCU ID']) delete raw[key]
      const parsed = parser.parseIotWorkbookRows([raw], source)
      const [resolved] = parser.attachEv91VehicleLookup(parsed, vehicles)
      assert.equal(resolved.vehicle_number, expected, `${source}: ${identifier}`)
      assert.equal(resolved.lookup_matched, Boolean(expected))
      assert.equal(resolved.lookup_match_type, matchType)
      assert.equal(resolved.vehicle_master_id, null)
      const [saved] = parser.toIotDbRows([resolved], 'api-lookup-batch')
      assert.equal(saved.vehicle_master_id, null)
      assert.equal(saved.vehicle_number, expected || identifier)
      assert.equal(saved.upload_batch_id, 'api-lookup-batch')
    }
  }
  const [secondary] = parser.attachEv91VehicleLookup([
    { raw_vehicle_id: 'NO-PLATE', secondary_vehicle_ids: ['VIN123'], run_date: '2026-06-18' },
  ], vehicles)
  assert.equal(secondary.vehicle_number, 'TN22EB2091')
  assert.equal(secondary.vehicle_master_id, null)
})

test('older dates are read from the existing iot_data table and cached', async () => {
  db.clearIotRiderOrderCache(); queries.length = 0
  reply = () => ({ data: [uploadRow({ run_date: '2026-06-18' })], error: null })
  const rows = await db.fetchIotDataInRange('2026-06-01', '2026-06-30')
  assert.equal(rows[0].run_date, '2026-06-18')
  assert.equal(queries[0].table, 'iot_data')
  assert.deepEqual(queries[0].gte, ['run_date', '2026-06-01'])
  await db.fetchIotDataInRange('2026-06-01', '2026-06-30')
  assert.equal(queries.length, 1)
})

test('catch-up reads fresh Opspod vehicle/day keys across every history page', async () => {
  queries.length = 0
  reply = (query) => ({ data: query.gt
    ? [{ id: 1001, vehicle_number: 'TN22EB2091', run_date: '2026-10-10' }]
    : Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, vehicle_number: `VEHICLE${index}`, run_date: '2026-10-08' })), error: null })
  const history = await db.fetchExistingOpspodVehicleDays('2026-10-01', '2026-10-10')
  assert.equal(history.length, 1001)
  assert.equal(queries.length, 2)
  assert.equal(queries[0].table, 'iot_data')
  assert.deepEqual(queries[0].eq, ['data_source', 'opspod_ev91'])
  assert.deepEqual(queries[0].gte, ['run_date', '2026-10-01'])
  assert.deepEqual(queries[0].lte, ['run_date', '2026-10-10'])
  assert.deepEqual(queries[1].gt, ['id', 1000])
  assert.deepEqual(queries[0].select, ['id,vehicle_number,raw_vehicle_id,run_date'])
  reply = () => ({ data: [{ id: 1002, vehicle_number: 'TN22EB2023', run_date: '2026-10-09' }], error: null })
  assert.equal((await db.fetchExistingOpspodVehicleDays('2026-10-01', '2026-10-10'))[0].id, 1002)
  assert.equal(queries.length, 3, 'the next file sees fresh history rather than a previous file cache')
})

test('history read errors stop catch-up preparation without making writes', async () => {
  queries.length = 0
  reply = () => ({ data: null, error: { message: 'History unavailable' } })
  await assert.rejects(db.fetchExistingOpspodVehicleDays('2026-10-01', '2026-10-10'), (error) => /History unavailable/.test(error.message))
  assert.equal(queries.length, 1)
  assert.equal(queries[0].rpc, undefined)
})

test('one complete file is saved through the original RPC, preserving lookup and batch IDs', async () => {
  queries.length = 0
  reply = () => ({ data: [{ inserted: '750', skipped: '1' }], error: null })
  const rows = Array.from({ length: 751 }, (_, index) => uploadRow({ vehicle_number: 'TN22EB' + index, lookup_matched: true, vehicle_master_id: 5 }))
  assert.deepEqual(await db.saveIotRows(rows), { inserted: 750, skipped: 1 })
  assert.equal(queries.length, 1)
  assert.equal(queries[0].rpc, 'save_iot_upload')
  assert.equal(queries[0].args.upload_rows, rows)
  assert.ok(rows.every((row) => row.upload_batch_id === 'same-file-retry' && row.lookup_matched))
  reply = () => ({ data: [], error: null })
  await db.fetchIotDataInRange('2026-06-01', '2026-06-30')
  assert.equal(queries.length, 2, 'save invalidates the report cache')
})

test('empty upload is a no-op with the same result shape', async () => {
  queries.length = 0
  assert.deepEqual(await db.saveIotRows([]), { inserted: 0, skipped: 0 })
  assert.equal(queries.length, 0)
})

test('RPC errors never fall back to table inserts', async () => {
  queries.length = 0
  reply = () => ({ data: null, error: { code: '23505', message: 'Alt Mobility data already exists for date(s): 2026-10-07. No rows were saved.' } })
  await assert.rejects(db.saveIotRows([uploadRow({ data_source: 'alt_mobility' })]), (error) => /already exists/.test(error.message))
  assert.equal(queries.length, 1)
  assert.equal(queries[0].rpc, 'save_iot_upload')
})

test('unconfirmed results and missing migrations show useful errors', async () => {
  for (const data of [null, [], [{ inserted: -1, skipped: 2 }], [{ inserted: 0, skipped: 0 }]]) {
    reply = () => ({ data, error: null })
    await assert.rejects(db.saveIotRows([uploadRow()]), /did not confirm/)
  }
  reply = () => ({ data: null, error: { code: 'PGRST202' } })
  await assert.rejects(db.saveIotRows([uploadRow()]), /database update/)
})

test('provider history parses numeric counts, distinguishes no uploads, and deduplicates simultaneous refreshes', async () => {
  queries.length = 0
  reply = () => ({ data: [{ data_source: 'opspod_ev91', run_date: '2026-10-05',
    created_at: '2026-10-06T08:04:55Z', vehicle_count: '1653', file_count: '4' }], error: null })
  const [first, simultaneous] = await Promise.all([db.fetchIotLastUploadsBySource(), db.fetchIotLastUploadsBySource()])
  assert.equal(first, simultaneous)
  assert.equal(queries.length, 1)
  assert.deepEqual(first.history.opspod_ev91, { date: '2026-10-05', uploadedAt: '2026-10-06T08:04:55Z', vehicles: 1653, files: 4 })
  assert.equal(first.history.alt_mobility, null)
  assert.deepEqual(first.errors, {})
  assert.deepEqual(db.getCachedIotUploadHistory(), first.history)
})

test('RPC timeout falls back to complete latest-day queries with unique vehicles and file counts', async () => {
  queries.length = 0
  reply = (query) => {
    if (query.rpc) return { data: null, error: { code: '57014', message: 'statement timeout' } }
    const source = query.eqFilters.find(([field]) => field === 'data_source')[1]
    if (query.select[0] === 'run_date') return { data: source === 'Recent_Details' ? [] : [{ run_date: '2026-10-06' }], error: null }
    assert.deepEqual(query.eqFilters, [['data_source', source], ['run_date', '2026-10-06']])
    if (source === 'opspod_ev91') {
      return { data: query.gt ? [{ id: 1001, vehicle_number: 'EXTRA', created_at: '2026-10-07T05:00:00Z', upload_batch_id: 'batch-c' }]
        : Array.from({ length: 1000 }, (_, index) => ({ id: index + 1,
          vehicle_number: index % 2 ? `tn-22-eb-${Math.floor(index / 2)}` : `TN22EB${Math.floor(index / 2)}`,
          created_at: '2026-10-07T04:00:00Z', upload_batch_id: index < 800 ? 'batch-a' : 'batch-b',
        })), error: null }
    }
    if (source === 'alt_mobility') return { data: [
      { id: 1, vehicle_number: 'KA-01-AS-1111', created_at: '2026-10-07T04:59:08.100Z', upload_batch_id: null },
      { id: 2, vehicle_number: 'ka01as1111', created_at: '2026-10-07T10:29:08.900+05:30', upload_batch_id: null },
      { id: 3, vehicle_number: ' ', raw_vehicle_id: 'raw-42', created_at: '2026-10-07T04:59:09Z', upload_batch_id: 'modern' },
    ], error: null }
    return { data: [{ id: 1, vehicle_number: 'OTHER', created_at: '2026-10-07T04:00:00Z', upload_batch_id: 'batch' }], error: null }
  }
  const { history, errors } = await db.fetchIotLastUploadsBySource()
  assert.deepEqual(errors, {})
  assert.deepEqual(history.opspod_ev91, { date: '2026-10-06', uploadedAt: '2026-10-07T05:00:00Z', vehicles: 501, files: 3 })
  assert.deepEqual(history.alt_mobility, { date: '2026-10-06', uploadedAt: '2026-10-07T04:59:09Z', vehicles: 2, files: 2 })
  assert.equal(history.Recent_Details, null)
  assert.equal(history.vehicle_day_report.vehicles, 1)
  assert.ok(queries.some((query) => query.gt?.[1] === 1000), 'fallback includes rows beyond the 1000-row server limit')
})

test('a failed provider preserves its last known summary while healthy providers refresh, then recovers', async () => {
  const previous = db.getCachedIotUploadHistory().opspod_ev91
  reply = (query) => {
    if (query.rpc) return { data: null, error: { code: '57014' } }
    const source = query.eqFilters.find(([field]) => field === 'data_source')[1]
    if (source === 'opspod_ev91') return { data: null, error: { message: 'network error' } }
    return { data: [], error: null }
  }
  const failed = await db.fetchIotLastUploadsBySource()
  assert.deepEqual(failed.history.opspod_ev91, previous)
  assert.deepEqual(Object.keys(failed.errors), ['opspod_ev91'])
  assert.equal(failed.history.alt_mobility, null)
  reply = () => ({ data: [{ data_source: 'opspod_ev91', run_date: '2026-10-07',
    created_at: '2026-10-08T04:00:00Z', vehicle_count: 1660, file_count: 4 }], error: null })
  const recovered = await db.fetchIotLastUploadsBySource()
  assert.equal(recovered.history.opspod_ev91.date, '2026-10-07')
  assert.deepEqual(recovered.errors, {})
})

test('malformed summary counts trigger fallback instead of rendering NaN or zero as real history', async () => {
  reply = (query) => query.rpc
    ? { data: [{ data_source: 'opspod_ev91', run_date: '2026-10-07', vehicle_count: 'invalid' }], error: null }
    : { data: [], error: null }
  const result = await db.fetchIotLastUploadsBySource()
  assert.equal(result.history.opspod_ev91, null)
  assert.deepEqual(result.errors, {})
})

test('refresh after saving waits out a query started before the upload and reads new counts', async () => {
  queries.length = 0
  let release
  const previousQuery = new Promise((resolve) => { release = resolve })
  reply = () => queries.length === 1 ? previousQuery : { data: [{ data_source: 'opspod_ev91',
    run_date: '2026-10-07', vehicle_count: 1660, file_count: 4 }], error: null }
  const old = db.fetchIotLastUploadsBySource()
  await new Promise((resolve) => setImmediate(resolve))
  const afterSave = db.fetchIotLastUploadsBySource({ force: true })
  assert.equal(queries.length, 1)
  release({ data: [{ data_source: 'opspod_ev91', run_date: '2026-10-06', vehicle_count: 1653, file_count: 3 }], error: null })
  assert.equal((await old).history.opspod_ev91.date, '2026-10-06')
  const updated = await afterSave
  assert.equal(updated.history.opspod_ev91.date, '2026-10-07')
  assert.equal(updated.history.opspod_ev91.files, 4)
  assert.equal(queries.length, 2)
})

test('only the upload tab renders upload actions; both tabs read history for all four providers', () => {
  const props = { fleetData: [], riderData: [], vehicleInventoryData: [], loading: false }
  const shared = renderToStaticMarkup(createElement(IotData, props))
  const upload = renderToStaticMarkup(createElement(IotData, { ...props, uploadEnabled: true }))
  assert.doesNotMatch(shared, /Save IoT data/)
  for (const label of ['IoT Data Upload', 'Download template', 'Save IoT data', 'Total running distance', 'From date', 'All sources', 'Alt Mobility', 'stridegreen', 'Motvolt']) {
    assert.ok(upload.includes(label), 'Upload page renders ' + label)
  }
  assert.ok(shared.includes('All sources'))
})
