import { supabase } from './supabaseClient'
import { fetchLastUploadAt } from './paymentMonthList'

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
