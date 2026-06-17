import { supabase } from './supabaseClient'

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

/** Latest row created_at for a payment upload table (null if empty). */
export async function fetchLastUploadAt(tableName) {
  if (!tableName) return null
  const probe = await supabase.from(tableName).select('id').limit(1)
  if (probe.error) throw probe.error
  if (!probe.data?.length) return null

  const { data, error } = await supabase
    .from(tableName)
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.created_at ?? null
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
