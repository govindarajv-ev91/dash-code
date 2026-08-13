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

export const MANUAL_COLLATION_TABLE = 'manual_collation_data'
export const MANUAL_COLLATION_COLUMNS = '*'

export function isMissingManualCollationTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('manual_collation_data') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export async function fetchManualCollationCount() {
  return fetchTableCount(MANUAL_COLLATION_TABLE)
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
  await deleteRowsInBatches(MANUAL_COLLATION_TABLE)
  clearManualCollationCache()
}

export async function clearManualCollationDataByMonth(month) {
  const label = (month ?? '').toString().trim()
  if (!label) return clearManualCollationData()
  await deleteRowsInBatches(MANUAL_COLLATION_TABLE, { month: label })
  clearManualCollationCache()
}

export async function fetchManualCollationMonths() {
  const probe = await supabase.from(MANUAL_COLLATION_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error
  if (!probe.data?.length) return []

  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_manual_collation_months')
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const labels = rpcData.map((row) => (typeof row === 'string' ? row : row?.month))
    return mergeMonthLists(labels)
  }

  if (rpcError) {
    console.warn('[manual-collation] distinct months RPC failed, using sample:', rpcError.message || rpcError)
  }

  return fetchMonthsSampled(MANUAL_COLLATION_TABLE)
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
    const { data } = await fetchAllData(MANUAL_COLLATION_TABLE, MANUAL_COLLATION_COLUMNS, 'id', {
      useKeyset: true,
      maxRetries: 10,
    })
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
    const preview = await fetchManualCollationPreview(25).catch((err) => {
      if (isMissingManualCollationTable(err)) throw err
      return []
    })

    const probe = await supabase.from(MANUAL_COLLATION_TABLE).select('id').limit(1)
    if (probe.error) {
      if (isMissingManualCollationTable(probe.error)) {
        return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
      }
      throw probe.error
    }
    if (!probe.data?.length) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true }
    }

    let count = 0
    try {
      count = await fetchManualCollationCount()
    } catch (err) {
      if (isMissingManualCollationTable(err)) throw err
      count = preview.length
    }
    if (count === 0 && preview.length > 0) count = preview.length

    let months = []
    try {
      months = await fetchManualCollationMonths()
    } catch {
      months = collectMonthsFromRows(preview)
    }
    months = mergeMonthLists(months, collectMonthsFromRows(preview))
    const lastUploadAt = await fetchLastUploadAtSafe(MANUAL_COLLATION_TABLE)
    return { count, preview, months, lastUploadAt, fromDb: true }
  } catch (err) {
    if (isMissingManualCollationTable(err)) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
    }
    if (isStatementTimeout(err)) {
      console.warn('[manual-collation] summary timed out:', err.message || err)
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true, timedOut: true }
    }
    throw err
  }
}

export function getManualCollationDbSetupMessage() {
  return 'Database table missing. Run sql/create_rider_payment_tables.sql in Supabase SQL Editor, then upload again.'
}
