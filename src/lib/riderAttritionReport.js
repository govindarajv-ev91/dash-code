import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { parseFleetDate } from './fleetDeployReturnExport'
import { buildRiderMetricDateIndex, isIcRiderRow } from './fleetMasterSheet'
import {
  buildFleetIntervalIndexes,
  findRiderVehicleOnDate,
  prepareMergedFleetRows,
} from './fleetInsightIndex'
import { normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import { normalizeRiderIdKey, getCurrentlyDeployedAssignments, parseRentalPendingAmount } from './riderPerformanceReport'

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function parseMetricDate(value) {
  return parseFleetDate(value)
}

function pickField(row, ...keys) {
  for (const key of keys) {
    const v = row?.[key]
    if (v === null || v === undefined) continue
    const s = v.toString().trim()
    if (s && s.toLowerCase() !== 'n/a' && s.toLowerCase() !== 'null') return s
  }
  return ''
}

function metricOnDate(riderIndex, workerCode, mobile, date) {
  if (!riderIndex) return null
  const dateKey = format(startOfDay(date), 'yyyy-MM-dd')
  const workerKey = normalizeRiderIdKey(workerCode)
  if (workerKey) {
    const row = riderIndex.byWorkerDate.get(`${workerKey}|${dateKey}`)
    if (row) return row
  }
  const phone = normalizePhone(mobile)
  if (phone) {
    const row = riderIndex.byPhoneDate.get(`${phone}|${dateKey}`)
    if (row) return row
  }
  return null
}

function isNumericWorkerCode(raw) {
  const s = (raw ?? '').toString().trim()
  return /^[\d.\s-]+$/.test(s) && /\d/.test(s)
}

/** Collect normalized aliases for metrics ↔ fleet ID matching (FE6516583, 6516583, 8FE9843754). */
function extractFleetIdAliases(value) {
  const aliases = new Set()
  const raw = (value ?? '').toString().trim()
  if (!raw) return aliases

  const idKey = normalizeRiderIdKey(raw)
  if (idKey) aliases.add(idKey)

  const prefixMatch = idKey.match(/^([A-Z]{2,5})(\d+)$/i)
  if (prefixMatch?.[2]?.length >= 5) {
    aliases.add(prefixMatch[2])
    aliases.add(`${prefixMatch[1]}${prefixMatch[2]}`)
  }

  const embeddedFe = idKey.match(/FE(\d{5,})/i)
  if (embeddedFe) {
    aliases.add(`FE${embeddedFe[1]}`)
    aliases.add(embeddedFe[1])
  }

  if (isNumericWorkerCode(raw)) {
    const digits = raw.replace(/\D/g, '')
    if (digits) aliases.add(digits)
  }

  return aliases
}

/** FE6516583 in metrics ↔ 6516583 in fleet (same rider, different ID formats). */
function fleetRiderIdsMatch(workerCode, fleetRiderId) {
  const a = extractFleetIdAliases(workerCode)
  const b = extractFleetIdAliases(fleetRiderId)
  for (const key of a) {
    if (b.has(key)) return true
  }
  return false
}

/** Avoid matching FE6516583 to another rider's fleet row keyed as 6516583. */
function intervalBelongsToRider(interval, workerCode) {
  if (!interval) return false
  const riderId = (interval.riderId ?? '').toString().trim()
  if (!riderId) return true
  return fleetRiderIdsMatch(workerCode, riderId)
}

function riderIdentityKeys(workerCode, mobile, { includePhone = false } = {}) {
  const keys = [...extractFleetIdAliases(workerCode)]
  if (includePhone) {
    const phone = normalizePhone(mobile)
    if (phone) keys.push(`phone:${phone}`)
  }
  return keys
}

function findRiderEntryKey(aliasToMapKey, ridersByWorker, fleetRiderId) {
  for (const alias of extractFleetIdAliases(fleetRiderId)) {
    const mapKey = aliasToMapKey.get(alias)
    if (!mapKey) continue
    const rider = ridersByWorker.get(mapKey)
    if (rider && fleetRiderIdsMatch(rider.workerCode, fleetRiderId)) return mapKey
  }
  return null
}

function registerRiderAliases(aliasToMapKey, mapKey, workerCode) {
  for (const alias of extractFleetIdAliases(workerCode)) {
    if (!aliasToMapKey.has(alias)) aliasToMapKey.set(alias, mapKey)
  }
}

let cachedFleetRef = null
let cachedFleetAsOfKey = ''
let cachedFleetCtx = null
let cachedDeployedAssignments = null
let cachedDeployedByAlias = null
let cachedRiderRef = null
let cachedRiderIndex = null
let cachedReportRiderRef = null
let cachedReportFleetRef = null
let cachedReportResult = null

export function clearAttritionReportCache() {
  cachedFleetRef = null
  cachedFleetAsOfKey = ''
  cachedFleetCtx = null
  cachedDeployedAssignments = null
  cachedDeployedByAlias = null
  cachedRiderRef = null
  cachedRiderIndex = null
  cachedReportRiderRef = null
  cachedReportFleetRef = null
  cachedReportResult = null
}

function getRiderMetricIndex(riderRows) {
  if (riderRows === cachedRiderRef && cachedRiderIndex) return cachedRiderIndex
  cachedRiderIndex = buildRiderMetricDateIndex(riderRows)
  cachedRiderRef = riderRows
  return cachedRiderIndex
}

function getAttritionFleetBundle(fleetRows, asOfDay) {
  const asOfKey = format(startOfDay(asOfDay), 'yyyy-MM-dd')
  if (
    fleetRows === cachedFleetRef &&
    asOfKey === cachedFleetAsOfKey &&
    cachedFleetCtx &&
    cachedDeployedByAlias
  ) {
    return {
      fleetCtx: cachedFleetCtx,
      deployedAssignments: cachedDeployedAssignments,
      deployedByAlias: cachedDeployedByAlias,
    }
  }

  const fleetCtx = buildAttritionFleetContext(fleetRows, asOfDay)
  const deployedAssignments = getCurrentlyDeployedAssignments(fleetRows, asOfDay)
  const deployedByAlias = new Map()
  for (const assignment of deployedAssignments) {
    for (const alias of extractFleetIdAliases(assignment.riderId)) {
      if (!deployedByAlias.has(alias)) deployedByAlias.set(alias, assignment)
    }
  }

  cachedFleetRef = fleetRows
  cachedFleetAsOfKey = asOfKey
  cachedFleetCtx = fleetCtx
  cachedDeployedAssignments = deployedAssignments
  cachedDeployedByAlias = deployedByAlias

  return { fleetCtx, deployedAssignments, deployedByAlias }
}

function resolveInactiveDays(asOfDay, lastWorkingDateObj, fleetInfo) {
  const asOf = startOfDay(asOfDay)

  if (fleetInfo.deployStatus === 'Deployee' && fleetInfo.deployDate) {
    const deployDay = parseFleetDate(fleetInfo.deployDate)
    if (deployDay) {
      const deployStart = startOfDay(deployDay)
      const lastDay = lastWorkingDateObj ? startOfDay(lastWorkingDateObj) : null

      if (!lastDay || lastDay < deployStart) {
        return differenceInCalendarDays(asOf, deployStart)
      }

      return differenceInCalendarDays(asOf, lastDay)
    }
  }

  if (!lastWorkingDateObj) return 0
  return differenceInCalendarDays(asOf, startOfDay(lastWorkingDateObj))
}

function lookupDeployedAssignment(deployedByAlias, workerCode) {
  for (const alias of extractFleetIdAliases(workerCode)) {
    const hit = deployedByAlias.get(alias)
    if (hit && fleetRiderIdsMatch(workerCode, hit.riderId)) return hit
  }
  return null
}

function fleetInfoFromAssignment(assignment, riderIndex, workerCode, mobile, asOf) {
  const metric = metricOnDate(riderIndex, workerCode, mobile, asOf)
  const isIc = metric && isIcRiderRow(metric)
  return {
    vType: isIc ? 'NON-EV' : 'EV',
    deployVehicle: assignment.vehicleNumber || 'N/A',
    deployStatus: 'Deployee',
    deployDate: format(startOfDay(assignment.deployDate), 'dd/MM/yyyy'),
  }
}

/** Interval-based fleet index (same pairing logic as EV lookup). */
function buildAttritionFleetContext(fleetRows, asOfDate) {
  const asOf = startOfDay(asOfDate)
  const preparedFleet = prepareMergedFleetRows(fleetRows)
  const { riderAssignments } = buildFleetIntervalIndexes(preparedFleet)
  return { riderAssignments, asOf }
}

function findLatestClosedInterval(riderAssignments, identityKeys, asOf, workerCode) {
  const asOfTime = startOfDay(asOf).getTime()
  let best = null

  for (const key of identityKeys) {
    const intervals = riderAssignments.get(key)
    if (!intervals?.length) continue

    for (const interval of intervals) {
      if (!intervalBelongsToRider(interval, workerCode)) continue
      if (!interval.to) continue
      const toTime = startOfDay(interval.to).getTime()
      if (toTime > asOfTime) continue
      if (!best || toTime > startOfDay(best.to).getTime()) best = interval
    }
  }

  return best
}

/**
 * Fleet status as of report date (not LWD).
 * Uses deploy/return intervals per rider ID — avoids wrong vehicle from shared phone numbers.
 */
function resolveAttritionFleetInfo(fleetCtx, riderIndex, workerCode, mobile) {
  const { riderAssignments, asOf } = fleetCtx
  const workerKeys = riderIdentityKeys(workerCode, mobile, { includePhone: false })

  let interval = findRiderVehicleOnDate(riderAssignments, workerKeys, asOf)
  if (interval && !intervalBelongsToRider(interval, workerCode)) interval = null

  if (!interval) {
    const phone = normalizePhone(mobile)
    if (phone) {
      const phoneHit = findRiderVehicleOnDate(riderAssignments, [`phone:${phone}`], asOf)
      if (phoneHit && intervalBelongsToRider(phoneHit, workerCode)) {
        interval = phoneHit
      }
    }
  }

  if (interval) {
    const returned =
      interval.to != null && startOfDay(interval.to).getTime() <= startOfDay(asOf).getTime()
    const metric = metricOnDate(riderIndex, workerCode, mobile, asOf)
    const isIc = metric && isIcRiderRow(metric)

    return {
      vType: returned || isIc ? 'NON-EV' : 'EV',
      deployVehicle: interval.vehicleNumber || 'N/A',
      deployStatus: returned ? 'Return' : 'Deployee',
      deployDate: format(returned ? interval.to : interval.from, 'dd/MM/yyyy'),
    }
  }

  const lastReturn = findLatestClosedInterval(riderAssignments, workerKeys, asOf, workerCode)
  if (lastReturn) {
    return {
      vType: 'NON-EV',
      deployVehicle: lastReturn.vehicleNumber || 'N/A',
      deployStatus: 'Return',
      deployDate: format(lastReturn.to, 'dd/MM/yyyy'),
    }
  }

  return {
    vType: 'NON-EV',
    deployVehicle: 'N/A',
    deployStatus: 'N/A',
    deployDate: '',
  }
}

/** Latest date in rider_metrics with deliveries — used as "today" for attrition. */
export function resolveAsOfDate(riderRows) {
  let maxDate = null
  for (const row of riderRows || []) {
    const date = parseMetricDate(row.date_record)
    const delivered = parseInt(row.delivered, 10) || 0
    if (!date || delivered <= 0) continue
    if (!maxDate || date > maxDate) maxDate = date
  }
  return startOfDay(maxDate || new Date())
}

/** Max metrics date within selected city/client scope (falls back to global max). */
export function resolveScopedAsOfDate(riderRows, { cities = [], clients = [] } = {}) {
  const hasScope = cities.length > 0 || clients.length > 0
  if (!hasScope) return resolveAsOfDate(riderRows)

  let maxDate = null
  for (const row of riderRows || []) {
    const city = normalizeSummaryCity(pickField(row, 'city'))
    const client = normalizeSummaryClient(pickField(row, 'client'))
    if (cities.length && !cities.includes(city)) continue
    if (clients.length && !clients.includes(client)) continue

    const date = parseMetricDate(row.date_record)
    const delivered = parseInt(row.delivered, 10) || 0
    if (!date || delivered <= 0) continue
    if (!maxDate || date > maxDate) maxDate = date
  }

  return startOfDay(maxDate || resolveAsOfDate(riderRows))
}

/**
 * Attrition rider = not working since LWD, or since deploy date when Deployee with no orders after deploy.
 * Also includes fleet Deployee riders with no order history in rider_metrics.
 */
export function buildAttritionReport(riderRows, fleetRows = []) {
  if (
    riderRows === cachedReportRiderRef &&
    fleetRows === cachedReportFleetRef &&
    cachedReportResult
  ) {
    return cachedReportResult
  }

  const asOfDay = resolveAsOfDate(riderRows)
  const riderIndex = getRiderMetricIndex(riderRows)
  const { fleetCtx, deployedAssignments, deployedByAlias } = getAttritionFleetBundle(
    fleetRows,
    asOfDay
  )
  const ridersByWorker = new Map()
  const aliasToMapKey = new Map()

  for (const row of riderRows || []) {
    const date = parseMetricDate(row.date_record)
    if (!date) continue

    const delivered = parseInt(row.delivered, 10) || 0
    if (delivered <= 0) continue

    const workerKey = normalizeRiderIdKey(row.worker_code)
    if (!workerKey) continue

    const mapKey = findRiderEntryKey(aliasToMapKey, ridersByWorker, row.worker_code) || workerKey

    const day = startOfDay(date)

    if (!ridersByWorker.has(mapKey)) {
      ridersByWorker.set(mapKey, {
        workerCode: pickField(row, 'worker_code') || workerKey,
        workerName: pickField(row, 'worker_name') || 'N/A',
        city: normalizeSummaryCity(pickField(row, 'city')),
        client: normalizeSummaryClient(pickField(row, 'client')),
        hub: pickField(row, 'hub_name'),
        source: pickField(row, 'source'),
        mobNumber: pickField(row, 'mob_number'),
        firstOrderDateObj: day,
        lastWorkingDateObj: day,
      })
      registerRiderAliases(aliasToMapKey, mapKey, row.worker_code)
    }

    const rider = ridersByWorker.get(mapKey)

    if (day < rider.firstOrderDateObj) rider.firstOrderDateObj = day
    if (day > rider.lastWorkingDateObj) {
      rider.lastWorkingDateObj = day
      rider.workerName = pickField(row, 'worker_name') || rider.workerName
      rider.city = normalizeSummaryCity(pickField(row, 'city')) || rider.city
      rider.client = normalizeSummaryClient(pickField(row, 'client')) || rider.client
      rider.hub = pickField(row, 'hub_name') || rider.hub
      rider.source = pickField(row, 'source') || rider.source
      rider.mobNumber = pickField(row, 'mob_number') || rider.mobNumber
    }
  }

  for (const assignment of deployedAssignments) {
    const riderId = (assignment.riderId || '').toString().trim()
    if (!riderId || findRiderEntryKey(aliasToMapKey, ridersByWorker, riderId)) continue

    const workerKey = normalizeRiderIdKey(riderId) || riderId.toUpperCase()
    ridersByWorker.set(workerKey, {
      workerCode: riderId,
      workerName: assignment.riderName || 'N/A',
      city: normalizeSummaryCity(assignment.city),
      client: normalizeSummaryClient(assignment.client),
      hub: assignment.hub || 'N/A',
      source: assignment.source || 'N/A',
      mobNumber: assignment.mobile || 'N/A',
      firstOrderDateObj: null,
      lastWorkingDateObj: null,
      fleetDeployDateObj: startOfDay(assignment.deployDate),
    })
    registerRiderAliases(aliasToMapKey, workerKey, riderId)
  }

  const riders = []

  for (const rider of ridersByWorker.values()) {
    const deployedHit = lookupDeployedAssignment(deployedByAlias, rider.workerCode)
    const fleetInfo = deployedHit
      ? fleetInfoFromAssignment(
          deployedHit,
          riderIndex,
          rider.workerCode,
          rider.mobNumber,
          fleetCtx.asOf
        )
      : resolveAttritionFleetInfo(fleetCtx, riderIndex, rider.workerCode, rider.mobNumber)

    // Returned riders are not active fleet attrition — exclude from report and mail.
    if (fleetInfo.deployStatus === 'Return') continue

    const daysNotWorking = resolveInactiveDays(asOfDay, rider.lastWorkingDateObj, fleetInfo)
    if (daysNotWorking < 1) continue

    const displayLastWorking = rider.lastWorkingDateObj
      ? format(rider.lastWorkingDateObj, 'dd/MM/yyyy')
      : fleetInfo.deployStatus === 'Deployee' && fleetInfo.deployDate
        ? fleetInfo.deployDate
        : 'N/A'

    const displayFirstOrder = rider.firstOrderDateObj
      ? format(rider.firstOrderDateObj, 'dd/MM/yyyy')
      : 'N/A'

    riders.push({
      workerCode: rider.workerCode,
      workerName: rider.workerName,
      city: rider.city || 'Unknown',
      client: rider.client || 'Unknown',
      hub: rider.hub || 'N/A',
      source: rider.source || 'N/A',
      mobNumber: rider.mobNumber || 'N/A',
      vType: fleetInfo.vType,
      deployVehicle: fleetInfo.deployVehicle,
      deployStatus: fleetInfo.deployStatus,
      deployDate: fleetInfo.deployDate,
      firstOrderDate: displayFirstOrder,
      firstOrderDateKey: rider.firstOrderDateObj
        ? format(rider.firstOrderDateObj, 'yyyy-MM-dd')
        : '',
      lastWorkingDate: displayLastWorking,
      lastWorkingDateKey: rider.lastWorkingDateObj
        ? format(rider.lastWorkingDateObj, 'yyyy-MM-dd')
        : fleetInfo.deployDate
          ? format(parseFleetDate(fleetInfo.deployDate) || asOfDay, 'yyyy-MM-dd')
          : '',
      lastWorkingDayName: rider.lastWorkingDateObj
        ? format(rider.lastWorkingDateObj, 'EEEE')
        : 'N/A',
      daysNotWorking,
      asOfDate: format(asOfDay, 'dd/MM/yyyy'),
      asOfDateKey: format(asOfDay, 'yyyy-MM-dd'),
    })
  }

  riders.sort((a, b) => {
    const source = (a.source || '').localeCompare(b.source || '', undefined, { sensitivity: 'base' })
    if (source !== 0) return source
    const client = (a.client || '').localeCompare(b.client || '', undefined, { sensitivity: 'base' })
    if (client !== 0) return client
    return (a.workerName || '').localeCompare(b.workerName || '', undefined, { sensitivity: 'base' })
  })

  const result = {
    asOfDay,
    asOfDateKey: format(asOfDay, 'yyyy-MM-dd'),
    riders,
    citySummary: summarizeAttrition(riders, 'city'),
    clientSummary: summarizeAttrition(riders, 'client'),
  }

  cachedReportRiderRef = riderRows
  cachedReportFleetRef = fleetRows
  cachedReportResult = result
  return result
}

export function summarizeAttrition(riders, field) {
  const counts = new Map()
  const rentals = new Map()
  for (const rider of riders) {
    const key = rider[field] || 'Unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
    const amount = parseRentalPendingAmount(rider.rentalPendingAmount)
    if (amount != null) {
      rentals.set(key, (rentals.get(key) || 0) + amount)
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      rentalPending: rentals.get(name) || 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function sumAttritionRentalPending(riders) {
  let total = 0
  for (const rider of riders || []) {
    const amount = parseRentalPendingAmount(rider.rentalPendingAmount)
    if (amount != null) total += amount
  }
  return total
}

export function filterAttritionRiders(
  riders,
  {
    search = '',
    cities = [],
    cityKeys = [],
    clients = [],
    firstOrderMonths = [],
    minDaysNotWorking = 1,
  } = {}
) {
  const q = search.toLowerCase().trim()
  return riders.filter((r) => {
    if (r.daysNotWorking < minDaysNotWorking) return false
    if (cityKeys.length && !cityKeys.includes(r.cityKey)) return false
    if (cities.length && !cities.includes(r.city)) return false
    if (clients.length && !clients.includes(r.client)) return false
    if (firstOrderMonths.length) {
      const monthKey = (r.firstOrderDateKey || '').slice(0, 7)
      if (!monthKey || !firstOrderMonths.includes(monthKey)) return false
    }
    if (!q) return true
    return (
      r.workerCode.toLowerCase().includes(q) ||
      r.workerName.toLowerCase().includes(q) ||
      r.mobNumber.toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q) ||
      (r.cityKey || '').toLowerCase().includes(q) ||
      r.client.toLowerCase().includes(q) ||
      (r.vType || '').toLowerCase().includes(q) ||
      (r.deployVehicle || '').toLowerCase().includes(q) ||
      (r.deployStatus || '').toLowerCase().includes(q)
    )
  })
}

export function attritionRidersToExcelRows(riders) {
  return riders.map((r) => ({
    'Rider Name': r.workerName,
    'Worker Code': r.workerCode,
    'Mobile': r.mobNumber,
    'City': r.city,
    'City Key': r.cityKey || '',
    'Client': r.client,
    'Hub': r.hub,
    'Source': r.source,
    'V Type': r.vType,
    'Deployee Vehicle': r.deployVehicle,
    'Fleet Status': r.deployStatus,
    'Deploy Date': r.deployDate,
    'First Order Date': r.firstOrderDate,
    'Last Working Date': r.lastWorkingDate,
    'Days Not Working': r.daysNotWorking,
    'As Of Date': r.asOfDate,
    'Rental Pending Amount': r.rentalPendingAmount ?? '',
  }))
}

export function attritionRidersToCsv(riders) {
  const rows = attritionRidersToExcelRows(riders)
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ]
  return lines.join('\n')
}
