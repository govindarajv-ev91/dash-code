import { format } from 'date-fns'
import { supabase } from './supabaseClient'
import { fetchLastUploadAt } from './paymentMonthList'
import { fetchAllData } from './supabaseFetch'
import { parseMetricDate } from './riderPerformanceReport'

/** Slim rider_metrics columns for IoT order counts (per date range). */
export const IOT_RIDER_ORDER_COLUMNS =
  'id,delivered,date_record,worker_code,mob_number'

let cachedRiderOrderFetch = null
let cachedRiderOrderKey = ''

/** Keep rider_metrics rows whose date_record falls in [dateFrom, dateTo] (yyyy-MM-dd). */
export function filterRiderRowsToDateRange(rows, dateFrom, dateTo) {
  const from = (dateFrom ?? '').toString().trim()
  const to = (dateTo ?? '').toString().trim()
  if (!from || !to) return []

  const out = []
  for (const row of rows || []) {
    const date = parseMetricDate(row.date_record)
    if (!date) continue
    const dateKey = format(date, 'yyyy-MM-dd')
    if (dateKey >= from && dateKey <= to) out.push(row)
  }
  return out
}

async function fetchRiderOrdersByDateFilter(dateFrom, dateTo) {
  const from = dateFrom.trim()
  const to = dateTo.trim()
  const all = []
  let cursor = null
  const pageSize = 1000

  while (true) {
    let query = supabase
      .from('rider_metrics')
      .select(IOT_RIDER_ORDER_COLUMNS)
      .gte('date_record', from)
      .lte('date_record', to)
      .order('id', { ascending: true })
      .limit(pageSize)

    if (cursor != null) query = query.gt('id', cursor)

    const { data, error } = await query
    if (error) throw error
    if (!data?.length) break

    all.push(...data)
    const lastId = data[data.length - 1]?.id
    if (lastId == null || data.length < pageSize) break
    cursor = lastId
  }

  return filterRiderRowsToDateRange(all, from, to)
}

/** Rider order rows for IoT date range — fetched on-page so production does not depend on App cache timing. */
export async function fetchRiderOrdersForIot(dateFrom, dateTo, { fallbackRows = [] } = {}) {
  const from = (dateFrom ?? '').toString().trim()
  const to = (dateTo ?? '').toString().trim()
  if (!from || !to || from > to) return []

  const cacheKey = `${from}|${to}`
  if (cachedRiderOrderKey === cacheKey && cachedRiderOrderFetch) {
    return cachedRiderOrderFetch
  }

  const load = (async () => {
    try {
      const scoped = await fetchRiderOrdersByDateFilter(from, to)
      if (scoped.length) return scoped
    } catch (err) {
      console.warn('[IoT] rider_metrics date-scoped fetch failed:', err?.message || err)
    }

    try {
      const { data } = await fetchAllData('rider_metrics', IOT_RIDER_ORDER_COLUMNS, 'id', {
        pageSize: 1000,
        maxRetries: 8,
      })
      const filtered = filterRiderRowsToDateRange(data || [], from, to)
      if (filtered.length) return filtered
    } catch (err) {
      console.warn('[IoT] rider_metrics full fetch failed, using fallback:', err?.message || err)
    }

    return filterRiderRowsToDateRange(fallbackRows || [], from, to)
  })()

  cachedRiderOrderKey = cacheKey
  cachedRiderOrderFetch = load
  return load
}

export function clearIotRiderOrderCache() {
  cachedRiderOrderFetch = null
  cachedRiderOrderKey = ''
}

/** Live Supabase table (Alt Mobility / pipeline ingest). */
export const IOT_TABLE = 'iot_data'
export const IOT_COLUMNS =
  'id,vehicle_number,run_date,total_distance,data_source,raw_vehicle_id,vehicle_master_id,lookup_matched,lookup_match_type,created_at'

export function isMissingIotTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('iot_data') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export function getIotDbSetupMessage() {
  return 'iot_data table not found or not readable. Check Supabase table and RLS policies for anon read access.'
}

export async function fetchIotDataCount() {
  const probe = await supabase.from(IOT_TABLE).select('id', { count: 'exact', head: true })
  if (probe.error) throw probe.error
  return probe.count ?? 0
}

export async function fetchIotDataInRange(dateFrom, dateTo) {
  const from = (dateFrom ?? '').toString().trim()
  const to = (dateTo ?? '').toString().trim()
  if (!from || !to) return []

  const all = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from(IOT_TABLE)
      .select(IOT_COLUMNS)
      .gte('run_date', from)
      .lte('run_date', to)
      .order('run_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  return all
}

export async function saveIotRows(rows) {
  if (!rows?.length) return 0

  const chunkSize = 500
  let saved = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from(IOT_TABLE).insert(chunk)
    if (error) throw error
    saved += chunk.length
  }
  return saved
}

export async function loadIotSummary() {
  try {
    const count = await fetchIotDataCount()
    const lastUploadAt = count > 0 ? await fetchLastUploadAt(IOT_TABLE) : null
    return { count, lastUploadAt, fromDb: true }
  } catch (err) {
    if (isMissingIotTable(err)) {
      return { count: 0, lastUploadAt: null, fromDb: false, missingTable: true }
    }
    throw err
  }
}
