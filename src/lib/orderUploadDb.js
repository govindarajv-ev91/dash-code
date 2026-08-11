import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'
import {
  collectMonthsFromRows,
  mergeMonthLists,
  fetchLastUploadAtSafe,
  fetchTableCount,
  isStatementTimeout,
} from './paymentMonthList'
import { toMetricDateKey } from './mergeRiderMetrics'

export const ORDER_UPLOAD_TABLE = 'order_upload_data'
/** Slim columns for dashboard merge / overview (faster than select *). */
export const ORDER_UPLOAD_COLUMNS =
  'id,client,date_record,worker_code,delivered,city,type1,month'
/** Slim columns for Order History (faster than select *). */
export const ORDER_HISTORY_COLUMNS =
  'id,client,date_record,worker_code,delivered,city,type1,month'

const MONTH_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

export function isMissingOrderUploadTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('order_upload_data') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export function getOrderUploadDbSetupMessage() {
  return 'Database table / unique index missing. Re-run sql/create_order_upload_table.sql in Supabase SQL Editor (unique: Date+WorkerCode+Client+delivered), then upload again.'
}

/** Parse "Jul-2026" → { year, monthIndex 0-11, mm: "07" }. */
export function parseOrderUploadMonthLabel(label) {
  const text = (label ?? '').toString().trim()
  const m = text.match(/^([A-Za-z]{3})-(\d{4})$/)
  if (!m) return null
  const monthIndex = MONTH_ABBR[m[1].toLowerCase()]
  const year = Number(m[2])
  if (monthIndex == null || !Number.isFinite(year)) return null
  return {
    year,
    monthIndex,
    mm: String(monthIndex + 1).padStart(2, '0'),
  }
}

/** Prefer estimated count — exact COUNT(*) often times out on large order_upload_data in prod. */
export async function fetchOrderUploadCount() {
  return fetchTableCount(ORDER_UPLOAD_TABLE)
}

const ORDER_UPLOAD_PREVIEW_SELECT = ORDER_UPLOAD_COLUMNS

export async function fetchOrderUploadPreview(limit = 50) {
  let pageLimit = limit
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from(ORDER_UPLOAD_TABLE)
      .select(ORDER_UPLOAD_PREVIEW_SELECT)
      .order('id', { ascending: false })
      .limit(pageLimit)
    if (!error) return data || []
    if (isStatementTimeout(error) && pageLimit > 10) {
      pageLimit = Math.max(10, Math.floor(pageLimit / 2))
      continue
    }
    throw error
  }
  return []
}

function orderUploadRowKey(row) {
  const worker = (row.worker_code ?? '').toString().trim().toUpperCase()
  const date = (row.date_record ?? '').toString().trim()
  const client = (row.client ?? '').toString().trim().toLowerCase()
  const delivered = row.delivered == null || row.delivered === '' ? 0 : Number(row.delivered) || 0
  return `${worker}|${date}|${client}|${delivered}`
}

/** Merge freshly saved rows into in-memory cache (avoids full-table refetch after upload). */
export function patchOrderUploadCache(incomingRows = []) {
  if (!incomingRows?.length) return cachedOrders ? [...cachedOrders] : []
  const byKey = new Map()
  for (const row of cachedOrders || []) {
    byKey.set(orderUploadRowKey(row), row)
  }
  for (const row of incomingRows) {
    byKey.set(orderUploadRowKey(row), row)
  }
  cachedOrders = [...byKey.values()]
  return cachedOrders
}

export async function clearOrderUploadData() {
  const { error, count } = await supabase
    .from(ORDER_UPLOAD_TABLE)
    .delete({ count: 'exact' })
    .neq('id', 0)
  if (error) throw error
  clearOrderUploadCache()
  return count ?? 0
}

/**
 * Clear one month. Matches:
 * - month column (e.g. Jul-2026)
 * - date_record dd-MM-yyyy ending -MM-YYYY
 * - date_record yyyy-MM-dd starting YYYY-MM-
 * so rows with empty/wrong month column are still removed.
 */
export async function clearOrderUploadDataByMonth(month) {
  const label = (month ?? '').toString().trim()
  if (!label) return clearOrderUploadData()

  let deleted = 0
  const parsed = parseOrderUploadMonthLabel(label)

  const runDelete = async (build) => {
    let q = supabase.from(ORDER_UPLOAD_TABLE).delete({ count: 'exact' })
    q = build(q)
    const { error, count } = await q
    if (error) throw error
    deleted += count ?? 0
  }

  await runDelete((q) => q.eq('month', label))

  if (parsed) {
    const { year, mm } = parsed
    // dd-MM-yyyy e.g. 22-07-2026
    await runDelete((q) => q.like('date_record', `%-${mm}-${year}`))
    // yyyy-MM-dd e.g. 2026-07-22
    await runDelete((q) => q.like('date_record', `${year}-${mm}-%`))
  }

  clearOrderUploadCache()
  return deleted
}

/** Sample recent rows for month labels — never full-table scan (avoids timeouts). */
async function fetchOrderUploadMonthsSampled() {
  const labels = new Set()
  let cursor = null
  let pageSize = 500
  const maxPages = 30

  for (let page = 0; page < maxPages; page++) {
    let q = supabase
      .from(ORDER_UPLOAD_TABLE)
      .select('id,month')
      .order('id', { ascending: false })
      .limit(pageSize)
    if (cursor != null) q = q.lt('id', cursor)

    const { data, error } = await q
    if (error) {
      if (isStatementTimeout(error) && pageSize > 100) {
        pageSize = Math.max(100, Math.floor(pageSize / 2))
        page--
        continue
      }
      throw error
    }
    if (!data?.length) break
    for (const row of data) {
      const m = (row.month ?? '').toString().trim()
      if (m) labels.add(m)
    }
    cursor = data[data.length - 1].id
    // Enough distinct months for UI; stop early.
    if (labels.size >= 24 && page >= 2) break
    if (data.length < pageSize) break
  }

  return mergeMonthLists([...labels])
}

export async function fetchOrderUploadMonths() {
  const probe = await supabase.from(ORDER_UPLOAD_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error
  if (!probe.data?.length) return []

  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_order_upload_months')
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const labels = rpcData.map((row) => (typeof row === 'string' ? row : row?.month))
    return mergeMonthLists(labels)
  }

  if (rpcError) {
    console.warn('[orders] distinct months RPC failed, using sample:', rpcError.message || rpcError)
  }

  // Do NOT fetchAllData the whole table — that times out on large uploads.
  return fetchOrderUploadMonthsSampled()
}

async function writeOrderUploadChunk(chunk, { upsert = false } = {}) {
  let size = chunk.length
  let offset = 0
  let written = 0

  while (offset < chunk.length) {
    const slice = chunk.slice(offset, offset + size)
    try {
      const { error } = upsert
        ? await supabase.from(ORDER_UPLOAD_TABLE).upsert(slice, {
            onConflict: 'worker_code,date_record,client,delivered',
            ignoreDuplicates: false,
          })
        : await supabase.from(ORDER_UPLOAD_TABLE).insert(slice)
      if (error) throw error
      written += slice.length
      offset += slice.length
    } catch (err) {
      if (isStatementTimeout(err) && size > 25) {
        size = Math.max(25, Math.floor(size / 2))
        await new Promise((r) => setTimeout(r, 350))
        continue
      }
      throw err
    }
  }

  return written
}

export async function saveOrderUploadRows(rows, { replace = false } = {}) {
  if (!rows?.length) return { saved: 0, unique: 0, skipped: 0, rows: [] }

  // Unique within file: Date + WorkerCode + Client + delivered → keep last row.
  const byKey = new Map()
  let skippedInFile = 0
  for (const row of rows) {
    const worker = (row.worker_code ?? '').toString().trim()
    const dateRaw = (row.date_record ?? '').toString().trim()
    const date = toMetricDateKey(dateRaw) || dateRaw
    const client = (row.client ?? '').toString().trim()
    const delivered =
      row.delivered == null || row.delivered === '' ? 0 : Number(row.delivered) || 0
    if (!worker || !date) {
      skippedInFile++
      continue
    }
    const key = `${worker.toUpperCase()}|${date}|${client.toLowerCase()}|${delivered}`
    if (byKey.has(key)) skippedInFile++
    byKey.set(key, {
      ...row,
      worker_code: worker,
      date_record: date,
      client,
      delivered,
    })
  }

  const uniqueRows = [...byKey.values()]
  if (!uniqueRows.length) return { saved: 0, unique: 0, skipped: skippedInFile, rows: [] }

  const chunkSize = 200
  let saved = 0

  if (replace) {
    await clearOrderUploadData()
    for (let i = 0; i < uniqueRows.length; i += chunkSize) {
      const chunk = uniqueRows.slice(i, i + chunkSize)
      saved += await writeOrderUploadChunk(chunk, { upsert: false })
    }
    clearOrderUploadCache()
    patchOrderUploadCache(uniqueRows)
    return { saved, unique: uniqueRows.length, skipped: skippedInFile, rows: uniqueRows }
  }

  // Daily upload: upsert on Date + WorkerCode + Client + delivered
  for (let i = 0; i < uniqueRows.length; i += chunkSize) {
    const chunk = uniqueRows.slice(i, i + chunkSize)
    saved += await writeOrderUploadChunk(chunk, { upsert: true })
  }
  patchOrderUploadCache(uniqueRows)
  return { saved, unique: uniqueRows.length, skipped: skippedInFile, rows: uniqueRows }
}

let cachedOrders = null
let ordersInflight = null
/** Bumped on clear so in-flight fetches cannot overwrite cache with stale rows. */
let ordersFetchGeneration = 0
/** Per-month cache for Order History (avoids loading the full table). */
const historyMonthCache = new Map()
const historyMonthInflight = new Map()

export async function fetchAllOrderUploads({ force = false } = {}) {
  if (force) {
    cachedOrders = null
    ordersInflight = null
    ordersFetchGeneration += 1
  }
  if (!force && cachedOrders) return cachedOrders
  if (!force && ordersInflight) return ordersInflight

  const gen = ++ordersFetchGeneration
  ordersInflight = (async () => {
    const probe = await supabase.from(ORDER_UPLOAD_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    const { data } = await fetchAllData(ORDER_UPLOAD_TABLE, ORDER_UPLOAD_COLUMNS, 'id', {
      useKeyset: true,
      maxRetries: 12,
      pageSize: 500,
    })
    const rows = data || []

    if (gen !== ordersFetchGeneration) return rows

    cachedOrders = rows
    return cachedOrders
  })().finally(() => {
    if (gen === ordersFetchGeneration) ordersInflight = null
  })

  return ordersInflight
}

/**
 * Fast Order History fetch: one month only + slim columns.
 * Keyset pagination with timeout retries (smaller pages). Optional onPage for progressive UI.
 */
export async function fetchOrderUploadsForHistory(month, { force = false, onPage } = {}) {
  const label = (month ?? '').toString().trim()
  if (!label) return []

  if (!force && historyMonthCache.has(label)) {
    const cached = historyMonthCache.get(label)
    if (typeof onPage === 'function') onPage(cached)
    return cached
  }
  if (!force && historyMonthInflight.has(label) && typeof onPage !== 'function') {
    return historyMonthInflight.get(label)
  }

  const inflight = (async () => {
    // month + id keyset; composite index (month, id) recommended — see SQL file.
    let pageSize = 500
    const byId = new Map()
    let cursor = null
    let consecutiveTimeouts = 0
    const maxTimeoutRetries = 8

    while (true) {
      let q = supabase
        .from(ORDER_UPLOAD_TABLE)
        .select(ORDER_HISTORY_COLUMNS)
        .eq('month', label)
        .order('id', { ascending: true })
        .limit(pageSize)
      if (cursor != null) q = q.gt('id', cursor)

      const { data, error } = await q
      if (error) {
        if (isStatementTimeout(error) && consecutiveTimeouts < maxTimeoutRetries) {
          consecutiveTimeouts++
          if (pageSize > 100) {
            pageSize = Math.max(100, Math.floor(pageSize / 2))
            console.warn(
              `[orders] history ${label} timed out; retrying page size ${pageSize}`
            )
            await new Promise((r) => setTimeout(r, 400 * consecutiveTimeouts))
            continue
          }
          // Already at min page size — if we have partial data, stop gracefully.
          if (byId.size > 0) {
            console.warn(
              `[orders] history ${label} incomplete after timeouts (${byId.size} rows kept)`
            )
            break
          }
          throw error
        }
        throw error
      }

      consecutiveTimeouts = 0
      if (!data?.length) break
      for (const row of data) byId.set(row.id, row)
      cursor = data[data.length - 1].id
      if (typeof onPage === 'function') onPage([...byId.values()])
      if (data.length < pageSize) break
    }

    const rows = [...byId.values()]
    if (rows.length) historyMonthCache.set(label, rows)
    return rows
  })().finally(() => {
    historyMonthInflight.delete(label)
  })

  historyMonthInflight.set(label, inflight)
  return inflight
}

export function clearOrderUploadCache() {
  cachedOrders = null
  ordersInflight = null
  ordersFetchGeneration += 1
  historyMonthCache.clear()
  historyMonthInflight.clear()
}

export async function loadOrderUploadSummary() {
  try {
    const preview = await fetchOrderUploadPreview(25).catch((err) => {
      if (isMissingOrderUploadTable(err)) throw err
      console.warn('[orders] preview failed:', err?.message || err)
      return []
    })

    const probe = await supabase.from(ORDER_UPLOAD_TABLE).select('id').limit(1)
    if (probe.error) {
      if (isMissingOrderUploadTable(probe.error)) {
        return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
      }
      throw probe.error
    }

    if (!probe.data?.length) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true }
    }

    let count = 0
    try {
      count = await fetchOrderUploadCount()
    } catch (err) {
      if (isMissingOrderUploadTable(err)) throw err
      count = preview.length
    }
    if (count === 0 && preview.length > 0) count = preview.length

    let months = []
    try {
      months = await fetchOrderUploadMonths()
    } catch (err) {
      console.warn('[orders] months failed:', err?.message || err)
      months = collectMonthsFromRows(preview)
    }
    months = mergeMonthLists(months, collectMonthsFromRows(preview))

    const lastUploadAt = await fetchLastUploadAtSafe(ORDER_UPLOAD_TABLE)
    return { count, preview, months, lastUploadAt, fromDb: true }
  } catch (err) {
    if (isMissingOrderUploadTable(err)) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
    }
    if (isStatementTimeout(err)) {
      console.warn('[orders] summary timed out:', err.message || err)
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true, timedOut: true }
    }
    throw err
  }
}

/** Fast UI refresh after upload — estimated count only (no exact COUNT(*)). */
export async function refreshOrderUploadSummaryAfterSave(savedRows = [], { previousCount = 0 } = {}) {
  const preview = savedRows.length
    ? savedRows.slice(0, 25)
    : await fetchOrderUploadPreview(25).catch(() => [])

  let months = collectMonthsFromRows(savedRows)
  try {
    months = mergeMonthLists(months, await fetchOrderUploadMonths())
  } catch {
    months = mergeMonthLists(months, collectMonthsFromRows(preview))
  }

  const lastUploadAt = await fetchLastUploadAtSafe(ORDER_UPLOAD_TABLE)

  let count = previousCount
  try {
    count = await fetchOrderUploadCount()
  } catch {
    count = Math.max(previousCount, preview.length)
  }

  return { count, preview, months, lastUploadAt, fromDb: true }
}
