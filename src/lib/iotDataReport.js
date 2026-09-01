import { format, isValid, parseISO, startOfDay } from 'date-fns'
import { parseFleetDate } from './fleetDeployReturnExport'
import { vehiclePartitionKey } from './fleetDeployReturnExport'
import {
  buildFleetIntervalIndexes,
  extractRiderIdAliases,
  findRiderForVehicleOnDate,
  prepareMergedFleetRows,
} from './fleetInsightIndex'
import {
  buildEv91OverallIntervalIndexes,
  mergeCurrentStatusIntoIndexes,
  findEv91RiderForVehicleOnDate,
} from './ev91EvLookup'
import { normalizeCurrentVehicleStatus } from './ev91MisApi'
import { parseMetricDate } from './riderPerformanceReport'

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

function formatRiderPhone(value) {
  const phone = normalizePhone(value)
  return phone || ''
}

/** Phone from deploy/fleet contact, then EV91 Rider Details by EV91 ID / client rider ID. */
export function resolveIotRiderPhone(assignment, ev91RiderId, ev91RiderDetails) {
  const fromAssignment = formatRiderPhone(assignment?.mobile)
  if (fromAssignment) return fromAssignment

  const ids = [
    (ev91RiderId || '').toString().trim(),
    (assignment?.ev91RiderId || '').toString().trim(),
    (assignment?.riderId || '').toString().trim(),
  ].filter((id) => id && id !== '—')

  if (!ev91RiderDetails?.size) return ''

  for (const id of ids) {
    const detail = ev91RiderDetails.get(id)
    const phone = formatRiderPhone(detail?.phone || detail?.mobile)
    if (phone) return phone
  }
  return ''
}

/** rider_id/worker_code + date → delivered orders (from order_upload_data). */
export function buildRiderDayOrderIndex(riderRows) {
  const byWorkerDate = new Map()
  const byPhoneDate = new Map()

  for (const row of riderRows || []) {
    const date = parseMetricDate(row.date_record)
    if (!date) continue
    const dateKey = format(date, 'yyyy-MM-dd')
    const delivered = parseInt(row.delivered, 10) || 0
    if (!delivered) continue

    // Deduplicate aliases across worker_code + rider_id so the same row is not added twice.
    const idAliases = new Set([
      ...extractRiderIdAliases(row.worker_code),
      ...extractRiderIdAliases(row.rider_id),
    ])
    for (const alias of idAliases) {
      const fullKey = `${alias}|${dateKey}`
      byWorkerDate.set(fullKey, (byWorkerDate.get(fullKey) || 0) + delivered)
    }

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

function assignmentFromEv91Interval(interval) {
  if (!interval) return null
  return {
    vehicleNumber: interval.vehicleNumber || '',
    riderId: interval.riderId || interval.clientId || interval.ev91RiderId || '',
    ev91RiderId: interval.ev91RiderId || '',
    riderName: interval.riderName || '—',
    mobile: interval.mobile || '',
    client: interval.clientName || '—',
    city: interval.city || '—',
    hub: '—',
    source: 'ev91',
  }
}

function resolveIotAssignment(interval, ev91Interval, hasEv91History) {
  // Prefer EV91 Overall/Current intervals — fleet master often lags API deploy status.
  if (ev91Interval) return assignmentFromEv91Interval(ev91Interval)

  // Vehicle appears in EV91 history: trust API day-by-day (before deploy = Not deployed).
  if (hasEv91History) return null

  if (interval) {
    return {
      vehicleNumber: interval.vehicleNumber,
      riderId: interval.riderId || '',
      ev91RiderId: '',
      riderName: interval.riderName || '—',
      mobile: interval.mobile || '',
      client: interval.client || '—',
      city: interval.city || '—',
      hub: interval.hub || '—',
      source: 'fleet',
    }
  }
  return null
}

/**
 * Static vehicle → city from Vehicle Inventory (master table).
 * Used when a vehicle is Not deployed on an IoT run date (no rider assignment).
 */
export function buildVehicleMasterCityIndex(inventoryRows = []) {
  const byVehicle = new Map()

  for (const row of inventoryRows || []) {
    const key = vehiclePartitionKey(row.vehregno || row.vehicle_number)
    const c = (row.city ?? '').toString().trim()
    if (!key || !c || c === '—' || c === 'N/A') continue
    if (!byVehicle.has(key)) byVehicle.set(key, c)
  }

  return byVehicle
}

/**
 * IoT rows by vehicle + run_date with fleet/EV91 rider/client as of that date and rider order count.
 * Deploy Status uses EV91 Overall (+ Current) intervals first, then fleet.
 */
export function buildIotVehicleReport(
  iotRows,
  fleetRows,
  riderRows,
  { dateFrom, dateTo, ev91OverallRows = [], ev91CurrentRows = [], vehicleInventoryRows = [], ev91RiderDetails = null } = {}
) {
  void dateFrom
  void dateTo

  if (!iotRows?.length) return []

  const orderIndex = buildRiderDayOrderIndex(riderRows)
  const preparedFleet = prepareMergedFleetRows(fleetRows)
  const { vehicleIntervals } = buildFleetIntervalIndexes(preparedFleet)

  const ev91Indexes = buildEv91OverallIntervalIndexes(ev91OverallRows || [])
  mergeCurrentStatusIntoIndexes(ev91Indexes, ev91CurrentRows || [])
  const ev91VehicleIntervals = ev91Indexes.vehicleIntervals

  // Current Status EV91 id + since-date when vehicle is not currently deployed
  // (only blocks fleet fallback on/after that date — never wipe historical allotments)
  const currentNotDeployedSince = new Map()
  const currentEv91ByVehicle = new Map()
  for (const row of ev91CurrentRows || []) {
    const vehicleKey = vehiclePartitionKey(row.vehicleNumber)
    if (!vehicleKey) continue
    const ev91Id = (row.ev91RiderId || '').toString().trim()
    if (ev91Id && !currentEv91ByVehicle.has(vehicleKey)) {
      currentEv91ByVehicle.set(vehicleKey, ev91Id)
    }
    const label = normalizeCurrentVehicleStatus(row.currentStatus)
    if (label === 'Not yet to deploy' || label === 'Returned') {
      const sinceAt = parseFleetDate(row.lastStatusDate) || new Date()
      const sinceKey = format(startOfDay(sinceAt), 'yyyy-MM-dd')
      const prev = currentNotDeployedSince.get(vehicleKey)
      if (!prev || sinceKey > prev) currentNotDeployedSince.set(vehicleKey, sinceKey)
    }
  }

  const runDates = new Set()
  const parsedIot = []
  for (const row of iotRows) {
    const vehicleNumber = (row.vehicle_number || row.raw_vehicle_id || '').toString().trim()
    const vehicleKey = vehiclePartitionKey(vehicleNumber)
    const runDate = normalizeIotRunDate(row.run_date ?? row.record_date)
    if (!vehicleKey || !runDate) continue
    parsedIot.push({ row, vehicleNumber, vehicleKey, runDate })
  }

  const masterCityByVehicle = buildVehicleMasterCityIndex(vehicleInventoryRows)
  const rows = []

  for (const { row, vehicleNumber, vehicleKey, runDate } of parsedIot) {
    // Use noon-local then start-of-day semantics via Date; match EV91 interval calendar days.
    const asOf = parseRangeDate(runDate)
    const interval = asOf ? findRiderForVehicleOnDate(vehicleIntervals, vehicleKey, asOf) : null
    const ev91Interval = asOf
      ? findEv91RiderForVehicleOnDate(ev91VehicleIntervals, vehicleKey, asOf)
      : null
    const hasEv91History =
      ev91VehicleIntervals.has(vehicleKey) || currentNotDeployedSince.has(vehicleKey)
    // After Current Status return / yet-not-deployed date, don't use stale fleet Deployed
    const notDeployedSince = currentNotDeployedSince.get(vehicleKey)
    const blockFleet =
      Boolean(notDeployedSince) && runDate >= notDeployedSince && !ev91Interval
    const assignment = resolveIotAssignment(
      blockFleet ? null : interval,
      ev91Interval,
      hasEv91History
    )
    const orderCount = lookupRiderDayOrders(assignment, runDate, orderIndex)
    const ev91RiderId =
      assignment?.ev91RiderId ||
      ev91Interval?.ev91RiderId ||
      (runDate >= (notDeployedSince || '') ? currentEv91ByVehicle.get(vehicleKey) : '') ||
      ''

    let city = assignment?.city || '—'
    if (!city || city === '—') {
      const masterCity = masterCityByVehicle.get(vehicleKey)
      if (masterCity) city = masterCity
    }

    const riderPhone = resolveIotRiderPhone(assignment, ev91RiderId, ev91RiderDetails)

    rows.push({
      rowKey: `${vehicleKey}|${runDate}`,
      runDate,
      vehicleNumber,
      runningDistanceKm: Math.round(iotRowDistanceKm(row) * 100) / 100,
      dataSource: row.data_source ? String(row.data_source) : '—',
      lookupMatched: row.lookup_matched === true,
      riderId: assignment?.riderId || '—',
      ev91RiderId: ev91RiderId || '—',
      riderName: assignment?.riderName || '—',
      riderPhone: riderPhone || '—',
      client: assignment?.client || '—',
      city,
      hub: assignment?.hub || '—',
      // Day-wise: Deployed only while an EV91/fleet allotment covers that run date.
      deployStatus: assignment ? 'Deployed' : 'Not deployed',
      deploySource: assignment?.source || '',
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
