import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { buildClientPeriodWorkbook } from '../src/lib/clientPeriodExcelExport.js'

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
