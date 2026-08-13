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
import { normalizeRiderIdKey } from './riderPerformanceReport'
import { parseFleetDate } from './fleetDeployReturnExport.js'

export const RENTAL_PENDING_TABLE = 'rental_pending_data'
export const RENTAL_PENDING_COLUMNS = '*'

export function isMissingRentalPendingTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('rental_pending_data') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export async function fetchRentalPendingCount() {
  return fetchTableCount(RENTAL_PENDING_TABLE)
}

export async function fetchRentalPendingPreview(limit = 50) {
  const { data, error } = await supabase
    .from(RENTAL_PENDING_TABLE)
    .select('*')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function clearRentalPendingData() {
  await deleteRowsInBatches(RENTAL_PENDING_TABLE)
  clearRentalPendingCache()
}

export async function clearRentalPendingDataByMonth(month) {
  const label = (month ?? '').toString().trim()
  if (!label) return clearRentalPendingData()
  await deleteRowsInBatches(RENTAL_PENDING_TABLE, { month: label })
  clearRentalPendingCache()
}

export async function fetchRentalPendingMonths() {
  const probe = await supabase.from(RENTAL_PENDING_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error
  if (!probe.data?.length) return []

  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_rental_pending_months')
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const labels = rpcData.map((row) => (typeof row === 'string' ? row : row?.month))
    return mergeMonthLists(labels)
  }

  if (rpcError) {
    console.warn('[rental-pending] distinct months RPC failed, using sample:', rpcError.message || rpcError)
  }

  return fetchMonthsSampled(RENTAL_PENDING_TABLE)
}

export async function saveRentalPendingRows(rows, { replace = true } = {}) {
  if (!rows?.length) return 0

  if (replace) {
    await clearRentalPendingData()
  }

  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from(RENTAL_PENDING_TABLE).insert(chunk)
    if (error) throw error
    inserted += chunk.length
  }
  clearRentalPendingCache()
  return inserted
}

let cachedRentalPending = null
let rentalPendingInflight = null

export async function fetchAllRentalPending({ force = false } = {}) {
  if (!force && cachedRentalPending) return cachedRentalPending
  if (!force && rentalPendingInflight) return rentalPendingInflight

  rentalPendingInflight = (async () => {
    const probe = await supabase.from(RENTAL_PENDING_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    const { data } = await fetchAllData(RENTAL_PENDING_TABLE, RENTAL_PENDING_COLUMNS, 'id', {
      useKeyset: true,
      maxRetries: 10,
    })
    cachedRentalPending = data || []
    return cachedRentalPending
  })().finally(() => {
    rentalPendingInflight = null
  })

  return rentalPendingInflight
}

export function clearRentalPendingCache() {
  cachedRentalPending = null
  rentalPendingInflight = null
}

export async function loadRentalPendingSummary() {
  try {
    const preview = await fetchRentalPendingPreview(25).catch((err) => {
      if (isMissingRentalPendingTable(err)) throw err
      return []
    })

    const probe = await supabase.from(RENTAL_PENDING_TABLE).select('id').limit(1)
    if (probe.error) {
      if (isMissingRentalPendingTable(probe.error)) {
        return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
      }
      throw probe.error
    }
    if (!probe.data?.length) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true }
    }

    let count = 0
    try {
      count = await fetchRentalPendingCount()
    } catch (err) {
      if (isMissingRentalPendingTable(err)) throw err
      count = preview.length
    }
    if (count === 0 && preview.length > 0) count = preview.length

    let months = []
    try {
      months = await fetchRentalPendingMonths()
    } catch {
      months = collectMonthsFromRows(preview)
    }
    months = mergeMonthLists(months, collectMonthsFromRows(preview))
    const lastUploadAt = await fetchLastUploadAtSafe(RENTAL_PENDING_TABLE)
    return { count, preview, months, lastUploadAt, fromDb: true }
  } catch (err) {
    if (isMissingRentalPendingTable(err)) {
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: false, missingTable: true }
    }
    if (isStatementTimeout(err)) {
      console.warn('[rental-pending] summary timed out:', err.message || err)
      return { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true, timedOut: true }
    }
    throw err
  }
}

export function getRentalPendingDbSetupMessage() {
  return 'Database table missing. Run sql/create_rider_payment_tables.sql in Supabase SQL Editor, then upload again.'
}

function isNumericWorkerCode(raw) {
  const s = (raw ?? '').toString().trim()
  return /^[\d.\s-]+$/.test(s) && /\d/.test(s)
}

/** Aliases for rental_pending_data.rider_id ↔ fleet performance ID (FE6516583, 6516583, etc.). */
function rentalRiderAliases(value) {
  const aliases = new Set()
  const raw = (value ?? '').toString().trim()
  if (!raw) return aliases

  const idKey = normalizeRiderIdKey(raw)
  if (idKey) aliases.add(idKey)

  const prefixMatch = idKey.match(/^([A-Z]{2,5})(\d+)$/i)
  if (prefixMatch?.[2]?.length >= 5) {
    aliases.add(prefixMatch[2])
    aliases.add(`${prefixMatch[1]}${prefixMatch[2]}`)
  }

  const embeddedFe = idKey.match(/FE(\d{5,})/i)
  if (embeddedFe) {
    aliases.add(`FE${embeddedFe[1]}`)
    aliases.add(embeddedFe[1])
  }

  if (isNumericWorkerCode(raw)) {
    const digits = raw.replace(/\D/g, '')
    if (digits) aliases.add(digits)
  }

  return aliases
}

function rentalRowWeekEnd(row) {
  return parseFleetDate(row?.week_end_date) || null
}

function preferRentalRow(next, prev) {
  const nextWeek = rentalRowWeekEnd(next)
  const prevWeek = rentalRowWeekEnd(prev)
  if (nextWeek && prevWeek) return nextWeek >= prevWeek
  if (nextWeek && !prevWeek) return true
  if (!nextWeek && prevWeek) return false
  return (next.id ?? 0) >= (prev.id ?? 0)
}

/** Map rider ID aliases → latest rental pending row (by week end date). */
export function buildRentalPendingByRiderIndex(rentalRows) {
  const byAlias = new Map()

  for (const row of rentalRows || []) {
    const riderId = (row?.rider_id ?? '').toString().trim()
    if (!riderId) continue

    for (const alias of rentalRiderAliases(riderId)) {
      const prev = byAlias.get(alias)
      if (!prev || preferRentalRow(row, prev)) {
        byAlias.set(alias, row)
      }
    }
  }

  return byAlias
}

/** Actual pending for week after SD for a fleet / performance rider ID. */
export function lookupRentalPendingAmount(index, riderId) {
  if (!index || !riderId) return null

  for (const alias of rentalRiderAliases(riderId)) {
    const row = index.get(alias)
    if (!row) continue
    const amount = row.actual_pending_for_week_after_sd
    if (amount != null && amount !== '') return amount
  }

  return null
}
