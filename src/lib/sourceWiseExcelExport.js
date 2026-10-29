import ExcelJS from 'exceljs'

const ACTIVE_RIDER_COLUMN = 'Active Rider Count (last 4 days)'

export function buildSourceWiseWorkbook(sheets) {
  const workbook = new ExcelJS.Workbook()
  for (const { name, rows, headers = [], highlightActiveRiders = false } of sheets) {
    const sheet = workbook.addWorksheet(name)
    const columns = [...new Set([...headers, ...rows.flatMap((row) => Object.keys(row))])]
    sheet.columns = columns.map((header) => ({ header, key: header }))
    for (const row of rows) sheet.addRow(row)
    const activeColumn = columns.indexOf(ACTIVE_RIDER_COLUMN)
    if (highlightActiveRiders && activeColumn >= 0) {
      // A column style covers the header, populated cells and unused rows,
      // without materializing a million empty cells in the workbook.
      sheet.getColumn(activeColumn + 1).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' },
      }
    }
  }
  return workbook
}

export async function downloadSourceWiseExcel(sheets, filename) {
  const workbook = buildSourceWiseWorkbook(sheets)
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
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
