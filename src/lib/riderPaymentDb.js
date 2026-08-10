import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'
import {
  collectMonthsFromRows,
  mergeMonthLists,
  fetchTableCount,
  fetchLastUploadAtSafe,
  fetchMonthsSampled,
  isStatementTimeout,
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
  const { error } = await supabase.from(RIDER_PAYMENT_TABLE).delete().neq('id', 0)
  if (error) throw error
  clearRiderPaymentCache()
}

export async function clearRiderPaymentDataByMonth(month) {
  const label = (month ?? '').toString().trim()
  if (!label) return clearRiderPaymentData()
  const { error } = await supabase.from(RIDER_PAYMENT_TABLE).delete().eq('month', label)
  if (error) throw error
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
    await clearRiderPaymentData()
  }

  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from(RIDER_PAYMENT_TABLE).insert(chunk)
    if (error) throw error
    inserted += chunk.length
  }
  clearRiderPaymentCache()
  return inserted
}

let cachedPayments = null
let paymentsInflight = null
const PAYMENT_FETCH_CACHE_VERSION = 2
let cachedPaymentsVersion = 0
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

export function clearRiderPaymentCache() {
  cachedPayments = null
  paymentsInflight = null
  cachedPaymentsVersion = 0
  cachedRevenue = null
  revenueInflight = null
  cachedRevenueVersion = 0
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
