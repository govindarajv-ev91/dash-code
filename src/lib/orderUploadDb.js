import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'
import { collectMonthsFromRows, mergeMonthLists, fetchLastUploadAtSafe } from './paymentMonthList'
import { toMetricDateKey } from './mergeRiderMetrics'

export const ORDER_UPLOAD_TABLE = 'order_upload_data'
export const ORDER_UPLOAD_COLUMNS = '*'

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

/** Exact count only — avoid stale Postgres estimated counts after delete/upload. */
export async function fetchOrderUploadCount() {
  const exact = await supabase
    .from(ORDER_UPLOAD_TABLE)
    .select('id', { count: 'exact', head: true })
  if (exact.error) throw exact.error
  if (exact.count != null) return exact.count

  const probe = await supabase.from(ORDER_UPLOAD_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error
  if (!probe.data?.length) return 0

  const { data } = await fetchAllData(ORDER_UPLOAD_TABLE, 'id', 'id', {
    useKeyset: true,
    maxRetries: 10,
  })
  return data?.length ?? 0
}

export async function fetchOrderUploadPreview(limit = 50) {
  const { data, error } = await supabase
    .from(ORDER_UPLOAD_TABLE)
    .select('*')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
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

export async function fetchOrderUploadMonths() {
  const probe = await supabase.from(ORDER_UPLOAD_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error

  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_order_upload_months')
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const labels = rpcData.map((row) => (typeof row === 'string' ? row : row?.month))
    return mergeMonthLists(labels)
  }

  const { data } = await fetchAllData(ORDER_UPLOAD_TABLE, 'month,id', 'id', { useKeyset: true })
  return collectMonthsFromRows(data)
}

export async function saveOrderUploadRows(rows, { replace = false } = {}) {
  if (!rows?.length) return { saved: 0, unique: 0, skipped: 0 }

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
  if (!uniqueRows.length) return { saved: 0, unique: 0, skipped: skippedInFile }

  if (replace) {
    await clearOrderUploadData()
    const chunkSize = 500
    let inserted = 0
    for (let i = 0; i < uniqueRows.length; i += chunkSize) {
      const chunk = uniqueRows.slice(i, i + chunkSize)
      const { error } = await supabase.from(ORDER_UPLOAD_TABLE).insert(chunk)
      if (error) throw error
      inserted += chunk.length
    }
    clearOrderUploadCache()
    return { saved: inserted, unique: uniqueRows.length, skipped: skippedInFile }
  }

  // Daily upload: upsert on Date + WorkerCode + Client + delivered
  // (e.g. rider 929914 with 11 and 5 orders on same day → both rows kept).
  const chunkSize = 500
  let saved = 0
  for (let i = 0; i < uniqueRows.length; i += chunkSize) {
    const chunk = uniqueRows.slice(i, i + chunkSize)
    const { error } = await supabase.from(ORDER_UPLOAD_TABLE).upsert(chunk, {
      onConflict: 'worker_code,date_record,client,delivered',
      ignoreDuplicates: false,
    })
    if (error) throw error
    saved += chunk.length
  }
  clearOrderUploadCache()
  return { saved, unique: uniqueRows.length, skipped: skippedInFile }
}

let cachedOrders = null
let ordersInflight = null

export async function fetchAllOrderUploads({ force = false } = {}) {
  if (!force && cachedOrders) return cachedOrders
  if (!force && ordersInflight) return ordersInflight

  ordersInflight = (async () => {
    const probe = await supabase.from(ORDER_UPLOAD_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    const { data } = await fetchAllData(ORDER_UPLOAD_TABLE, ORDER_UPLOAD_COLUMNS, 'id', {
      useKeyset: true,
      maxRetries: 10,
    })
    cachedOrders = data || []
    return cachedOrders
  })().finally(() => {
    ordersInflight = null
  })

  return ordersInflight
}

export function clearOrderUploadCache() {
  cachedOrders = null
  ordersInflight = null
}

export async function loadOrderUploadSummary() {
  try {
    // Preview first — if empty, treat as empty table (avoid stale estimated counts).
    const preview = await fetchOrderUploadPreview(25).catch(() => [])
    const probe = await supabase.from(ORDER_UPLOAD_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error

    if (!probe.data?.length) {
      return {
        count: 0,
        preview: [],
        months: [],
        lastUploadAt: null,
        fromDb: true,
      }
    }

    let count = 0
    try {
      count = await fetchOrderUploadCount()
    } catch {
      count = preview.length
    }

    let months = []
    try {
      months = await fetchOrderUploadMonths()
    } catch {
      months = collectMonthsFromRows(preview)
    }
    months = mergeMonthLists(months, collectMonthsFromRows(preview))

    const lastUploadAt = count > 0 ? await fetchLastUploadAtSafe(ORDER_UPLOAD_TABLE) : null
    return { count, preview, months, lastUploadAt, fromDb: true }
  } catch (err) {
    if (isMissingOrderUploadTable(err)) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
    }
    throw err
  }
}
