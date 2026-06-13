import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'
import { collectMonthsFromRows, mergeMonthLists } from './paymentMonthList'

export const MANUAL_COLLATION_TABLE = 'manual_collation_data'
export const MANUAL_COLLATION_COLUMNS = '*'

export function isMissingManualCollationTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('manual_collation_data') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export async function fetchManualCollationCount() {
  const probe = await supabase.from(MANUAL_COLLATION_TABLE).select('id', { count: 'exact', head: true })
  if (probe.error) throw probe.error
  return probe.count ?? 0
}

export async function fetchManualCollationPreview(limit = 50) {
  const { data, error } = await supabase
    .from(MANUAL_COLLATION_TABLE)
    .select('*')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function clearManualCollationData() {
  const { error } = await supabase.from(MANUAL_COLLATION_TABLE).delete().neq('id', 0)
  if (error) throw error
  clearManualCollationCache()
}

export async function clearManualCollationDataByMonth(month) {
  const label = (month ?? '').toString().trim()
  if (!label) return clearManualCollationData()
  const { error } = await supabase.from(MANUAL_COLLATION_TABLE).delete().eq('month', label)
  if (error) throw error
  clearManualCollationCache()
}

export async function fetchManualCollationMonths() {
  const probe = await supabase.from(MANUAL_COLLATION_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error

  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_manual_collation_months')
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const labels = rpcData.map((row) => (typeof row === 'string' ? row : row?.month))
    return mergeMonthLists(labels)
  }

  const { data } = await fetchAllData(MANUAL_COLLATION_TABLE, 'month,id', 'id', { useKeyset: true })
  return collectMonthsFromRows(data)
}

export async function saveManualCollationRows(rows, { replace = true } = {}) {
  if (!rows?.length) return 0

  if (replace) {
    await clearManualCollationData()
  }

  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from(MANUAL_COLLATION_TABLE).insert(chunk)
    if (error) throw error
    inserted += chunk.length
  }
  clearManualCollationCache()
  return inserted
}

let cachedCollation = null
let collationInflight = null

export async function fetchAllManualCollation({ force = false } = {}) {
  if (!force && cachedCollation) return cachedCollation
  if (!force && collationInflight) return collationInflight

  collationInflight = (async () => {
    const probe = await supabase.from(MANUAL_COLLATION_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    const { data } = await fetchAllData(MANUAL_COLLATION_TABLE, MANUAL_COLLATION_COLUMNS, 'id', { useKeyset: true })
    cachedCollation = data || []
    return cachedCollation
  })().finally(() => {
    collationInflight = null
  })

  return collationInflight
}

export function clearManualCollationCache() {
  cachedCollation = null
  collationInflight = null
}

export async function loadManualCollationSummary() {
  try {
    const [count, preview] = await Promise.all([
      fetchManualCollationCount(),
      fetchManualCollationCount().then((n) => (n > 0 ? fetchManualCollationPreview(25) : [])),
    ])
    let months = []
    try {
      months = await fetchManualCollationMonths()
    } catch {
      months = collectMonthsFromRows(preview)
    }
    months = mergeMonthLists(months, collectMonthsFromRows(preview))
    return { count, preview, months, fromDb: true }
  } catch (err) {
    if (isMissingManualCollationTable(err)) {
      return { count: 0, preview: [], months: [], fromDb: false, missingTable: true }
    }
    throw err
  }
}

export function getManualCollationDbSetupMessage() {
  return 'Database table missing. Run sql/create_rider_payment_tables.sql in Supabase SQL Editor, then upload again.'
}
