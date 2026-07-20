import { format, isValid, parseISO } from 'date-fns'
import { parseFleetDate } from './fleetDeployReturnExport'
import { vehiclePartitionKey } from './fleetDeployReturnExport'
import {
  getCurrentlyDeployedAssignments,
  parseMetricDate,
} from './riderPerformanceReport'
import {
  buildFleetIntervalIndexes,
  extractRiderIdAliases,
  findRiderForVehicleOnDate,
  prepareMergedFleetRows,
} from './fleetInsightIndex'

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

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function addRiderDayOrders(indexMap, riderKey, dateKey, delivered) {
  for (const alias of extractRiderIdAliases(riderKey)) {
    const fullKey = `${alias}|${dateKey}`
    indexMap.set(fullKey, (indexMap.get(fullKey) || 0) + delivered)
  }
}

/** rider_id/worker_code + date → delivered orders (from rider_metrics). */
export function buildRiderDayOrderIndex(riderRows) {
  const byWorkerDate = new Map()
  const byPhoneDate = new Map()

  for (const row of riderRows || []) {
    const date = parseMetricDate(row.date_record)
    if (!date) continue
    const dateKey = format(date, 'yyyy-MM-dd')
    const delivered = parseInt(row.delivered, 10) || 0
    if (!delivered) continue

    addRiderDayOrders(byWorkerDate, row.worker_code, dateKey, delivered)
    addRiderDayOrders(byWorkerDate, row.rider_id, dateKey, delivered)

    const phone = normalizePhone(row.mob_number)
    if (phone) {
      const key = `${phone}|${dateKey}`
      byPhoneDate.set(key, (byPhoneDate.get(key) || 0) + delivered)
    }
  }

  return { byWorkerDate, byPhoneDate }
}

export function lookupRiderDayOrders(assignment, dateKey, orderIndex) {
  if (!assignment || !dateKey || !orderIndex) return 0

  for (const alias of extractRiderIdAliases(assignment.riderId)) {
    const byId = orderIndex.byWorkerDate.get(`${alias}|${dateKey}`)
    if (byId != null) return byId
  }

  const phone = normalizePhone(assignment.mobile)
  if (phone) {
    const byPhone = orderIndex.byPhoneDate.get(`${phone}|${dateKey}`)
    if (byPhone != null) return byPhone
  }

  return 0
}

function resolveIotAssignment(interval, openAssignment) {
  if (interval) {
    return {
      vehicleNumber: interval.vehicleNumber,
      riderId: interval.riderId || openAssignment?.riderId || '',
      riderName: interval.riderName || openAssignment?.riderName || '—',
      mobile: interval.mobile || openAssignment?.mobile || '',
      client: openAssignment?.client || '—',
      city: openAssignment?.city || '—',
      hub: openAssignment?.hub || '—',
    }
  }
  return openAssignment || null
}

/** Pre-compute open fleet assignments per IoT run date (avoids O(rows × fleet) work). */
function buildAssignmentCacheByDate(fleetRows, runDates) {
  const cache = new Map()
  for (const runDate of runDates) {
    const asOf = parseRangeDate(runDate)
    if (!asOf) continue
    const openByVehicle = new Map()
    for (const assignment of getCurrentlyDeployedAssignments(fleetRows, asOf)) {
      const key = vehiclePartitionKey(assignment.vehicleNumber)
      if (key) openByVehicle.set(key, assignment)
    }
    cache.set(runDate, openByVehicle)
  }
  return cache
}

/**
 * IoT rows by vehicle + run_date with fleet rider/client as of that date and rider order count.
 */
export function buildIotVehicleReport(iotRows, fleetRows, riderRows, { dateFrom, dateTo } = {}) {
  void dateFrom
  void dateTo

  if (!iotRows?.length) return []

  const orderIndex = buildRiderDayOrderIndex(riderRows)
  const preparedFleet = prepareMergedFleetRows(fleetRows)
  const { vehicleIntervals } = buildFleetIntervalIndexes(preparedFleet)

  const runDates = new Set()
  const parsedIot = []
  for (const row of iotRows) {
    const vehicleNumber = (row.vehicle_number || row.raw_vehicle_id || '').toString().trim()
    const vehicleKey = vehiclePartitionKey(vehicleNumber)
    const runDate = normalizeIotRunDate(row.run_date ?? row.record_date)
    if (!vehicleKey || !runDate) continue
    runDates.add(runDate)
    parsedIot.push({ row, vehicleNumber, vehicleKey, runDate })
  }

  const assignmentByDate = buildAssignmentCacheByDate(fleetRows, runDates)
  const rows = []

  for (const { row, vehicleNumber, vehicleKey, runDate } of parsedIot) {
    const asOf = parseRangeDate(runDate)
    const interval = asOf ? findRiderForVehicleOnDate(vehicleIntervals, vehicleKey, asOf) : null
    const openAssignment = assignmentByDate.get(runDate)?.get(vehicleKey)
    const assignment = resolveIotAssignment(interval, openAssignment)
    const orderCount = lookupRiderDayOrders(assignment, runDate, orderIndex)

    rows.push({
      rowKey: `${vehicleKey}|${runDate}`,
      runDate,
      vehicleNumber,
      runningDistanceKm: Math.round(iotRowDistanceKm(row) * 100) / 100,
      dataSource: row.data_source ? String(row.data_source) : '—',
      lookupMatched: row.lookup_matched === true,
      riderId: assignment?.riderId || '—',
      riderName: assignment?.riderName || '—',
      client: assignment?.client || '—',
      city: assignment?.city || '—',
      hub: assignment?.hub || '—',
      deployStatus: assignment ? 'Deployed' : 'Not deployed',
      orderCount,
    })
  }

  return rows.sort(
    (a, b) =>
      b.runDate.localeCompare(a.runDate) ||
      b.runningDistanceKm - a.runningDistanceKm ||
      a.vehicleNumber.localeCompare(b.vehicleNumber)
  )
}

export function summarizeIotReport(rows) {
  let totalKm = 0
  let totalOrders = 0
  const vehicles = new Set()
  let deployed = 0
  for (const row of rows || []) {
    totalKm += row.runningDistanceKm || 0
    totalOrders += row.orderCount || 0
    vehicles.add(row.vehicleNumber)
    if (row.deployStatus === 'Deployed') deployed++
  }
  return {
    rows: rows?.length || 0,
    vehicles: vehicles.size,
    totalKm: Math.round(totalKm * 100) / 100,
    totalOrders,
    deployed,
  }
}
