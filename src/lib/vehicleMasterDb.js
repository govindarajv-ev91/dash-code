import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'

export const VEHICLE_MASTER_TABLE = 'vehicle_master'
export const VEHICLE_MASTER_COLUMNS = '*'

export function isMissingVehicleMasterTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('vehicle_master') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export function getVehicleMasterDbSetupMessage() {
  return 'Database table missing. Run sql/create_vehicle_master_table.sql in Supabase SQL Editor, then upload again.'
}

export async function fetchVehicleMasterCount() {
  const probe = await supabase.from(VEHICLE_MASTER_TABLE).select('id', { count: 'exact', head: true })
  if (probe.error) throw probe.error
  return probe.count ?? 0
}

export async function fetchVehicleMasterPreview(limit = 25) {
  const { data, error } = await supabase
    .from(VEHICLE_MASTER_TABLE)
    .select('*')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function clearVehicleMasterData() {
  const { error } = await supabase.from(VEHICLE_MASTER_TABLE).delete().neq('id', 0)
  if (error) throw error
  clearVehicleMasterCache()
}

export async function clearVehicleMasterDataByDate(masterDate) {
  const label = (masterDate ?? '').toString().trim()
  if (!label) return clearVehicleMasterData()
  const { error } = await supabase.from(VEHICLE_MASTER_TABLE).delete().eq('master_date', label)
  if (error) throw error
  clearVehicleMasterCache()
}

export async function fetchVehicleMasterDates() {
  const probe = await supabase.from(VEHICLE_MASTER_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error

  const { data: rpcData, error: rpcError } = await supabase.rpc('distinct_vehicle_master_dates')
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const labels = rpcData.map((row) => (typeof row === 'string' ? row : row?.master_date))
    return [...new Set(labels.map((d) => (d ?? '').toString().trim()).filter(Boolean))].sort((a, b) => b.localeCompare(a))
  }

  const { data } = await fetchAllData(VEHICLE_MASTER_TABLE, 'master_date,id', 'id', { useKeyset: true })
  const dates = [...new Set((data || []).map((row) => (row.master_date ?? '').toString().trim()).filter(Boolean))]
  return dates.sort((a, b) => b.localeCompare(a))
}

export async function saveVehicleMasterRows(rows, { masterDate, replaceDate = true } = {}) {
  if (!rows?.length) return 0

  if (replaceDate && masterDate) {
    await clearVehicleMasterDataByDate(masterDate)
  } else if (replaceDate) {
    await clearVehicleMasterData()
  }

  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from(VEHICLE_MASTER_TABLE).insert(chunk)
    if (error) throw error
    inserted += chunk.length
  }
  clearVehicleMasterCache()
  return inserted
}

let cachedVehicleMaster = null
let vehicleMasterInflight = null

export async function fetchAllVehicleMaster({ force = false } = {}) {
  if (!force && cachedVehicleMaster) return cachedVehicleMaster
  if (!force && vehicleMasterInflight) return vehicleMasterInflight

  vehicleMasterInflight = (async () => {
    const probe = await supabase.from(VEHICLE_MASTER_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    const { data } = await fetchAllData(VEHICLE_MASTER_TABLE, VEHICLE_MASTER_COLUMNS, 'id', { useKeyset: true })
    cachedVehicleMaster = data || []
    return cachedVehicleMaster
  })().finally(() => {
    vehicleMasterInflight = null
  })

  return vehicleMasterInflight
}

export function clearVehicleMasterCache() {
  cachedVehicleMaster = null
  vehicleMasterInflight = null
}

export async function loadVehicleMasterSummary() {
  try {
    const [count, preview] = await Promise.all([
      fetchVehicleMasterCount(),
      fetchVehicleMasterCount().then((n) => (n > 0 ? fetchVehicleMasterPreview(25) : [])),
    ])
    let dates = []
    try {
      dates = await fetchVehicleMasterDates()
    } catch {
      dates = [...new Set((preview || []).map((row) => row.master_date).filter(Boolean))]
    }
    return { count, preview, dates, fromDb: true }
  } catch (err) {
    if (isMissingVehicleMasterTable(err)) {
      return { count: 0, preview: [], dates: [], fromDb: false, missingTable: true }
    }
    throw err
  }
}
