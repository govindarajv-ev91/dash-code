import { format, parseISO, isValid } from 'date-fns'
import { parseFleetDate, vehiclePartitionKey } from './fleetDeployReturnExport'
import { getCurrentlyDeployedAssignments } from './riderPerformanceReport'

/** Loose match: ignore spaces, hyphens, dots (TN-14-AU-0043 = TN14AU0043). */
export function vehicleMatchKey(value) {
  return vehiclePartitionKey(value).replace(/[^A-Z0-9]/g, '')
}

function masterDateKey(value) {
  const raw = (value ?? '').toString().trim()
  if (!raw) return ''

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const d = parseFleetDate(raw)
  return d ? format(d, 'yyyy-MM-dd') : ''
}

function parseMasterDateKey(dateKey) {
  if (!dateKey) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const parsed = parseISO(dateKey)
    return isValid(parsed) ? parsed : null
  }
  return parseFleetDate(dateKey)
}

/** Vehicle numbers from vehicle_master grouped by master_date (yyyy-MM-dd). */
export function buildVehicleMasterKeysByDate(masterRows) {
  const byDate = new Map()

  for (const row of masterRows || []) {
    const dateKey = masterDateKey(row.master_date)
    if (!dateKey) continue

    const vehicleKey = vehicleMatchKey(row.vehicle_number)
    if (!vehicleKey) continue

    if (!byDate.has(dateKey)) byDate.set(dateKey, new Set())
    byDate.get(dateKey).add(vehicleKey)
  }

  return byDate
}

export function getVehicleMasterDateKeys(masterRows) {
  return [...buildVehicleMasterKeysByDate(masterRows).keys()].sort((a, b) => b.localeCompare(a))
}

/**
 * Deployed fleet vehicles (as of each master date) whose vehicle_number is not in vehicle_master.
 */
export function findVehicleMasterMismatches(fleetData, masterRows, { masterDate = '' } = {}) {
  const masterByDate = buildVehicleMasterKeysByDate(masterRows)
  if (!masterByDate.size) return []

  const targetDates = masterDate
    ? [masterDateKey(masterDate)].filter((d) => d && masterByDate.has(d))
    : [...masterByDate.keys()].sort((a, b) => b.localeCompare(a))

  const results = []
  const seen = new Set()

  for (const dateKey of targetDates) {
    const masterKeys = masterByDate.get(dateKey)
    if (!masterKeys?.size) continue

    const asOfDate = parseMasterDateKey(dateKey)
    if (!asOfDate) continue

    const deployed = getCurrentlyDeployedAssignments(fleetData, asOfDate)

    for (const assignment of deployed) {
      const vehicleNumber = (assignment.vehicleNumber || '').toString().trim()
      const vehicleKey = vehicleMatchKey(vehicleNumber)
      if (!vehicleKey) continue
      if (masterKeys.has(vehicleKey)) continue

      const dedupeKey = `${dateKey}|${vehicleKey}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      results.push({
        date: asOfDate,
        dateLabel: format(asOfDate, 'dd/MM/yyyy'),
        masterDate: dateKey,
        vehicleNumber,
        vehicleStatus: 'Deployee',
        riderId: (assignment.riderId || '').toString().trim(),
        riderName: (assignment.riderName || '').toString().trim(),
        client: (assignment.client || '').toString().trim() || 'N/A',
        city: (assignment.city || '').toString().trim() || 'N/A',
      })
    }
  }

  results.sort((a, b) => {
    const dateCmp = b.masterDate.localeCompare(a.masterDate)
    if (dateCmp !== 0) return dateCmp
    return a.vehicleNumber.localeCompare(b.vehicleNumber)
  })

  return results
}

export function summarizeVehicleMasterCompare(fleetData, masterRows, masterDate) {
  const dateKey = masterDateKey(masterDate)
  if (!dateKey) return { masterDate: '', masterVehicleCount: 0, deployedFleetCount: 0 }

  const masterKeys = buildVehicleMasterKeysByDate(masterRows).get(dateKey)
  const asOf = parseMasterDateKey(dateKey)
  const deployed = asOf ? getCurrentlyDeployedAssignments(fleetData, asOf) : []

  return {
    masterDate: dateKey,
    masterVehicleCount: masterKeys?.size || 0,
    deployedFleetCount: deployed.length,
  }
}
