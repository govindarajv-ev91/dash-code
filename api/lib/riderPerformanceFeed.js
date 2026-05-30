import { buildRiderPerformanceReport } from '../../src/lib/riderPerformanceReport.js'
import {
  FLEET_SHEET_CSV_URL,
  mapGoogleSheetRowsToFleetKeys,
} from '../../src/lib/fleetSheetMerge.js'
import { fetchAllRows } from './supabaseServer.js'

const RIDER_COLS =
  'id,delivered,date_record,worker_code,worker_name,hub_name,city,client,cumulative_order,source,week,month,state,type1,type2,mob_number,fl'

const FLEET_COLS = '*'

export const RIDER_PERFORMANCE_API_COLUMNS = [
  'ID',
  'In-active Days',
  'Eff/inff',
  'Current week orders',
]

/** Default page size tuned for Google Sheets IMPORTDATA (~50 KB limit). */
export const SHEETS_PAGE_SIZE = 300

function escapeCsvValue(value) {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function buildDelimitedBody(columns, rows, delimiter, includeHeader) {
  const lines = []
  if (includeHeader) lines.push(columns.join(delimiter))
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsvValue(row[col])).join(delimiter))
  }
  return lines.join('\n')
}

function buildGoogleTsvBody(columns, rows, includeHeader) {
  const lines = []
  if (includeHeader) lines.push(columns.join('\t'))
  for (const row of rows) {
    lines.push(columns.map((col) => escapeTsv(row[col])).join('\t'))
  }
  return lines.join('\n')
}

const CACHE_TTL_MS = 5 * 60 * 1000
let reportCache = { rows: null, builtAt: 0, building: null }

export async function getCachedReportRows(asOfDate = new Date()) {
  const now = Date.now()
  if (reportCache.rows && now - reportCache.builtAt < CACHE_TTL_MS) {
    return reportCache.rows
  }
  if (reportCache.building) {
    return reportCache.building
  }

  reportCache.building = loadRiderPerformanceReportRows(asOfDate)
    .then((rows) => {
      reportCache.rows = rows
      reportCache.builtAt = Date.now()
      reportCache.building = null
      return rows
    })
    .catch((err) => {
      reportCache.building = null
      throw err
    })

  return reportCache.building
}

export async function loadRiderPerformanceReportRows(asOfDate = new Date()) {
  const [riderRows, dbFleetRows] = await Promise.all([
    fetchAllRows('rider_metrics', RIDER_COLS, null, 1000),
    fetchAllRows('fleet_data', FLEET_COLS, 'id', 250),
  ])

  const fleetDb = (dbFleetRows || []).map((row) => ({
    ...row,
    data_source: 'Database',
  }))

  let sheetFleetRows = []
  try {
    const upstream = await fetch(FLEET_SHEET_CSV_URL, {
      headers: {
        Accept: 'text/csv,text/plain,*/*',
        'User-Agent': 'FleetProDashboard/1.0',
      },
      cache: 'no-store',
    })
    if (upstream.ok) {
      const csvText = await upstream.text()
      const sampleKeys = fleetDb.length ? Object.keys(fleetDb[0]) : []
      const { rows } = mapGoogleSheetRowsToFleetKeys(csvText, sampleKeys)
      sheetFleetRows = rows
    }
  } catch (err) {
    console.warn('[rider-performance-feed] Google Sheet fleet merge skipped:', err?.message)
  }

  const fleetRows = [...fleetDb, ...sheetFleetRows]
  return buildRiderPerformanceReport(fleetRows, riderRows, asOfDate)
}

export function pickRiderPerformanceApiRows(reportRows) {
  return (reportRows || []).map((row) => ({
    ID: row.ID ?? '',
    'In-active Days': row['In-active Days'] ?? '',
    'Eff/inff': row['Eff/inff'] ?? '',
    'Current week orders': row['Current week orders'] ?? 0,
  }))
}

export function paginateApiRows(allRows, page = 1, pageSize = SHEETS_PAGE_SIZE) {
  const total = allRows.length
  const safePageSize = Math.min(1000, Math.max(50, Number(pageSize) || SHEETS_PAGE_SIZE))
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages)
  const start = (safePage - 1) * safePageSize

  return {
    rows: allRows.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
  }
}

function escapeCsv(value) {
  return escapeCsvValue(value)
}

function escapeTsv(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

export function rowsToRiderPerformanceCsv(reportRows, options = {}) {
  const {
    page,
    pageSize = SHEETS_PAGE_SIZE,
    includeHeader = true,
    allRows: precomputedRows,
    google = false,
  } = options

  const allRows = precomputedRows || pickRiderPerformanceApiRows(reportRows)
  const paged =
    page != null
      ? paginateApiRows(allRows, page, pageSize)
      : { rows: allRows, page: 1, pageSize: allRows.length, total: allRows.length, totalPages: 1 }

  const body = google
    ? buildGoogleTsvBody(RIDER_PERFORMANCE_API_COLUMNS, paged.rows, includeHeader)
    : buildDelimitedBody(RIDER_PERFORMANCE_API_COLUMNS, paged.rows, ',', includeHeader)

  return {
    body,
    ...paged,
    mimeType: google ? 'text/tab-separated-values; charset=utf-8' : 'text/csv; charset=utf-8',
  }
}

export function rowsToRiderPerformanceTsv(reportRows, options = {}) {
  const {
    page,
    pageSize = SHEETS_PAGE_SIZE,
    includeHeader = true,
    allRows: precomputedRows,
  } = options

  const allRows = precomputedRows || pickRiderPerformanceApiRows(reportRows)
  const paged =
    page != null
      ? paginateApiRows(allRows, page, pageSize)
      : { rows: allRows, page: 1, pageSize: allRows.length, total: allRows.length, totalPages: 1 }

  return {
    body: buildGoogleTsvBody(RIDER_PERFORMANCE_API_COLUMNS, paged.rows, includeHeader),
    ...paged,
    mimeType: 'text/tab-separated-values; charset=utf-8',
  }
}
