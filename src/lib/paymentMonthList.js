import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'

const MONTH_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

export function normalizeMonthLabel(value) {
  return (value ?? '').toString().trim()
}

export function monthSortKey(label) {
  const text = normalizeMonthLabel(label)
  const m = text.match(/^([A-Za-z]{3})-(\d{4})$/)
  if (m) {
    const monthIndex = MONTH_ABBR[m[1].toLowerCase()]
    const year = Number(m[2])
    if (monthIndex != null && Number.isFinite(year)) return year * 12 + monthIndex
  }
  return text.toLowerCase()
}

export function sortMonthLabels(months) {
  return [...new Set(months.map(normalizeMonthLabel).filter(Boolean))]
    .sort((a, b) => monthSortKey(b) - monthSortKey(a))
}

export function collectMonthsFromRows(rows, field = 'month') {
  const months = []
  for (const row of rows || []) {
    const label = normalizeMonthLabel(row?.[field])
    if (label) months.push(label)
  }
  return sortMonthLabels(months)
}

export function mergeMonthLists(...lists) {
  return sortMonthLabels(lists.flat())
}

export function isStatementTimeout(error) {
  return (
    error?.code === '57014' ||
    /statement timeout|canceling statement/i.test(error?.message || '')
  )
}

/**
 * Row count for upload tables.
 * Prefer estimated count — exact COUNT(*) often hits statement_timeout on large tables.
 * Full id scan is opt-in only (allowFullScan) because it times out on big uploads.
 */
export async function fetchTableCount(tableName, { maxRetries = 8, allowFullScan = false } = {}) {
  if (!tableName) return 0

  const probe = await supabase.from(tableName).select('id').limit(1)
  if (probe.error) throw probe.error
  if (!probe.data?.length) return 0

  const estimated = await supabase.from(tableName).select('id', { count: 'estimated', head: true })
  if (!estimated.error && estimated.count != null && estimated.count > 0) return estimated.count

  const exact = await supabase.from(tableName).select('id', { count: 'exact', head: true })
  if (!exact.error && exact.count != null) return exact.count

  if (!allowFullScan) {
    // Rows exist but counts timed out / unavailable — signal via throw so callers can use preview length
    throw exact.error || estimated.error || new Error(`count unavailable for ${tableName}`)
  }

  const { data } = await fetchAllData(tableName, 'id', 'id', { useKeyset: true, maxRetries })
  return data?.length ?? 0
}

/**
 * Sample recent rows for distinct month labels — never full-table scan.
 * Used when distinct-*_months RPC is missing or times out.
 */
export async function fetchMonthsSampled(tableName, { field = 'month', maxPages = 30 } = {}) {
  const labels = new Set()
  let cursor = null
  let pageSize = 500

  for (let page = 0; page < maxPages; page++) {
    let q = supabase
      .from(tableName)
      .select(`id,${field}`)
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
      const m = normalizeMonthLabel(row?.[field])
      if (m) labels.add(m)
    }
    cursor = data[data.length - 1].id
    if (labels.size >= 24 && page >= 2) break
    if (data.length < pageSize) break
  }

  return mergeMonthLists([...labels])
}

/** Latest row created_at — order by id (PK) to avoid sorting the whole table. */
export async function fetchLastUploadAt(tableName) {
  if (!tableName) return null
  const probe = await supabase.from(tableName).select('id').limit(1)
  if (probe.error) throw probe.error
  if (!probe.data?.length) return null

  const byId = await supabase
    .from(tableName)
    .select('created_at')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!byId.error && byId.data?.created_at) return byId.data.created_at

  const { data, error } = await supabase
    .from(tableName)
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.created_at ?? null
}

/** Safe last-upload lookup — never fails the parent summary load. */
export async function fetchLastUploadAtSafe(tableName) {
  try {
    return await fetchLastUploadAt(tableName)
  } catch (err) {
    console.warn(`[payment] last upload time for ${tableName}:`, err?.message || err)
    return null
  }
}

export function formatLastUploadAt(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}
