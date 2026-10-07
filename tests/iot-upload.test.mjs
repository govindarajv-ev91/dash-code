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
    for (const method of ['select', 'gte', 'lte', 'order', 'range']) {
      builder[method] = (...args) => { query[method] = args; return builder }
    }
    builder.then = (resolve, reject) => {
      queries.push(query)
      return Promise.resolve(reply(query)).then(resolve, reject)
    }
    return builder
  },
  async rpc(name, args) {
    const query = { rpc: name, args }
    queries.push(query)
    return reply(query)
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
