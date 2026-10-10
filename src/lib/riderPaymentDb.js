import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'
import {
  collectMonthsFromRows,
  mergeMonthLists,
  fetchTableCount,
  fetchLastUploadAtSafe,
  fetchMonthsSampled,
  isStatementTimeout,
  deleteRowsInBatches,
} from './paymentMonthList'

export const RIDER_PAYMENT_TABLE = 'rider_payment_data'
/** Slim select for Payment History (avoids pulling unused columns). */
export const RIDER_PAYMENT_COLUMNS = [
  'id',
  'client_name',
  'type',
  'week',
  'month',
  'rider_id',
  'rider_name',
  'city',
  'orders',
  'payout_1',
  'payout_2',
  'gross_payout',
  'tds',
  'cod_deduction',
  'cod_recovery',
  'client_deductions',
  'sd',
  'damage',
  'insurance',
  'fleet',
  'traffic',
  'on_hold',
  'ev_rent',
  'final_net_payout',
  'payment_status',
  'payment_date',
  'utr_number',
  'vehicle_number',
  'period_start',
  'period_label',
  'rider_key',
  'is_first_rider',
  'source_name',
].join(',')

export function isMissingRiderPaymentTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('rider_payment_data') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export async function fetchRiderPaymentCount() {
  return fetchTableCount(RIDER_PAYMENT_TABLE)
}

/** Columns shown on the upload page preview (avoid select * on wide rows). */
const RIDER_PAYMENT_PREVIEW_COLUMNS = [
  'id',
  'rider_id',
  'rider_name',
  'client_name',
  'city',
  'month',
  'orders',
  'final_net_payout',
  'payment_status',
  'period_start',
  'period_label',
  'rider_key',
  'is_first_rider',
  'source_name',
].join(',')

export async function fetchRiderPaymentPreview(limit = 50) {
  let pageLimit = limit
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from(RIDER_PAYMENT_TABLE)
      .select(RIDER_PAYMENT_PREVIEW_COLUMNS)
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

export async function clearRiderPaymentData() {
  await deleteRowsInBatches(RIDER_PAYMENT_TABLE)
  clearRiderPaymentCache()
}

export async function clearRiderPaymentDataByMonth(month) {
  const label = (month ?? '').toString().trim()
  if (!label) return clearRiderPaymentData()
  await deleteRowsInBatches(RIDER_PAYMENT_TABLE, { month: label })
  clearRiderPaymentCache()
}

export async function fetchRiderPaymentMonths() {
  const probe = await supabase.from(RIDER_PAYMENT_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error
  if (!probe.data?.length) return []

  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_rider_payment_months')
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const labels = rpcData.map((row) => (typeof row === 'string' ? row : row?.month))
    return mergeMonthLists(labels)
  }

  if (rpcError) {
    console.warn('[rider-payment] distinct months RPC failed, using sample:', rpcError.message || rpcError)
  }

  // Do NOT fetchAllData the whole table — that times out on large uploads.
  return fetchMonthsSampled(RIDER_PAYMENT_TABLE)
}

export async function saveRiderPaymentRows(rows, { replace = true } = {}) {
  if (!rows?.length) return 0

  if (replace) {
    // Prefer clearing only months in this file — full-table wipe times out on large data.
    const monthsInFile = collectMonthsFromRows(rows)
    if (monthsInFile.length) {
      for (const month of monthsInFile) {
        await clearRiderPaymentDataByMonth(month)
      }
    } else {
      await clearRiderPaymentData()
    }
  }

  // Wide payment rows: small chunks + shrink on statement_timeout
  let chunkSize = 100
  let inserted = 0
  let i = 0
  try {
    while (i < rows.length) {
      const chunk = rows.slice(i, i + chunkSize)
      const { data, error } = await supabase
        .from(RIDER_PAYMENT_TABLE)
        .upsert(chunk, { onConflict: 'upload_dedupe_key', ignoreDuplicates: true })
        .select('id')
      if (error) {
        if (isStatementTimeout(error) && chunkSize > 20) {
          chunkSize = Math.max(20, Math.floor(chunkSize / 2))
          console.warn(
            `[rider-payment] insert timed out; retrying with chunk size ${chunkSize}`
          )
          await new Promise((r) => setTimeout(r, 400))
          continue
        }
        throw error
      }
      inserted += data?.length || 0
      i += chunk.length
    }
  } finally {
    clearRiderPaymentCache()
  }
  return inserted
}

let cachedPayments = null
let paymentsInflight = null
const PAYMENT_FETCH_CACHE_VERSION = 2
let cachedPaymentsVersion = 0
const rangedPaymentsCache = new Map()
const rangedPaymentsInflight = new Map()
let paymentCacheGeneration = 0
/** Only fields used by Client Period Trend; full payment details load on export. */
export const RIDER_PAYMENT_TREND_COLUMNS =
  'id,client_name,week,month,rider_id,rider_name,city,orders,gross_payout,period_start,period_label,rider_key,source_name'

function paymentDateRanges(fromDate, toDate) {
  // Partition by calendar month so independent keyset scans can run concurrently.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) ||
      Number.isNaN(new Date(`${fromDate}T00:00:00`).getTime()) ||
      Number.isNaN(new Date(`${toDate}T00:00:00`).getTime())) {
    return [{ fromDate, toDate }]
  }
  const ranges = []
  let start = fromDate
  while (start <= toDate) {
    const [year, month] = start.split('-').map(Number)
    const end = `${start.slice(0, 7)}-${new Date(year, month, 0).getDate()}`
    ranges.push({ fromDate: start, toDate: end < toDate ? end : toDate })
    start = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`
  }
  return ranges
}
/** Slim revenue/overview cache for General Overview. */
let cachedRevenue = null
let revenueInflight = null
const REVENUE_CACHE_VERSION = 3
let cachedRevenueVersion = 0

export async function fetchAllRiderPayments({ force = false } = {}) {
  if (
    !force &&
    cachedPayments &&
    cachedPaymentsVersion === PAYMENT_FETCH_CACHE_VERSION
  ) {
    return cachedPayments
  }
  if (!force && paymentsInflight) return paymentsInflight

  paymentsInflight = (async () => {
    const probe = await supabase.from(RIDER_PAYMENT_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    const { data } = await fetchAllData(RIDER_PAYMENT_TABLE, RIDER_PAYMENT_COLUMNS, 'id', {
      useKeyset: true,
      maxRetries: 10,
    })
    cachedPayments = data || []
    cachedPaymentsVersion = PAYMENT_FETCH_CACHE_VERSION
    return cachedPayments
  })().finally(() => {
    paymentsInflight = null
  })

  return paymentsInflight
}

export async function fetchRiderPaymentsForPeriod({ fromDate = '', toDate = '', force = false, slim = false } = {}) {
  if (fromDate && toDate && fromDate > toDate) return []
  const columns = slim ? RIDER_PAYMENT_TREND_COLUMNS : RIDER_PAYMENT_COLUMNS
  const cacheKey = `${columns}|${fromDate}|${toDate}`
  if (!force) {
    for (const cached of rangedPaymentsCache.values()) {
      if (cached.columns === columns &&
          (!cached.fromDate || (fromDate && cached.fromDate <= fromDate)) &&
          (!cached.toDate || (toDate && cached.toDate >= toDate))) {
        return cached.rows.filter((row) => !row.period_start ||
          ((!fromDate || row.period_start >= fromDate) && (!toDate || row.period_start <= toDate)))
      }
    }
  }
  if (!force && rangedPaymentsInflight.has(cacheKey)) return rangedPaymentsInflight.get(cacheKey)

  const generation = paymentCacheGeneration
  const request = (async () => {
    const ranges = paymentDateRanges(fromDate, toDate)
    const pages = new Array(ranges.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(4, ranges.length) }, async () => {
      while (next < ranges.length) {
        const index = next++
        const range = ranges[index]
        const { data } = await fetchAllData(RIDER_PAYMENT_TABLE, columns, 'id', {
          useKeyset: true,
          pageSize: 1000,
          maxRetries: 2,
          throwOnError: true,
          queryModifier: (query) => {
            let filtered = query
            if (range.fromDate) filtered = filtered.gte('period_start', range.fromDate)
            if (range.toDate) filtered = filtered.lte('period_start', range.toDate)
            return filtered
          },
        })
        pages[index] = data || []
      }
    }))
    let rows = pages.flat().sort((a, b) => Number(a.id) - Number(b.id))
    // Older uploads may not have period_start; let the page derive it from week/month.
    if (!rows.length && fromDate && toDate) rows = await fetchAllRiderPayments({ force })
    if (generation === paymentCacheGeneration) {
      rangedPaymentsCache.set(cacheKey, { columns, fromDate, toDate, rows })
    }
    return rows
  })().finally(() => {
    if (rangedPaymentsInflight.get(cacheKey) === request) rangedPaymentsInflight.delete(cacheKey)
  })

  rangedPaymentsInflight.set(cacheKey, request)
  return request
}

export function clearRiderPaymentCache() {
  paymentCacheGeneration++
  cachedPayments = null
  paymentsInflight = null
  cachedPaymentsVersion = 0
  cachedRevenue = null
  revenueInflight = null
  cachedRevenueVersion = 0
  rangedPaymentsCache.clear()
  rangedPaymentsInflight.clear()
}

/** Slim columns for General Overview payment charts (revenue / riders / orders / client). */
export const RIDER_PAYMENT_REVENUE_COLUMNS =
  'id,month,client_name,rider_id,orders,gross_payout,final_net_payout'

export async function fetchRiderPaymentsForRevenue({ force = false } = {}) {
  if (!force && cachedRevenue && cachedRevenueVersion === REVENUE_CACHE_VERSION) {
    return cachedRevenue
  }
  if (!force && revenueInflight) return revenueInflight

  revenueInflight = (async () => {
    const probe = await supabase.from(RIDER_PAYMENT_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    if (!probe.data?.length) {
      cachedRevenue = []
      cachedRevenueVersion = REVENUE_CACHE_VERSION
      return cachedRevenue
    }
    const { data } = await fetchAllData(RIDER_PAYMENT_TABLE, RIDER_PAYMENT_REVENUE_COLUMNS, 'id', {
      useKeyset: true,
      maxRetries: 10,
      pageSize: 1000,
    })
    cachedRevenue = data || []
    cachedRevenueVersion = REVENUE_CACHE_VERSION
    return cachedRevenue
  })().finally(() => {
    revenueInflight = null
  })

  return revenueInflight
}

export async function loadRiderPaymentSummary() {
  try {
    // Preview first — cheap PK lookup; proves the table is readable.
    const preview = await fetchRiderPaymentPreview(25).catch((err) => {
      if (isMissingRiderPaymentTable(err)) throw err
      console.warn('[rider-payment] preview failed:', err?.message || err)
      return []
    })

    const probe = await supabase.from(RIDER_PAYMENT_TABLE).select('id').limit(1)
    if (probe.error) {
      if (isMissingRiderPaymentTable(probe.error)) {
        return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
      }
      throw probe.error
    }

    if (!probe.data?.length) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true }
    }

    let count = 0
    try {
      count = await fetchRiderPaymentCount()
    } catch (err) {
      if (isMissingRiderPaymentTable(err)) throw err
      count = preview.length
    }
    if (count === 0 && preview.length > 0) count = preview.length

    let months = []
    try {
      months = await fetchRiderPaymentMonths()
    } catch (err) {
      console.warn('[rider-payment] months failed:', err?.message || err)
      months = collectMonthsFromRows(preview)
    }
    months = mergeMonthLists(months, collectMonthsFromRows(preview))

    const lastUploadAt = await fetchLastUploadAtSafe(RIDER_PAYMENT_TABLE)
    return { count, preview, months, lastUploadAt, fromDb: true }
  } catch (err) {
    if (isMissingRiderPaymentTable(err)) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
    }
    // Never surface statement timeouts as a hard page failure — show empty section instead.
    if (isStatementTimeout(err)) {
      console.warn('[rider-payment] summary timed out:', err.message || err)
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true, timedOut: true }
    }
    throw err
  }
}

export function getRiderPaymentDbSetupMessage() {
  return 'Database table missing. Run sql/create_rider_payment_tables.sql in Supabase SQL Editor, then upload again.'
}

export function getRiderPaymentTimeoutMessage() {
  return 'Upload timed out on a large table. Run sql/fix_rider_payment_timeout.sql in Supabase SQL Editor, then try again. Prefer uploading one month at a time.'
}
