import * as XLSX from 'xlsx'
import { formatRunDate, normalizeHeader, parseFleetDate, readUploadCell, toText } from './uploadParseUtils.js'

/** Yesterday according to the India calendar, independent of the browser timezone. */
export function getOpspodUploadDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]))
  const yesterday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1))
  return yesterday.toISOString().slice(0, 10)
}

function reportDate(day, month, year) {
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (formatRunDate(parseFleetDate(key)) !== key) {
    throw new Error('Opspod report contains an invalid month or duration. No rows were uploaded.')
  }
  return key
}

function parseReportPeriod(preamble) {
  const periods = []
  for (const text of preamble) {
    const month = text.match(/\bMonth\s*:\s*(\d{1,2})\s*[-/]\s*(\d{4})\b/i)
    if (month) {
      const from = reportDate(1, month[1], month[2])
      const lastDay = new Date(Date.UTC(Number(month[2]), Number(month[1]), 0)).getUTCDate()
      periods.push({ from, to: reportDate(lastDay, month[1], month[2]) })
    }
    const duration = text.match(/\bDuration\s*:\s*from\s+(\d{1,2})[-/](\d{1,2})[-/](\d{4}).*?\bto\s+(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i)
    if (duration) {
      const from = reportDate(duration[1], duration[2], duration[3])
      const to = reportDate(duration[4], duration[5], duration[6])
      if (from > to || from.slice(0, 7) !== to.slice(0, 7)) {
        throw new Error('Opspod daywise duration must stay within one calendar month. No rows were uploaded.')
      }
      periods.push({ from, to })
    }
  }
  if (!periods.length) {
    throw new Error('Opspod daywise report needs a Month : MM-YYYY or Duration: from DD-MM-YYYY ... to DD-MM-YYYY row above the headers. No rows were uploaded.')
  }
  if (periods.some((period) => period.from.slice(0, 7) !== periods[0].from.slice(0, 7))) {
    throw new Error('Opspod report has conflicting month and duration labels. No rows were uploaded.')
  }
  return periods
}

/** Extract all completed days from the original export; null means a regular daily template. */
export function extractOpspodDaywise(sheet, { now = new Date() } = {}) {
  if (!sheet['!ref']) return null
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const read = (r, c) => readUploadCell(sheet[XLSX.utils.encode_cell({ r, c })])
  const preamble = []
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
    const cells = []
    for (let c = range.s.c; c <= range.e.c; c++) cells.push({ c, value: read(r, c) })
    const objectColumn = cells.find(({ value }) => normalizeHeader(value) === 'object')
    const hasTotal = cells.some(({ value }) => normalizeHeader(value) === 'total_distance')
    const hasDate = cells.some(({ value }) => normalizeHeader(value) === 'date')
    const days = cells.filter(({ value }) => /^\d{1,2}$/.test(toText(value)) && Number(value) >= 1 && Number(value) <= 31)
    if (objectColumn && hasTotal && !hasDate && days.length) {
      const cutoffDate = getOpspodUploadDate(now)
      const periods = parseReportPeriod(preamble)
      const dateFrom = periods.map(({ from }) => from).sort().at(-1)
      const dateTo = [...periods.map(({ to }) => to), cutoffDate].sort()[0]
      if (dateFrom > dateTo) {
        throw new Error(`Opspod report has no completed dates through ${cutoffDate} (Asia/Kolkata). No rows were uploaded.`)
      }
      const selected = []
      for (let day = Number(dateFrom.slice(-2)); day <= Number(dateTo.slice(-2)); day++) {
        const dateKey = dateFrom.slice(0, 8) + String(day).padStart(2, '0')
        const columns = days.filter(({ value }) => Number(value) === day)
        if (columns.length !== 1) {
          throw new Error(`Opspod report needs exactly one day ${day} column for ${dateKey}. No rows were uploaded.`)
        }
        selected.push({ c: columns[0].c, dateKey })
      }
      const rows = []
      const rowNumbers = []
      for (let dataRow = r + 1; dataRow <= range.e.r; dataRow++) {
        const values = []
        for (let c = range.s.c; c <= range.e.c; c++) values.push(read(dataRow, c))
        const object = toText(read(dataRow, objectColumn.c))
        const isTotalLabel = (value) => /^(?:(?:grand|sub)\s*)?total\s*:?$/i.test(toText(value))
        // Report totals are not vehicles. Preserve worksheet row numbers for expanded days.
        if (!values.some((value) => toText(value)) || isTotalLabel(object) || (!object && values.some(isTotalLabel))) {
          continue
        } else {
          for (const { c, dateKey } of selected) {
            rows.push({ Object: object, Date: dateKey, 'Total Distance': read(dataRow, c) })
            rowNumbers.push(dataRow + 1)
          }
        }
      }
      return {
        rows,
        firstDataRow: r + 2,
        rowNumbers,
        importInfo: { format: 'opspod_daywise', dateFrom, dateTo, dayCount: selected.length, cutoffDate },
      }
    }
    preamble.push(cells.map(({ value }) => toText(value)).join(' ').replace(/\s+/g, ' '))
  }
  return null
}
