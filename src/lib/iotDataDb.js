import { format } from 'date-fns'
import { supabase } from './supabaseClient'
import { fetchLastUploadAt } from './paymentMonthList'
import { parseMetricDate } from './riderPerformanceReport'
import { fetchOrderUploadsForDateRange } from './orderUploadDb'
import { IOT_SOURCES } from './iotDataSources'
import { toText, vehicleMatchKey } from './iotUpload/uploadParseUtils'

/** Keep order rows whose date_record falls in [dateFrom, dateTo] (yyyy-MM-dd). */
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

function onlyOrderUploadRows(rows = []) {
  return (rows || []).filter((r) => r?._data_source === 'order_upload')
}

/** Rider order rows for IoT date range — order_upload_data only (month-scoped fetch). */
export async function fetchRiderOrdersForIot(dateFrom, dateTo, { fallbackRows = [] } = {}) {
  const from = (dateFrom ?? '').toString().trim()
  const to = (dateTo ?? '').toString().trim()
  if (!from || !to || from > to) return []

  try {
    const filtered = await fetchOrderUploadsForDateRange(from, to)
    if (filtered.length) return filtered
  } catch (err) {
    console.warn('[IoT] order_upload_data range fetch failed, using fallback:', err?.message || err)
  }

  return filterRiderRowsToDateRange(onlyOrderUploadRows(fallbackRows), from, to)
}

/** Shared history for all four IoT providers. */
export const IOT_TABLE = 'iot_data'
export const IOT_COLUMNS =
  'id,vehicle_number,run_date,total_distance,data_source,raw_vehicle_id,vehicle_master_id,lookup_matched,lookup_match_type,created_at'

export function isMissingIotTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes(IOT_TABLE) && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export function getIotDbSetupMessage() {
  return 'iot_data table not found or not readable. Check Supabase table and RLS policies for anon read access.'
}

export async function fetchIotDataCount() {
  const probe = await supabase.from(IOT_TABLE).select('id', { count: 'estimated', head: true })
  if (probe.error) throw probe.error
  return probe.count ?? 0
}

const iotRangeCache = new Map()

export function clearIotRiderOrderCache() {
  iotRangeCache.clear()
}

export async function fetchIotDataInRange(dateFrom, dateTo, { force = false } = {}) {
  const from = (dateFrom ?? '').toString().trim()
  const to = (dateTo ?? '').toString().trim()
  if (!from || !to) return []

  const cacheKey = `${from}|${to}`
  if (!force && iotRangeCache.has(cacheKey)) {
    return iotRangeCache.get(cacheKey)
  }

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

  iotRangeCache.set(cacheKey, all)
  return all
}

/** Fresh, minimal vehicle/day keys for automatic Opspod catch-up across multiple files. */
export async function fetchExistingOpspodVehicleDays(dateFrom, dateTo) {
  const all = []
  let lastId = null
  const pageSize = 1000
  while (true) {
    let query = supabase.from(IOT_TABLE)
      .select('id,vehicle_number,raw_vehicle_id,run_date')
      .eq('data_source', 'opspod_ev91')
      .gte('run_date', dateFrom)
      .lte('run_date', dateTo)
      .order('id', { ascending: true })
      .limit(pageSize)
    if (lastId !== null) query = query.gt('id', lastId)
    const { data, error } = await query
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    const nextId = data.at(-1).id
    if (nextId == null || nextId === lastId) throw new Error('Could not read complete Opspod upload history. Choose the file again to retry.')
    lastId = nextId
  }
  return all
}

/** Same transactional upload API as the standalone IoT project. */
export async function saveIotRows(rows) {
  if (!rows?.length) return { inserted: 0, skipped: 0 }
  if (rows.some((row) => !IOT_SOURCES.some((source) => source.value === row.data_source))) {
    throw new Error('Select one of the four supported IoT sources before saving.')
  }
  const { data, error } = await supabase.rpc('save_iot_upload', { upload_rows: rows })
  if (error?.code === 'PGRST202' || (error?.code === '42883' && (error.message || '').includes('save_iot_upload'))) {
    throw new Error('IoT uploads need the existing project’s database update. Ask your administrator to complete the upload setup.')
  }
  if (error) throw error
  const result = Array.isArray(data) ? data[0] : data
  const inserted = Number(result?.inserted)
  const skipped = Number(result?.skipped)
  if (!Number.isSafeInteger(inserted) || !Number.isSafeInteger(skipped) || inserted < 0 || skipped < 0 || inserted + skipped !== rows.length) {
    clearIotRiderOrderCache()
    throw new Error('The database did not confirm the upload result. Refresh the report before retrying.')
  }
  clearIotRiderOrderCache()
  return { inserted, skipped }
}

let cachedUploadHistory = {}
let uploadHistoryInflight = null

export function getCachedIotUploadHistory() {
  return { ...cachedUploadHistory }
}

function timedHistoryQuery(query) {
  return query.abortSignal(AbortSignal.timeout(8000))
}

function parseUploadSummary(row) {
  const vehicles = Number(row.vehicle_count)
  const files = Number(row.file_count)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.run_date || '') ||
      row.vehicle_count == null || row.file_count == null ||
      !Number.isSafeInteger(vehicles) || vehicles < 0 || !Number.isSafeInteger(files) || files < 0) {
    throw new Error('Incomplete IoT upload summary.')
  }
  return { date: row.run_date, uploadedAt: row.created_at, vehicles, files }
}

/** Read just one provider's latest day if the combined dashboard RPC fails. */
async function fetchSourceUploadHistory(source) {
  const latest = await timedHistoryQuery(supabase.from(IOT_TABLE)
    .select('run_date').eq('data_source', source)
    .order('run_date', { ascending: false }).limit(1))
  if (latest.error) throw latest.error
  const date = latest.data?.[0]?.run_date
  if (!date) return null
  const vehicles = new Set()
  const files = new Set()
  let uploadedAt = null
  let lastId = null
  while (true) {
    let query = supabase.from(IOT_TABLE)
      .select('id,vehicle_number,raw_vehicle_id,upload_batch_id,created_at')
      .eq('data_source', source).eq('run_date', date)
      .order('id', { ascending: true }).limit(1000)
    if (lastId !== null) query = query.gt('id', lastId)
    const { data, error } = await timedHistoryQuery(query)
    if (error) throw error
    if (!data?.length) break
    for (const row of data) {
      const key = vehicleMatchKey(toText(row.vehicle_number) || row.raw_vehicle_id)
      if (key) vehicles.add(key)
      const timestamp = Date.parse(row.created_at)
      if (Number.isFinite(timestamp)) {
        if (!uploadedAt || timestamp > Date.parse(uploadedAt)) uploadedAt = row.created_at
      }
      if (row.upload_batch_id != null) files.add(String(row.upload_batch_id))
      else if (Number.isFinite(timestamp)) files.add(`legacy:${Math.floor(timestamp / 1000)}`)
    }
    if (data.length < 1000) break
    const nextId = data.at(-1).id
    if (nextId == null || nextId === lastId) throw new Error('Incomplete IoT upload history.')
    lastId = nextId
  }
  return { date, uploadedAt, vehicles: vehicles.size, files: files.size }
}

export async function fetchIotLastUploadsBySource({ force = false } = {}) {
  if (uploadHistoryInflight) {
    if (!force) return uploadHistoryInflight
    // A save must not reuse a summary query that started before the new rows existed.
    await uploadHistoryInflight
    if (uploadHistoryInflight) return uploadHistoryInflight
  }
  uploadHistoryInflight = (async () => {
    const sources = IOT_SOURCES.map((source) => source.value)
    try {
      const { data, error } = await timedHistoryQuery(supabase.rpc('iot_dashboard_last_uploads', { source_keys: sources }))
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Invalid IoT upload summary response.')
      const history = Object.fromEntries(sources.map((source) => [source, null]))
      for (const row of data) {
        if (sources.includes(row.data_source)) history[row.data_source] = parseUploadSummary(row)
      }
      cachedUploadHistory = history
      return { history: { ...history }, errors: {} }
    } catch {
      const results = await Promise.allSettled(sources.map(fetchSourceUploadHistory))
      const errors = {}
      const history = { ...cachedUploadHistory }
      results.forEach((result, index) => {
        const source = sources[index]
        if (result.status === 'fulfilled') history[source] = result.value
        else errors[source] = 'Upload history is temporarily unavailable.'
      })
      cachedUploadHistory = history
      return { history: { ...history }, errors }
    }
  })().finally(() => { uploadHistoryInflight = null })
  return uploadHistoryInflight
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
