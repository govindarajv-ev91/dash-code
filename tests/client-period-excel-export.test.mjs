import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { buildClientPeriodWorkbook } from '../src/lib/clientPeriodExcelExport.js'
import { buildClientPeriodCityExport } from '../src/lib/clientPeriodCityExport.js'
import { normalizeRows } from '../src/lib/clientPeriodTrendReports.js'

test('selected city export creates one sheet and preserves city totals, filters, source visibility and monthly identities', async () => {
  const allRows = normalizeRows([
    { city: 'Chennai', rider_id: 'A', gross_payout: 100 },
    { city: 'Chennai', rider_id: 'A', gross_payout: 50, week: '1626', period_start: '2026-04-13' },
    { city: 'Delhi', rider_id: 'A', gross_payout: 200 },
    { city: 'Delhi', rider_id: 'B', gross_payout: 500, source_name: 'Unlisted' },
  ].map((row, id) => ({ id, week: '1526', period_start: '2026-04-06', month: 'Apr-2026', client_name: 'Blinkit', source_name: 'Alpha', ...row })))
  const listedRows = allRows.filter((row) => row.source_name !== 'Unlisted')
  const filters = { city: 'All', client: 'All', fromDate: '2026-04-01', toDate: '2026-04-30' }
  for (const mode of ['weekly', 'monthly']) {
    for (const selectedTable of ['client-revenue', 'client-riders', 'source-riders', 'source-revenue']) {
      const options = { allRows, listedRows, filters, mode, selectedTable, sourceForRow: (row) => row.source_name }
      const report = buildClientPeriodCityExport(options)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await buildClientPeriodWorkbook(report).xlsx.writeBuffer())
      assert.equal(workbook.worksheets.length, 1)
      assert.equal(workbook.worksheets[0].getCell('A2').value, 'Chennai')
      const sheet = report.summarySheets[0]
      assert.deepEqual(sheet.rows.filter((row) => (row.Client || row.Source) === 'Total').map((row) => row.City), ['Chennai', 'Delhi'])
      const delhi = sheet.rows.find((row) => row.City === 'Delhi')
      assert.equal(delhi[report.periods[0]], selectedTable === 'client-revenue' ? 700 : selectedTable === 'source-revenue' ? 200 : 1)
      const chennai = sheet.rows[0]
      if (selectedTable.endsWith('riders')) assert.equal(chennai[report.periods[0]], 1)
      for (const index of sheet.totalRowIndices) {
        assert.equal(workbook.worksheets[0].getRow(index + 2).font.bold, true)
        assert.equal(workbook.worksheets[0].getCell(index + 2, 3).font?.color, undefined)
      }
      const cityOnly = buildClientPeriodCityExport({ ...options, filters: { ...filters, city: 'Delhi' } })
      assert.ok(cityOnly.summarySheets[0].rows.every((row) => row.City === 'Delhi'))
      if (selectedTable.startsWith('source-')) {
        const searched = buildClientPeriodCityExport({ ...options, sourceSearch: 'missing' })
        assert.deepEqual(searched.summarySheets[0].rows, [])
      }
    }
  }
  assert.throws(() => buildClientPeriodCityExport({ selectedTable: 'all' }), /Select one table/)
})

for (const mode of ['weekly', 'monthly']) {
  test(`${mode} Excel preserves text colors, neutral totals, numeric values, and raw data after reopening`, async () => {
    const periods = mode === 'weekly' ? ['Week 20', 'Week 21', 'Week 22'] : ['May 2026', 'Jun 2026', 'Jul 2026']
    const data = (label, numbers) => ({ Name: label, ...Object.fromEntries(periods.map((period, index) => [period, numbers[index]])), Total: numbers.reduce((sum, n) => sum + n, 0) })
    const total = data('Total', [120, 240, 360])
    const detail = data('Client A', [10.5, 20.5, 30.5])
    // A client/source called Total is still a detail row, not an aggregate.
    const namedTotal = data('Total', [3, 2, 1])
    const sheets = ['Revenue', 'Riders', 'Sources', 'Source Revenue'].map((kind, index) => ({
      name: `${mode} ${kind}`,
      rows: index < 2 ? [detail, namedTotal, total] : [total, detail, namedTotal],
      totalRowIndex: index < 2 ? 2 : 0,
    }))
    const rawRows = [
      { id: 1, rider_id: '00123', gross_payout: 123.45, 'Source Name': 'Alpha' },
      { id: 2, rider_id: '00456', gross_payout: 0, 'Source Phone Number': '0987654321' },
    ]
    const buffer = await buildClientPeriodWorkbook({ rawRows, periods, summarySheets: sheets }).xlsx.writeBuffer()
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), ['Raw Data', ...sheets.map((sheet) => sheet.name)])
    const raw = reopened.getWorksheet('Raw Data')
    assert.equal(raw.getCell('B2').value, '00123')
    assert.equal(raw.getCell('C2').value, 123.45)
    assert.equal(raw.getCell('E3').value, '0987654321')
    assert.equal(raw.getCell('C2').font?.color, undefined)
    for (const [index, spec] of sheets.entries()) {
      const sheet = reopened.getWorksheet(spec.name)
      const detailRow = index < 2 ? 2 : 3
      assert.equal(sheet.getCell(`B${detailRow}`).font.color.argb, 'FFF87171')
      assert.equal(sheet.getCell(`C${detailRow}`).font.color.argb, 'FFFACC15')
      assert.equal(sheet.getCell(`D${detailRow}`).font.color.argb, 'FF4ADE80')
      assert.equal(sheet.getCell(`B${detailRow}`).value, 10.5)
      assert.equal(sheet.getCell(`E${detailRow}`).value, 61.5)
      assert.equal(sheet.getCell(`E${detailRow}`).font?.color, undefined)
      const totalRow = spec.totalRowIndex + 2
      for (const column of ['B', 'C', 'D', 'E']) {
        assert.equal(sheet.getCell(`${column}${totalRow}`).font?.color, undefined)
      }
      assert.equal(sheet.getCell(`B${detailRow + 1}`).font.color.argb, 'FF4ADE80')
      for (const row of sheet.getRows(1, sheet.rowCount)) {
        row.eachCell((cell) => assert.ok(!cell.fill || cell.fill.pattern === 'none', 'font colors must not add fills'))
      }
    }
  })
}

test('Excel uses yellow for equal values and handles missing periods as the displayed zero', async () => {
  const periods = ['A', 'B', 'C']
  const workbook = buildClientPeriodWorkbook({ rawRows: [], periods, summarySheets: [{
    name: 'weekly Revenue', totalRowIndex: 2,
    rows: [{ Name: 'Equal', A: 5, B: 5, C: 5 }, { Name: 'Zero', A: 0, B: 15, C: 30 }, { Name: 'Total', A: 5, B: 20, C: 35 }],
  }] })
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer())
  const sheet = reopened.getWorksheet('weekly Revenue')
  for (const column of ['B', 'C', 'D']) assert.equal(sheet.getCell(`${column}2`).font.color.argb, 'FFFACC15')
  assert.equal(sheet.getCell('B3').font.color.argb, 'FFF87171')
  assert.equal(sheet.getCell('D3').font.color.argb, 'FF4ADE80')
})
