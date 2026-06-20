import { format, isValid, parseISO } from 'date-fns'
import { parseFleetDate } from './fleetDeployReturnExport'
import { vehiclePartitionKey } from './fleetDeployReturnExport'
import { getCurrentlyDeployedAssignments } from './riderPerformanceReport'

function parseRangeDate(value) {
  if (!value) return null
  const d = new Date(`${value}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Normalize iot_data.run_date for grouping and display. */
export function normalizeIotRunDate(value) {
  if (value == null || value === '') return null

  const fleet = parseFleetDate(value)
  if (fleet && fleet.getFullYear() >= 2000) return format(fleet, 'yyyy-MM-dd')

  const raw = String(value).trim().slice(0, 10)
  const iso = parseISO(raw)
  if (isValid(iso) && iso.getFullYear() >= 2000) return format(iso, 'yyyy-MM-dd')

  // Common bad year prefix e.g. 0208-05-01 → 2026-05-01
  const typo = raw.match(/^0(\d{3})-(\d{2})-(\d{2})$/)
  if (typo) {
    const fixed = `20${typo[1].slice(1)}-${typo[2]}-${typo[3]}`
    const fixedDate = parseISO(fixed)
    if (isValid(fixedDate)) return format(fixedDate, 'yyyy-MM-dd')
  }

  return raw.length >= 10 ? raw : null
}

export function iotRowDistanceKm(row) {
  const n = Number(row?.total_distance ?? row?.running_distance_km)
  return Number.isFinite(n) ? n : 0
}

/**
 * Aggregate IoT km by vehicle for a date range and attach fleet deploy rider/client as of range end date.
 */
export function buildIotVehicleReport(iotRows, fleetRows, { dateFrom, dateTo } = {}) {
  const endDate = parseRangeDate(dateTo) || new Date()
  const assignments = getCurrentlyDeployedAssignments(fleetRows, endDate)
  const assignmentByVehicle = new Map()

  for (const assignment of assignments) {
    const key = vehiclePartitionKey(assignment.vehicleNumber)
    if (key) assignmentByVehicle.set(key, assignment)
  }

  const grouped = new Map()

  for (const row of iotRows || []) {
    const vehicleNumber = (row.vehicle_number || row.raw_vehicle_id || '').toString().trim()
    const key = vehiclePartitionKey(vehicleNumber)
    if (!key) continue

    if (!grouped.has(key)) {
      grouped.set(key, {
        vehicleNumber,
        totalDistanceKm: 0,
        dayKeys: new Set(),
        dataSources: new Set(),
        lookupMatched: false,
      })
    }

    const entry = grouped.get(key)
    entry.totalDistanceKm += iotRowDistanceKm(row)
    const day = normalizeIotRunDate(row.run_date ?? row.record_date)
    if (day) entry.dayKeys.add(day)
    if (row.data_source) entry.dataSources.add(String(row.data_source))
    if (row.lookup_matched === true) entry.lookupMatched = true
  }

  return [...grouped.values()]
    .map((entry) => {
      const key = vehiclePartitionKey(entry.vehicleNumber)
      const assignment = assignmentByVehicle.get(key)
      return {
        vehicleNumber: entry.vehicleNumber,
        runningDistanceKm: Math.round(entry.totalDistanceKm * 100) / 100,
        daysWithData: entry.dayKeys.size,
        dataSource: [...entry.dataSources].join(', ') || '—',
        lookupMatched: entry.lookupMatched,
        riderId: assignment?.riderId || '—',
        riderName: assignment?.riderName || '—',
        client: assignment?.client || '—',
        city: assignment?.city || '—',
        hub: assignment?.hub || '—',
        deployStatus: assignment ? 'Deployed' : 'Not deployed',
      }
    })
    .sort((a, b) => b.runningDistanceKm - a.runningDistanceKm || a.vehicleNumber.localeCompare(b.vehicleNumber))
}

export function summarizeIotReport(rows) {
  let totalKm = 0
  const vehicles = rows?.length || 0
  let deployed = 0
  for (const row of rows || []) {
    totalKm += row.runningDistanceKm || 0
    if (row.deployStatus === 'Deployed') deployed++
  }
  return {
    vehicles,
    totalKm: Math.round(totalKm * 100) / 100,
    deployed,
  }
}
