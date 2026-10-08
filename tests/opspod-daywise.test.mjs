import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as XLSX from 'xlsx'
import { attachEv91VehicleLookup, detectIotDataSource, getOpspodUploadDate, parseIotWorkbookArrayBuffer, toIotDbRows } from '../src/lib/iotDataParse.js'
import { filterOpspodCatchupRows } from '../src/lib/iotUpload/opspodCatchup.js'

const now = new Date('2026-10-08T06:00:00Z')
const dayHeaders = Array.from({ length: 31 }, (_, index) => index + 1)

function report({ leading = [], label = 'Month :   10-2026', days = dayHeaders, distances = {}, rows, offset = 0, bookType = 'xlsx' } = {}) {
  const headers = [...leading, 'Object', 'Object Brand', 'Object Model', 'Total Distance', ...days]
  const vehicleRow = [
    ...leading.map(() => 'Group'), 'TN22EB2091-VIN123', 'Brand', 'Model', 99999,
    ...days.map((day) => distances[day] ?? (day === 7 ? 42.5 : day * 100)),
  ]
  const data = [
    ['Daywise Distance'], [label], headers,
    ...(rows || [vehicleRow]),
  ].map((row) => [...Array(offset).fill(''), ...row])
  const sheet = XLSX.utils.aoa_to_sheet(data)
  if (bookType !== 'csv') sheet['!merges'] = [{ s: { r: 0, c: offset }, e: { r: 0, c: offset + headers.length - 1 } }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Daywise Distance')
  return XLSX.write(workbook, { type: 'array', bookType })
}

function parse(buffer, date = now) {
  return parseIotWorkbookArrayBuffer(buffer, 'opspod_ev91', { now: date })
}

test('all four original Opspod layouts extract completed dates from Excel, XLS, and CSV', () => {
  for (const leading of [['ID Name'], [], ['Branch'], ['Company', 'Branch']]) {
    for (const bookType of ['xlsx', 'xls', 'csv']) {
      const label = leading.includes('Company')
        ? 'Duration:   from 01-10-2026 12:00:00 AM to 31-10-2026 11:59:00 PM\u00a0'
        : 'Month :   10-2026'
      const { rows, importInfo } = parse(report({ leading, label, bookType }))
      assert.equal(rows.length, 7)
      assert.deepEqual(rows.map((row) => row.run_date), Array.from({ length: 7 }, (_, index) => `2026-10-0${index + 1}`))
      assert.equal(rows.at(-1).total_distance, 42.5)
      assert.equal(rows[0].raw_vehicle_id, 'TN22EB2091-VIN123')
      assert.equal(rows[0].data_source, 'opspod_ev91')
      assert.deepEqual(importInfo, { format: 'opspod_daywise', dateFrom: '2026-10-01', dateTo: '2026-10-07', dayCount: 7, cutoffDate: '2026-10-07' })
      const resolved = attachEv91VehicleLookup(rows, [{
        id: 'uuid', registrationNumber: 'TN22EB2091', chassisNumber: 'VIN123', motorNumber: null,
      }])
      const saved = toIotDbRows(resolved, 'daywise-upload')
      assert.equal(saved[0].vehicle_number, 'TN22EB2091')
      assert.equal(saved[0].vehicle_master_id, null)
      assert.equal(saved.at(-1).run_date, '2026-10-07')
      assert.equal(saved.at(-1).total_distance, 42.5)
    }
  }
})

test('shifted headers and string day numbers are detected without fixed column positions', () => {
  const { rows } = parse(report({ leading: ['Company', 'Branch'], offset: 3, days: dayHeaders.map(String), distances: { 7: '1,250 km' } }))
  assert.equal(rows.at(-1).total_distance, 1250)
  assert.equal(detectIotDataSource(['Branch', 'Object', 'Total Distance', '1', '7']), 'opspod_ev91')
})

test('the India D-1 date crosses month, year, and leap-day boundaries correctly', () => {
  for (const [instant, label, expected] of [
    ['2026-09-30T18:29:59Z', 'Month : 09-2026', '2026-09-29'],
    ['2026-09-30T18:30:00Z', 'Month : 09-2026', '2026-09-30'],
    ['2026-12-31T19:00:00Z', 'Month : 12-2026', '2026-12-31'],
    ['2028-03-01T06:00:00Z', 'Month : 02-2028', '2028-02-29'],
  ]) {
    const date = new Date(instant)
    assert.equal(getOpspodUploadDate(date), expected)
    assert.equal(parse(report({ label }), date).rows.at(-1).run_date, expected)
  }
})

test('blank or negative completed-day cells retain Opspod zero rules; future days and monthly totals are ignored', () => {
  for (const value of ['', -12, 0]) {
    const { rows } = parse(report({ distances: { 7: value, 8: 'bad future data' } }))
    assert.equal(rows.at(-1).total_distance, 0)
  }
})

test('invalid D-1 values reject the entire report with the original worksheet row', () => {
  for (const value of ['N/A', 'Infinity', '#VALUE!']) {
    assert.throws(() => parse(report({ distances: { 7: value } })), /Row 4:.*distance.*No rows were uploaded/)
  }
})

test('missing or inconsistent metadata and incomplete day columns stop automatic catch-up', () => {
  for (const [options, message] of [
    [{ label: 'Generated report' }, /needs a Month/],
    [{ label: 'Month : 11-2026' }, /no completed dates/],
    [{ label: 'Month : 13-2026' }, /invalid month/],
    [{ label: 'Duration: from 01-10-2026 to 31-09-2026' }, /invalid month/],
    [{ label: 'Duration: from 01-09-2026 to 31-10-2026' }, /one calendar month/],
    [{ label: 'Duration: from 10-10-2026 to 01-10-2026' }, /one calendar month/],
    [{ label: 'Month : 10-2026 Duration: from 01-09-2026 to 30-09-2026' }, /conflicting/],
    [{ days: dayHeaders.filter((day) => day !== 7) }, /exactly one day 7 column/],
    [{ days: dayHeaders.filter((day) => day !== 2) }, /exactly one day 2 column/],
    [{ days: [...dayHeaders, 7] }, /exactly one day 7 column/],
  ]) {
    assert.throws(() => parse(report(options)), message)
  }
})

test('blank rows and total footers are skipped; invalid vehicle rows keep their worksheet numbers', () => {
  const vehicle = ['TN22EB2091', 'Brand', 'Model', 999, ...dayHeaders.map(() => 10)]
  const footer = ['Grand Total', '', '', 999, ...dayHeaders.map(() => 10)]
  const emptyObjectFooter = ['', '', 'Total', 999, ...dayHeaders.map(() => 10)]
  assert.equal(parse(report({ rows: [vehicle, [], footer, emptyObjectFooter] })).rows.length, 7)
  const invalid = ['', 'Brand', 'Model', 999, ...dayHeaders.map(() => 10)]
  assert.throws(() => parse(report({ rows: [vehicle, [], footer, invalid] })), /Row 7: missing vehicle identifier/)
})

test('uploading on the 11th automatically fills both holiday dates 9 and 10', () => {
  const { rows } = parse(report(), new Date('2026-10-11T06:00:00Z'))
  const resolved = attachEv91VehicleLookup(rows, [{ registrationNumber: 'TN22EB2091', chassisNumber: 'VIN123' }])
  const existing = Array.from({ length: 8 }, (_, index) => ({
    vehicle_number: 'tn-22-eb-2091', run_date: `2026-10-0${index + 1}`,
  }))
  const catchup = filterOpspodCatchupRows(resolved, existing)
  assert.equal(catchup.alreadySaved, 8)
  assert.deepEqual(catchup.rows.map((row) => row.run_date), ['2026-10-09', '2026-10-10'])
  assert.deepEqual(catchup.rows.map((row) => row.total_distance), [900, 1000])
  const saved = toIotDbRows(catchup.rows, 'holiday-catchup')
  assert.ok(saved.every((row) => row.upload_batch_id === 'holiday-catchup'))
})

test('a newer upload in one file cannot hide older gaps or missing vehicles in the other files', () => {
  const rows = [
    { vehicle_number: 'TN22EB2091', run_date: '2026-10-09' },
    { vehicle_number: 'TN22EB2091', run_date: '2026-10-10' },
    { vehicle_number: 'TN22EB2023', run_date: '2026-10-09' },
    { vehicle_number: 'TN22EB2023', run_date: '2026-10-10' },
  ]
  const existing = [rows[1]]
  const result = filterOpspodCatchupRows(rows, existing)
  assert.deepEqual(result.rows, [rows[0], rows[2], rows[3]])
  assert.equal(result.alreadySaved, 1)
  assert.equal(filterOpspodCatchupRows(rows, rows).rows.length, 0)
})

test('no history backfills all completed days; previous-month and duration reports fill only their dates', () => {
  const current = parse(report(), new Date('2026-10-11T06:00:00Z'))
  assert.equal(filterOpspodCatchupRows(current.rows, []).rows.length, 10)
  const previous = parse(report({ label: 'Month : 09-2026' }))
  assert.equal(previous.rows.length, 30)
  assert.equal(previous.rows.at(-1).run_date, '2026-09-30')
  const duration = parse(report({ label: 'Duration: from 05-10-2026 to 06-10-2026', days: [5, 6] }))
  assert.deepEqual(duration.rows.map((row) => row.run_date), ['2026-10-05', '2026-10-06'])
})

test('unmatched raw IDs use the same normalized duplicate key as the upload RPC', () => {
  const row = { vehicle_number: null, raw_vehicle_id: 'UNKNOWN-123', run_date: '2026-10-09' }
  assert.equal(filterOpspodCatchupRows([row], [
    { vehicle_number: ' ', raw_vehicle_id: 'unknown 123', run_date: '2026-10-09' },
  ]).rows.length, 0)
})

test('the existing six-column daily template still uses its explicit date and distance', () => {
  const text = 'ID Name,Object,Object Brand,Object Model,Total Distance,Date\nTest,TN22EB2091,Brand,Model,55,2026-06-18'
  const { rows, importInfo } = parse(new TextEncoder().encode(text))
  assert.equal(rows[0].run_date, '2026-06-18')
  assert.equal(rows[0].total_distance, 55)
  assert.equal(importInfo, undefined)
})
