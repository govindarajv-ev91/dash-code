import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as XLSX from 'xlsx'
import { attachEv91VehicleLookup, detectIotDataSource, IOT_SOURCE_TEMPLATES, parseIotWorkbookArrayBuffer, toIotDbRows } from '../src/lib/iotDataParse.js'

const baseHeaders = IOT_SOURCE_TEMPLATES.alt_mobility.headers.slice(0, -1)
const sample = IOT_SOURCE_TEMPLATES.alt_mobility.sampleRow.slice(0, -1)

function vehicle(registration, distances) {
  const values = [...sample]
  values[baseHeaders.indexOf('reg_no')] = registration
  values[baseHeaders.indexOf('total_distance')] = 99999
  return [...values, ...distances]
}

function report({ dates = ['2026-10-01', '2026-10-02', '2026-10-03'], rows, bookType = 'xlsx', preamble = [], offset = 0 } = {}) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ...preamble, [...baseHeaders, ...dates],
    ...(rows || [vehicle('tn-22-eb-2091', dates.map((_, index) => 10 + index))]),
  ].map((row) => [...Array(offset).fill(''), ...row]))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Alt Mobility')
  return XLSX.write(workbook, { type: 'array', bookType })
}

const parse = (buffer) => parseIotWorkbookArrayBuffer(buffer, 'alt_mobility')

test('single-day and multi-day original Alt Mobility exports use each date column in XLSX, XLS, and CSV', () => {
  for (const bookType of ['xlsx', 'xls', 'csv']) {
    for (const dates of [['2026-10-07'], ['2026-10-01', '2026-10-02', '2026-10-03']]) {
      const { rows, importInfo } = parse(report({ dates, bookType, rows: [
        vehicle('tn-22-eb-2091', dates.map((_, index) => index === 0 ? 0 : index * 12.5)),
        vehicle('VIN456', dates.map((_, index) => 40 + index)),
      ] }))
      assert.equal(rows.length, dates.length * 2)
      assert.deepEqual(rows.slice(0, dates.length).map((row) => row.run_date), dates)
      assert.equal(rows[0].total_distance, 0)
      assert.equal(rows.at(-1).total_distance, 40 + dates.length - 1)
      assert.ok(rows.every((row) => row.data_source === 'alt_mobility' && row.total_distance !== 99999))
      assert.deepEqual(importInfo, { format: 'alt_mobility_daywise', dates, dayCount: dates.length })
      const resolved = attachEv91VehicleLookup(rows, [
        { id: 'uuid1', registrationNumber: 'TN22EB2091' },
        { id: 'uuid2', registrationNumber: 'TN22EB2023', chassisNumber: 'VIN456' },
      ])
      const saved = toIotDbRows(resolved, 'alt-date-export')
      assert.equal(saved[0].vehicle_number, 'TN22EB2091')
      assert.equal(saved.at(-1).vehicle_number, 'TN22EB2023')
      assert.ok(saved.every((row) => row.lookup_matched && row.vehicle_master_id === null && row.upload_batch_id === 'alt-date-export'))
    }
  }
})

test('preambles, shifted columns, and out-of-order dates preserve date-to-KM mapping', () => {
  const { rows } = parse(report({ dates: ['2026-10-03', '2026-10-01', '2026-10-02'],
    rows: [vehicle('TN22EB2091', [30, '1,250 km', 20])], preamble: [['Alt Mobility'], ['Downloaded report']], offset: 2 }))
  assert.deepEqual(rows.map((row) => [row.run_date, row.total_distance]), [['2026-10-01', 1250], ['2026-10-02', 20], ['2026-10-03', 30]])
  assert.equal(detectIotDataSource([...baseHeaders, '2026-10-07']), 'alt_mobility')
})

test('date columns across month/year boundaries are kept as explicit dates', () => {
  const dates = ['2025-12-31', '2026-01-01', '2026-01-02']
  assert.deepEqual(parse(report({ dates })).rows.map((row) => row.run_date), dates)
})

test('ISO-formatted Excel serial date headers respect the 1900 and 1904 date systems', () => {
  for (const date1904 of [false, true]) {
    const serial = Date.UTC(2026, 9, 7) / 86400000 + 25569 - (date1904 ? 1462 : 0)
    const sheet = XLSX.utils.aoa_to_sheet([['reg_no', 'total_distance', serial], ['TN22EB2091', 999, 42]])
    sheet.C1.z = 'yyyy-mm-dd'
    const workbook = XLSX.utils.book_new()
    workbook.Workbook = { WBProps: { date1904 } }
    XLSX.utils.book_append_sheet(workbook, sheet, 'Report')
    const { rows } = parse(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
    assert.equal(rows[0].run_date, '2026-10-07')
    assert.equal(rows[0].total_distance, 42)
  }
})

test('blank, nonnumeric, or infinite daily distances reject the entire file with worksheet row numbers', () => {
  for (const invalid of ['', 'N/A', 'Infinity', '#VALUE!']) {
    assert.throws(() => parse(report({
      rows: [vehicle('TN22EB2091', [1, 2, 3]), vehicle('TN22EB2023', [4, invalid, 6])],
      preamble: [['Alt report'], ['Downloaded']],
    })), (error) => {
      assert.match(error.message, /Row 5:.*distance.*No rows were uploaded/)
      assert.equal(error.validationErrors[0].row, 5)
      return true
    })
  }
  assert.deepEqual(parse(report({ rows: [vehicle('TN22EB2091', [-1, 0, 12.5])] })).rows.map((row) => row.total_distance), [0, 0, 12.5])
})

test('invalid calendar dates and duplicate date headers cannot silently map or overwrite data', () => {
  for (const date of ['2026-02-30', '2026-13-01', '1999-10-07']) {
    assert.throws(() => parse(report({ dates: [date] })), /invalid date column/)
  }
  assert.throws(() => parse(report({ dates: ['2026-10-07', '2026-10-07'] })), /duplicate date columns/)
  assert.throws(() => parse(report({ dates: [] })), /Missing required columns/)
})

test('empty rows and total footers are excluded, but a missing vehicle rejects the file', () => {
  assert.equal(parse(report({ rows: [vehicle('TN22EB2091', [1, 2, 3]), [], vehicle('Grand Total', [1, 2, 3])] })).rows.length, 3)
  assert.throws(() => parse(report({ rows: [vehicle('', [1, 2, 3])] })), /Row 2: missing vehicle identifier/)
})

test('the existing explicit-date Alt Mobility template is still supported', () => {
  const template = IOT_SOURCE_TEMPLATES.alt_mobility
  const sheet = XLSX.utils.aoa_to_sheet([template.headers, template.sampleRow])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Template')
  const { rows, importInfo } = parse(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].run_date, '2026-06-18')
  assert.equal(rows[0].total_distance, 52)
  assert.equal(importInfo, undefined)
})
