import { format, startOfDay, subDays } from 'date-fns'
import { vehiclePartitionKey } from './fleetDeployReturnExport'
import { normalizeIotRunDate, iotRowDistanceKm } from './iotDataReport'
import { buildDayKmHeader } from './riderPerformanceReport'

export { buildDayKmHeader }

/** vehicle + yyyy-MM-dd → running km from iot_data. */
export function buildVehicleDayKmIndex(iotRows) {
  const index = new Map()

  for (const row of iotRows || []) {
    const vehicleKey = vehiclePartitionKey(row.vehicle_number || row.raw_vehicle_id)
    const runDate = normalizeIotRunDate(row.run_date ?? row.record_date)
    if (!vehicleKey || !runDate) continue

    const key = `${vehicleKey}|${runDate}`
    const km = iotRowDistanceKm(row)
    index.set(key, (index.get(key) || 0) + km)
  }

  return index
}

export function lookupVehicleDayKm(index, vehicleNumber, dateKey) {
  const vehicleKey = vehiclePartitionKey(vehicleNumber)
  if (!vehicleKey || !dateKey || !index) return ''

  const km = index.get(`${vehicleKey}|${dateKey}`)
  if (km == null) return ''
  return Math.round(km * 100) / 100
}

export function enrichPerformanceRowsWithIotKm(rows, iotRowsOrIndex, asOfDate = new Date()) {
  const index =
    iotRowsOrIndex instanceof Map
      ? iotRowsOrIndex
      : buildVehicleDayKmIndex(iotRowsOrIndex)
  const asOf = startOfDay(asOfDate)

  return (rows || []).map((row) => {
    const out = { ...row }
    for (let n = 1; n <= 4; n++) {
      const header = buildDayKmHeader(asOf, n)
      const dateKey = format(subDays(asOf, n), 'yyyy-MM-dd')
      out[header] = lookupVehicleDayKm(index, row['V no'], dateKey)
    }
    return out
  })
}

export function getIotKmDateRange(asOfDate = new Date()) {
  const asOf = startOfDay(asOfDate)
  return {
    from: format(subDays(asOf, 4), 'yyyy-MM-dd'),
    to: format(subDays(asOf, 1), 'yyyy-MM-dd'),
  }
}
