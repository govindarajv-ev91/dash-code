import { format, startOfDay } from 'date-fns'
import { supabase } from './supabaseClient'
import { vehiclePartitionKey } from './fleetDeployReturnExport'

export const VEHICLE_SERVICE_TABLE = 'vehicle_service_log'
export const VEHICLE_SERVICE_COLUMNS =
  'id,vehicle_number,vehicle_key,service_date,service_status,city,client_name,rider_id,rider_name,ev91_rider_id,total_km,notes,created_at'

export function isMissingVehicleServiceTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return (
    msg.includes('vehicle_service_log') &&
    (msg.includes('does not exist') || msg.includes('schema cache'))
  )
}

export function getVehicleServiceSetupMessage() {
  return 'vehicle_service_log table not found. Run sql/create_vehicle_service_log.sql in Supabase SQL Editor.'
}

function safeServiceDate(value) {
  if (!value) return null
  const raw = String(value).trim().slice(0, 10)
  const d = new Date(`${raw}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return startOfDay(d)
}

/** Fetch all service-done rows (paginated). */
export async function fetchAllVehicleServiceLogs() {
  const all = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from(VEHICLE_SERVICE_TABLE)
      .select(VEHICLE_SERVICE_COLUMNS)
      .order('service_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  return all
}

/**
 * vehicleKey → { count, lastServiceDate, lastRow, rows[] }
 * Only counts service_status = 'done'.
 */
export function buildVehicleServiceIndex(logs) {
  const byVehicle = new Map()

  for (const row of logs || []) {
    const status = String(row.service_status || 'done').toLowerCase()
    if (status !== 'done') continue

    const vKey =
      (row.vehicle_key || '').toString().trim() ||
      vehiclePartitionKey(row.vehicle_number)
    if (!vKey) continue

    const serviceDate = safeServiceDate(row.service_date)
    if (!byVehicle.has(vKey)) {
      byVehicle.set(vKey, {
        count: 0,
        lastServiceDate: null,
        lastRow: null,
        rows: [],
      })
    }
    const bucket = byVehicle.get(vKey)
    bucket.count += 1
    bucket.rows.push(row)
    if (
      serviceDate &&
      (!bucket.lastServiceDate || serviceDate > bucket.lastServiceDate)
    ) {
      bucket.lastServiceDate = serviceDate
      bucket.lastRow = row
    }
  }

  return byVehicle
}

export function lookupVehicleService(index, vehicleNumber) {
  const vKey = vehiclePartitionKey(vehicleNumber)
  if (!vKey || !index) return { count: 0, lastServiceDate: null, lastRow: null, rows: [] }
  return index.get(vKey) || { count: 0, lastServiceDate: null, lastRow: null, rows: [] }
}

/** Insert one Service Done record (permanent). */
export async function saveVehicleServiceDone({
  vehicleNumber,
  serviceDate = new Date(),
  city = '',
  clientName = '',
  riderId = '',
  riderName = '',
  ev91RiderId = '',
  totalKm = null,
  notes = '',
} = {}) {
  const plate = (vehicleNumber || '').toString().trim()
  const vehicleKey = vehiclePartitionKey(plate)
  if (!plate || !vehicleKey) {
    throw new Error('Vehicle number is required to save service done.')
  }

  const dateObj = serviceDate instanceof Date ? serviceDate : new Date(serviceDate)
  if (Number.isNaN(dateObj.getTime())) {
    throw new Error('Invalid service date.')
  }

  const payload = {
    vehicle_number: plate,
    vehicle_key: vehicleKey,
    service_date: format(dateObj, 'yyyy-MM-dd'),
    service_status: 'done',
    city: (city || '').toString().trim() || null,
    client_name: (clientName || '').toString().trim() || null,
    rider_id: (riderId || '').toString().trim() || null,
    rider_name: (riderName || '').toString().trim() || null,
    ev91_rider_id: (ev91RiderId || '').toString().trim() || null,
    total_km: totalKm == null || totalKm === '' ? null : Number(totalKm),
    notes: (notes || '').toString().trim() || null,
  }

  const { data, error } = await supabase
    .from(VEHICLE_SERVICE_TABLE)
    .insert(payload)
    .select(VEHICLE_SERVICE_COLUMNS)
    .single()

  if (error) throw error
  return data
}
