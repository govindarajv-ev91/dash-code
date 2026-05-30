import { buildRiderPerformanceReport } from '../../src/lib/riderPerformanceReport.js'
import { fetchAllRows, fetchAllFleetTables, getSupabase } from './supabaseServer.js'

const RIDER_PERFORMANCE_CACHE_KEY = 'rider_performance_api_v1'
const API_CACHE_TTL_MS = 10 * 60 * 1000

async function readApiCache(cacheKey = RIDER_PERFORMANCE_CACHE_KEY) {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('api_cache')
      .select('payload, updated_at')
      .eq('cache_key', cacheKey)
      .maybeSingle()

    if (error || !data?.payload?.rows?.length) return null

    const age = Date.now() - new Date(data.updated_at).getTime()
    if (age > API_CACHE_TTL_MS) return null

    return { rows: data.payload.rows, updatedAt: data.updated_at, fromCache: true }
  } catch {
    return null
  }
}

async function writeApiCache(rows, cacheKey = RIDER_PERFORMANCE_CACHE_KEY) {
  try {
    const supabase = getSupabase()
    const { error } = await supabase.from('api_cache').upsert(
      {
        cache_key: cacheKey,
        payload: { rows },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    )
    return !error
  } catch {
    return false
  }
}

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

const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000
let memoryCache = { rows: null, builtAt: 0, building: null }

export async function buildFreshApiRows(asOfDate = new Date()) {
  const [riderRows, fleetRows] = await Promise.all([
    fetchAllRows('rider_metrics', RIDER_COLS, null, 1000),
    fetchAllFleetTables(FLEET_COLS, 250),
  ])
  const reportRows = buildRiderPerformanceReport(fleetRows, riderRows, asOfDate)
  return pickRiderPerformanceApiRows(reportRows)
}

export async function getCachedApiRows(asOfDate = new Date(), { forceRebuild = false } = {}) {
  if (!forceRebuild) {
    const dbCache = await readApiCache()
    if (dbCache?.rows?.length) {
      memoryCache = { rows: dbCache.rows, builtAt: Date.now(), building: null }
      return { rows: dbCache.rows, fromCache: true, updatedAt: dbCache.updatedAt }
    }

    const now = Date.now()
    if (memoryCache.rows && now - memoryCache.builtAt < MEMORY_CACHE_TTL_MS) {
      return { rows: memoryCache.rows, fromCache: true, updatedAt: new Date(memoryCache.builtAt).toISOString() }
    }
  }

  if (memoryCache.building) {
    const rows = await memoryCache.building
    return { rows, fromCache: false, updatedAt: new Date().toISOString() }
  }

  memoryCache.building = buildFreshApiRows(asOfDate)
    .then(async (rows) => {
      memoryCache.rows = rows
      memoryCache.builtAt = Date.now()
      memoryCache.building = null
      await writeApiCache(rows)
      return rows
    })
    .catch((err) => {
      memoryCache.building = null
      throw err
    })

  const rows = await memoryCache.building
  return { rows, fromCache: false, updatedAt: new Date().toISOString() }
}

/** @deprecated use getCachedApiRows */
export async function getCachedReportRows(asOfDate = new Date()) {
  return loadRiderPerformanceReportRows(asOfDate)
}

export async function loadRiderPerformanceReportRows(asOfDate = new Date()) {
  const [riderRows, fleetRows] = await Promise.all([
    fetchAllRows('rider_metrics', RIDER_COLS, null, 1000),
    fetchAllFleetTables(FLEET_COLS, 250),
  ])
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

export function rowsToRiderPerformanceCsv(allRows, options = {}) {
  const {
    page,
    pageSize = SHEETS_PAGE_SIZE,
    includeHeader = true,
    google = false,
  } = options

  const rows = allRows || []
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
