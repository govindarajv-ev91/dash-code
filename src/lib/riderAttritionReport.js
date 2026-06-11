import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { parseFleetDate } from './fleetDeployReturnExport'
import { buildRiderMetricDateIndex, isIcRiderRow } from './fleetMasterSheet'
import { normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import { getCurrentlyDeployedAssignments, normalizeRiderIdKey } from './riderPerformanceReport'

function normalizeWorkerKey(value) {
  return (value ?? '').toString().trim().toLowerCase()
}

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

function lookupDeployEntry(deployByLookup, workerCode, mobile) {
  const workerKey = normalizeRiderIdKey(workerCode)
  const phone = normalizePhone(mobile)
  if (workerKey && deployByLookup.has(workerKey)) return deployByLookup.get(workerKey)
  if (phone && deployByLookup.has(`phone:${phone}`)) return deployByLookup.get(`phone:${phone}`)
  return null
}

function lookupReturnEntry(returnByLookup, workerCode, mobile) {
  const workerKey = normalizeRiderIdKey(workerCode)
  const phone = normalizePhone(mobile)
  let latest = null
  for (const key of [workerKey, phone ? `phone:${phone}` : null]) {
    if (!key) continue
    const hit = returnByLookup.get(key)
    if (hit && (!latest || hit.date > latest.date)) latest = hit
  }
  return latest
}

/** One fleet pass + one deploy scan for all attrition riders (as-of report date). */
function buildAttritionFleetIndex(fleetRows, asOfDate) {
  const asOf = startOfDay(asOfDate)
  const deployByLookup = new Map()
  const returnByLookup = new Map()

  if (fleetRows?.length) {
    for (const assignment of getCurrentlyDeployedAssignments(fleetRows, asOf)) {
      const entry = {
        vehicleNumber: assignment.vehicleNumber || 'N/A',
        deployDate: startOfDay(assignment.deployDate),
      }
      const id = normalizeRiderIdKey(assignment.riderId)
      const phone = normalizePhone(assignment.mobile)
      if (id) deployByLookup.set(id, entry)
      if (phone) deployByLookup.set(`phone:${phone}`, entry)
    }

    for (const row of fleetRows) {
      const status = (row.vehicle_status || '').toString().trim().toLowerCase()
      if (status !== 'return') continue
      const date = parseFleetDate(row.date_record)
      if (!date) continue
      const eventDate = startOfDay(date)
      if (eventDate > asOf) continue

      const entry = {
        date: eventDate,
        vehicleNumber: pickField(row, 'vehicle_number') || 'N/A',
      }
      const id = normalizeRiderIdKey(row.rider_id)
      const phone = normalizePhone(row.rider_contact_number)
      for (const key of [id, phone ? `phone:${phone}` : null]) {
        if (!key) continue
        const prev = returnByLookup.get(key)
        if (!prev || eventDate > prev.date) returnByLookup.set(key, entry)
      }
    }
  }

  return { deployByLookup, returnByLookup, asOf }
}

/**
 * Fleet status as of report date (not LWD).
 * EV = open Deployee on as-of; Return = bike returned on/before as-of; else N/A.
 */
function resolveAttritionFleetInfo(fleetIndex, riderIndex, workerCode, mobile) {
  const deploy = lookupDeployEntry(fleetIndex.deployByLookup, workerCode, mobile)

  if (deploy) {
    const metric = metricOnDate(riderIndex, workerCode, mobile, fleetIndex.asOf)
    const isIc = metric && isIcRiderRow(metric)
    return {
      vType: isIc ? 'NON-EV' : 'EV',
      deployVehicle: deploy.vehicleNumber,
      deployStatus: 'Deployee',
      deployDate: format(deploy.deployDate, 'dd/MM/yyyy'),
    }
  }

  const lastReturn = lookupReturnEntry(fleetIndex.returnByLookup, workerCode, mobile)
  if (lastReturn) {
    return {
      vType: 'NON-EV',
      deployVehicle: lastReturn.vehicleNumber,
      deployStatus: 'Return',
      deployDate: format(lastReturn.date, 'dd/MM/yyyy'),
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
 * Attrition rider = last working date (LWD) is before as-of date.
 * daysNotWorking = calendar days from LWD to as-of (e.g. LWD 01/06 → as-of 03/06 = 2 days).
 */
export function buildAttritionReport(
  riderRows,
  fleetRows = [],
  { minDaysNotWorking = 1, cities = [], clients = [] } = {}
) {
  const asOfDay = resolveScopedAsOfDate(riderRows, { cities, clients })
  const riderIndex = buildRiderMetricDateIndex(riderRows)
  const fleetIndex = buildAttritionFleetIndex(fleetRows, asOfDay)
  const ridersByWorker = new Map()

  for (const row of riderRows || []) {
    const date = parseMetricDate(row.date_record)
    if (!date) continue

    const delivered = parseInt(row.delivered, 10) || 0
    if (delivered <= 0) continue

    const workerKey = normalizeWorkerKey(row.worker_code)
    if (!workerKey) continue

    const day = startOfDay(date)

    if (!ridersByWorker.has(workerKey)) {
      ridersByWorker.set(workerKey, {
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
    }

    const rider = ridersByWorker.get(workerKey)

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

  const riders = []

  for (const rider of ridersByWorker.values()) {
    const daysNotWorking = differenceInCalendarDays(asOfDay, rider.lastWorkingDateObj)
    if (daysNotWorking < minDaysNotWorking) continue

    const fleetInfo = resolveAttritionFleetInfo(
      fleetIndex,
      riderIndex,
      rider.workerCode,
      rider.mobNumber
    )

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
      firstOrderDate: format(rider.firstOrderDateObj, 'dd/MM/yyyy'),
      firstOrderDateKey: format(rider.firstOrderDateObj, 'yyyy-MM-dd'),
      lastWorkingDate: format(rider.lastWorkingDateObj, 'dd/MM/yyyy'),
      lastWorkingDateKey: format(rider.lastWorkingDateObj, 'yyyy-MM-dd'),
      lastWorkingDayName: format(rider.lastWorkingDateObj, 'EEEE'),
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

  return {
    asOfDay,
    asOfDateKey: format(asOfDay, 'yyyy-MM-dd'),
    riders,
    citySummary: summarizeAttrition(riders, 'city'),
    clientSummary: summarizeAttrition(riders, 'client'),
  }
}

export function summarizeAttrition(riders, field) {
  const counts = new Map()
  for (const rider of riders) {
    const key = rider[field] || 'Unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
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
