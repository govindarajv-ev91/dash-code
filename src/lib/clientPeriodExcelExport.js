import ExcelJS from 'exceljs'
import { clientPeriodValueLevels, TREND_VALUE_COLORS } from './clientPeriodValueColors.js'

function addRows(workbook, name, rows) {
  const sheet = workbook.addWorksheet(name)
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  sheet.columns = headers.map((header) => ({ header, key: header, width: 20 }))
  for (const row of rows) sheet.addRow(row)
  if (headers.length) sheet.getRow(1).font = { bold: true }
  return sheet
}

export function buildClientPeriodWorkbook({ rawRows, periods, summarySheets }) {
  const workbook = new ExcelJS.Workbook()
  addRows(workbook, 'Raw Data', rawRows)
  for (const { name, rows, totalRowIndex } of summarySheets) {
    const sheet = addRows(workbook, name, rows)
    rows.forEach((values, index) => {
      const row = sheet.getRow(index + 2)
      if (index === totalRowIndex) {
        row.font = { bold: true }
        return
      }
      const levels = clientPeriodValueLevels(periods, values)
      periods.forEach((period, periodIndex) => {
        row.getCell(period).font = {
          color: { argb: `FF${TREND_VALUE_COLORS[levels[periodIndex]].slice(1).toUpperCase()}` },
        }
      })
    })
  }
  return workbook
}

export async function downloadClientPeriodExcel(options, filename) {
  const workbook = buildClientPeriodWorkbook(options)
  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}
