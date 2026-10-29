import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { buildSourceWiseWorkbook } from '../src/lib/sourceWiseExcelExport.js'

const active = 'Active Rider Count (last 4 days)'

test('Source Wise exports retain yellow fill on the entire active-rider column after reopening', async () => {
  const specs = [
    { name: 'Source by Client', headers: ['Source', 'City', 'Source Status', 'Client', active, 'Total Order'],
      rows: [{ Source: '00123', City: 'Bengaluru', 'Source Status': 'Active', Client: 'Amazon', [active]: 12, 'Total Order': 20 },
        { Source: 'Inactive Team', City: 'Delhi', 'Source Status': 'In Active', Client: 'Zomato', [active]: 0, 'Total Order': 0 }], highlightActiveRiders: true },
    { name: 'Source Total', headers: ['Source', 'City', 'Source Status', active, 'Total Order'],
      rows: [{ Source: '00123', City: 'Bengaluru', 'Source Status': 'Active', [active]: 12, 'Total Order': 20 }], highlightActiveRiders: true },
    { name: 'Raw Orders', rows: [{ 'Rider ID': '000987', 'Total Order': 20 }] },
    { name: 'Active Summary', rows: [{ Metric: 'Total Active Riders', Value: 12 }] },
    { name: 'Client Active Windows', rows: [{ Client: 'Amazon', 'Active window end': '2026-06-23' }] },
  ]
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(await buildSourceWiseWorkbook(specs).xlsx.writeBuffer())
  assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), specs.map((spec) => spec.name))
  for (const spec of specs) {
    const sheet = reopened.getWorksheet(spec.name)
    const headers = spec.headers || Object.keys(spec.rows[0])
    assert.deepEqual(sheet.getRow(1).values.slice(1), headers)
    for (const [i, expected] of spec.rows.entries()) {
      for (const header of headers) {
        assert.equal(sheet.getRow(i + 2).getCell(headers.indexOf(header) + 1).value, expected[header])
      }
    }
    if (spec.highlightActiveRiders) {
      const index = headers.indexOf(active) + 1
      const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
      assert.deepEqual(sheet.getColumn(index).fill, fill, 'full-column fill must be serialized')
      for (let row = 1; row <= sheet.rowCount; row++) assert.deepEqual(sheet.getRow(row).getCell(index).fill, fill)
      assert.deepEqual(sheet.getRow(1000).getCell(index).fill, fill, 'unused cells inherit yellow too')
      assert.notEqual(sheet.getRow(1).getCell(index - 1).fill?.fgColor?.argb, 'FFFFFF00')
      assert.notEqual(sheet.getRow(2).getCell(index + 1).fill?.fgColor?.argb, 'FFFFFF00')
    } else {
      sheet.eachRow((row) => row.eachCell((cell) => assert.notEqual(cell.fill?.fgColor?.argb, 'FFFFFF00')))
    }
  }
})

test('empty report sheets still highlight the active-rider header and column', async () => {
  const workbook = buildSourceWiseWorkbook([
    { name: 'Source Total', headers: ['Source', active], rows: [], highlightActiveRiders: true },
  ])
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer())
  const sheet = reopened.getWorksheet('Source Total')
  assert.equal(sheet.rowCount, 1, 'column styling must not create empty worksheet rows')
  assert.equal(sheet.getCell('B1').fill.fgColor.argb, 'FFFFFF00')
  assert.equal(sheet.getColumn(2).fill.fgColor.argb, 'FFFFFF00')
})
