import { eachMonthOfInterval, parseISO } from 'date-fns'
import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'
import {
  collectMonthsFromRows,
  mergeMonthLists,
  isStatementTimeout,
} from './paymentMonthList'
import { mapOrderUploadToRiderMetric, toMetricDateKey } from './mergeRiderMetrics'

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

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Month labels (Jul-2026) covering a yyyy-MM-dd range — for scoped order_upload fetches. */
export function orderUploadMonthLabelsForRange(dateFrom, dateTo) {
  const fromStr = (dateFrom ?? '').toString().trim()
  const toStr = (dateTo ?? '').toString().trim()
  if (!fromStr || !toStr || fromStr > toStr) return []

  const start = parseISO(fromStr)
  const end = parseISO(toStr)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []

  return [
    ...new Set(
      eachMonthOfInterval({ start, end }).map(
        (d) => `${MONTH_LABEL[d.getMonth()]}-${d.getFullYear()}`
      )
    ),
  ]
}

function filterMappedOrderRowsToDateRange(rows, dateFrom, dateTo) {
  const from = (dateFrom ?? '').toString().trim()
  const to = (dateTo ?? '').toString().trim()
  if (!from || !to) return []

  const out = []
  for (const row of rows || []) {
    const dateKey = (row.date_record ?? '').toString().trim()
    if (dateKey && dateKey >= from && dateKey <= to) out.push(row)
  }
  return out
}

/**
 * Fetch order_upload_data for a date range via month index (fast).
 * Avoids loading the entire order_upload_data table.
 */
export async function fetchOrderUploadsForDateRange(dateFrom, dateTo, { force = false } = {}) {
  const from = (dateFrom ?? '').toString().trim()
  const to = (dateTo ?? '').toString().trim()
  if (!from || !to || from > to) return []

  const labels = orderUploadMonthLabelsForRange(from, to)
  if (!labels.length) return []

  const monthChunks = await Promise.all(
    labels.map((label) => fetchOrderUploadsForHistory(label, { force }))
  )

  const mapped = []
  for (const rows of monthChunks) {
    for (const row of rows || []) {
      const metric = mapOrderUploadToRiderMetric(row)
      if (metric) mapped.push(metric)
    }
  }

  return filterMappedOrderRowsToDateRange(mapped, from, to)
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

/** Planner statistics only: never retry a slow count with COUNT(*). */
export async function fetchOrderUploadCount() {
  const { count, error } = await supabase.from(ORDER_UPLOAD_TABLE)
    .select('id', { count: 'planned', head: true })
    .abortSignal(AbortSignal.timeout(5000))
  if (error) throw error
  if (count == null) throw new Error('Order count is unavailable')
  return count
}

const ORDER_UPLOAD_PREVIEW_SELECT = `${ORDER_UPLOAD_COLUMNS},created_at`

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
  // Invalidate history and older fetches without labelling a single file as a
  // complete database cache. A complete cache can be patched without a refetch.
  ordersFetchGeneration += 1
  ordersInflight = null
  historyMonthCache.clear()
  historyMonthInflight.clear()
  const byKey = new Map()
  for (const row of cachedOrders || []) {
    byKey.set(orderUploadRowKey(row), row)
  }
  for (const row of incomingRows) {
    byKey.set(orderUploadRowKey(row), row)
  }
  const merged = [...byKey.values()]
  if (cachedOrders) cachedOrders = merged
  return merged
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
  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_order_upload_months')
    .abortSignal(AbortSignal.timeout(5000))
  if (!rpcError && Array.isArray(rpcData)) {
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

export async function saveOrderUploadRows(rows, { replace = false, onProgress } = {}) {
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

  const chunkSize = 500
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

  // Two bounded requests overlap network latency without flooding the database.
  // Stop scheduling after a failure and settle active writes before reporting it.
  let next = 0
  let failure = null
  const writeNext = async () => {
    while (!failure && next < uniqueRows.length) {
      const start = next
      next += chunkSize
      try {
        const written = await writeOrderUploadChunk(uniqueRows.slice(start, start + chunkSize), { upsert: true })
        saved += written
        onProgress?.({ saved, total: uniqueRows.length })
      } catch (err) {
        failure ||= err
      }
    }
  }
  await Promise.all([writeNext(), writeNext()])
  if (failure) {
    // Earlier chunks may already have committed; discard caches on partial saves.
    clearOrderUploadCache()
    throw failure
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
    const [first, last] = await Promise.all([
      supabase.from(ORDER_UPLOAD_TABLE).select('id').order('id', { ascending: true }).limit(1),
      supabase.from(ORDER_UPLOAD_TABLE).select('id').order('id', { ascending: false }).limit(1),
    ])
    if (first.error) throw first.error
    if (last.error) throw last.error

    const ranges = []
    if (first.data?.length && last.data?.length) {
      const firstId = BigInt(first.data[0].id)
      const lastId = BigInt(last.data[0].id)
      const size = (lastId - firstId + 8n) / 8n
      for (let from = firstId; from <= lastId; from += size) {
        const to = from + size - 1n
        ranges.push({ from: from.toString(), to: (to > lastId ? lastId : to).toString() })
      }
    }

    // Independent ID ranges avoid hundreds of serial requests. Numeric ranges
    // include legacy dates and blank month labels without relying on metadata.
    const pages = new Array(ranges.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(4, ranges.length) }, async () => {
      while (next < ranges.length) {
        const index = next++
        const range = ranges[index]
        const { data } = await fetchAllData(ORDER_UPLOAD_TABLE, ORDER_UPLOAD_COLUMNS, 'id', {
          useKeyset: true,
          maxRetries: 2,
          pageSize: 1000,
          throwOnError: true,
          untilEmpty: true,
          queryModifier: (query) => query.gte('id', range.from).lte('id', range.to),
        })
        pages[index] = data || []
      }
    }))
    const rows = pages.flat()

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

  const generation = ordersFetchGeneration
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
          await new Promise((r) => setTimeout(r, Math.min(400 * consecutiveTimeouts, 1000)))
          continue
        }
        throw error
      }

      consecutiveTimeouts = 0
      if (!data?.length) break
      for (const row of data) byId.set(row.id, row)
      const nextCursor = data[data.length - 1].id
      if (nextCursor == null || (cursor != null && BigInt(nextCursor) <= BigInt(cursor))) {
        throw new Error('Could not read complete order history. Refresh to retry.')
      }
      cursor = nextCursor
      if (typeof onPage === 'function') onPage([...byId.values()])
      if (data.length < pageSize) break
    }

    const rows = [...byId.values()]
    // Never cache a partial month or a pull invalidated by a newer upload/refresh.
    if (generation === ordersFetchGeneration && historyMonthInflight.get(label) === inflight) {
      historyMonthCache.set(label, rows)
    }
    return rows
  })().finally(() => {
    if (historyMonthInflight.get(label) === inflight) historyMonthInflight.delete(label)
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

export async function loadOrderUploadSummary({ onPreview } = {}) {
  try {
    // This indexed preview also supplies table existence and latest timestamp.
    const preview = await fetchOrderUploadPreview(25)
    if (!preview.length) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true }
    }
    const summary = {
      count: preview.length, countIsLowerBound: true, preview,
      months: collectMonthsFromRows(preview),
      lastUploadAt: preview[0]?.created_at || null, fromDb: true,
    }
    onPreview?.(summary)
    const [countResult, monthsResult] = await Promise.allSettled([
      fetchOrderUploadCount(), fetchOrderUploadMonths(),
    ])
    if (countResult.status === 'fulfilled') {
      summary.count = Math.max(countResult.value, preview.length)
      summary.countIsLowerBound = countResult.value < preview.length
    }
    if (monthsResult.status === 'fulfilled') {
      summary.months = mergeMonthLists(monthsResult.value, summary.months)
    }
    return summary
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

/** Show success immediately; metadata refresh runs separately from the save. */
export function refreshOrderUploadSummaryAfterSave(
  savedRows = [], { previousCount = 0, previousMonths = [] } = {},
) {
  return {
    // Upserted rows may already exist. Do not add the file size to the DB count.
    count: Math.max(previousCount, savedRows.length),
    preview: savedRows.slice(0, 25),
    months: mergeMonthLists(previousMonths, collectMonthsFromRows(savedRows)),
    lastUploadAt: savedRows.length ? new Date().toISOString() : null,
    fromDb: true,
  }
}
