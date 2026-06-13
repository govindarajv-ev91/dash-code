import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'
import { collectMonthsFromRows, mergeMonthLists } from './paymentMonthList'

export const RIDER_PAYMENT_TABLE = 'rider_payment_data'
export const RIDER_PAYMENT_COLUMNS = '*'

export function isMissingRiderPaymentTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('rider_payment_data') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export async function fetchRiderPaymentCount() {
  const probe = await supabase.from(RIDER_PAYMENT_TABLE).select('id', { count: 'exact', head: true })
  if (probe.error) throw probe.error
  return probe.count ?? 0
}

export async function fetchRiderPaymentPreview(limit = 50) {
  const { data, error } = await supabase
    .from(RIDER_PAYMENT_TABLE)
    .select('*')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
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

  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_rider_payment_months')
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const labels = rpcData.map((row) => (typeof row === 'string' ? row : row?.month))
    return mergeMonthLists(labels)
  }

  const { data } = await fetchAllData(RIDER_PAYMENT_TABLE, 'month,id', 'id', { useKeyset: true })
  return collectMonthsFromRows(data)
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

export async function fetchAllRiderPayments({ force = false } = {}) {
  if (!force && cachedPayments) return cachedPayments
  if (!force && paymentsInflight) return paymentsInflight

  paymentsInflight = (async () => {
    const probe = await supabase.from(RIDER_PAYMENT_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    const { data } = await fetchAllData(RIDER_PAYMENT_TABLE, RIDER_PAYMENT_COLUMNS, 'id', { useKeyset: true })
    cachedPayments = data || []
    return cachedPayments
  })().finally(() => {
    paymentsInflight = null
  })

  return paymentsInflight
}

export function clearRiderPaymentCache() {
  cachedPayments = null
  paymentsInflight = null
}

export async function loadRiderPaymentSummary() {
  try {
    const [count, preview] = await Promise.all([
      fetchRiderPaymentCount(),
      fetchRiderPaymentCount().then((n) => (n > 0 ? fetchRiderPaymentPreview(25) : [])),
    ])
    let months = []
    try {
      months = await fetchRiderPaymentMonths()
    } catch {
      months = collectMonthsFromRows(preview)
    }
    months = mergeMonthLists(months, collectMonthsFromRows(preview))
    return { count, preview, months, fromDb: true }
  } catch (err) {
    if (isMissingRiderPaymentTable(err)) {
      return { count: 0, preview: [], months: [], fromDb: false, missingTable: true }
    }
    throw err
  }
}

export function getRiderPaymentDbSetupMessage() {
  return 'Database table missing. Run sql/create_rider_payment_tables.sql in Supabase SQL Editor, then upload again.'
}
