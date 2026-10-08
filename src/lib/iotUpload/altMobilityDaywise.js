import * as XLSX from 'xlsx'
import { formatRunDate, normalizeHeader, parseFleetDate, readUploadCell, toText } from './uploadParseUtils.js'

function dateColumn(cell) {
  const value = readUploadCell(cell)
  // Excel can store an ISO-formatted date header as a serial; CSV headers stay text.
  const text = toText(typeof value === 'number' ? cell?.w : value).replace(/^\uFEFF/, '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  if (formatRunDate(parseFleetDate(text)) !== text) {
    throw new Error(`Alt Mobility has an invalid date column ${text}. No rows were uploaded.`)
  }
  return text
}

/** Turn the provider's YYYY-MM-DD distance columns into daily rows. */
export function extractAltMobilityDaywise(sheet) {
  if (!sheet['!ref']) return null
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const readCell = (r, c) => sheet[XLSX.utils.encode_cell({ r, c })]
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
    const cells = []
    for (let c = range.s.c; c <= range.e.c; c++) cells.push({ c, cell: readCell(r, c) })
    const registration = cells.find(({ cell }) => normalizeHeader(readUploadCell(cell)) === 'reg_no')
    if (!registration) continue
    // The existing daily template still uses its explicit Total Distance Date.
    if (cells.some(({ cell }) => normalizeHeader(readUploadCell(cell)) === 'total_distance_date')) return null
    const dates = cells.map(({ c, cell }) => ({ c, date: dateColumn(cell) }))
      .filter(({ date }) => date).sort((a, b) => a.date.localeCompare(b.date))
    if (!dates.length) continue
    const unique = new Set()
    for (const { date } of dates) {
      if (unique.has(date)) throw new Error(`Alt Mobility has duplicate date columns for ${date}. No rows were uploaded.`)
      unique.add(date)
    }
    const rows = []
    const rowNumbers = []
    const isTotal = (value) => /^(?:(?:grand|sub)\s*)?total\s*:?$/i.test(toText(value))
    for (let dataRow = r + 1; dataRow <= range.e.r; dataRow++) {
      const values = []
      for (let c = range.s.c; c <= range.e.c; c++) values.push(readUploadCell(readCell(dataRow, c)))
      const regNo = toText(readUploadCell(readCell(dataRow, registration.c)))
      if (!values.some((value) => toText(value)) || isTotal(regNo) || (!regNo && values.some(isTotal))) continue
      for (const { c, date } of dates) {
        rows.push({ reg_no: regNo, 'Total Distance Date': date, total_distance: readUploadCell(readCell(dataRow, c)) })
        rowNumbers.push(dataRow + 1)
      }
    }
    return {
      rows, rowNumbers,
      importInfo: { format: 'alt_mobility_daywise', dates: dates.map(({ date }) => date), dayCount: dates.length },
    }
  }
  return null
}
