import { format, startOfDay } from 'date-fns'
import { parseFleetDate, vehiclePartitionKey } from './fleetDeployReturnExport'
import { normalizeRiderIdKey } from './riderPerformanceReport'
import { isIcRiderRow } from './fleetMasterSheet'
import {
  prepareMergedFleetRows,
  buildFleetIntervalIndexes,
  findRiderVehicleOnDate,
  findRiderForVehicleOnDate,
  buildExactFleetVehicleIndex,
  findVehicleOnExactFleetDate,
} from './fleetInsightIndex'

export function classifyRiderEvType(type1, type2) {
  const check = (value) => {
    const t = String(value || '').toUpperCase().trim()
    if (!t) return false
    return t.includes('EV') && !t.includes('NON')
  }
  return check(type1) || check(type2) ? 'EV' : 'NON-EV'
}

function formatMetricDateKey(date) {
  return format(date, 'dd/MM/yyyy')
}

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function riderKeysForLookup(workerCode) {
  const keys = new Set()
  const idKey = normalizeRiderIdKey(workerCode)
  if (idKey) keys.add(idKey)
  const digits = (workerCode ?? '').toString().replace(/\D/g, '')
  if (digits && digits !== idKey) keys.add(digits)
  const phone = normalizePhone(workerCode)
  if (phone.length >= 10) keys.add(`phone:${phone}`)
  return keys
}

function lookupIdentityKeys(workerCode) {
  return [...riderKeysForLookup(workerCode)]
}

function resolveVehicleForRider(ctx, identityKeys, asOfDate) {
  const interval = findRiderVehicleOnDate(ctx.riderAssignments, identityKeys, startOfDay(asOfDate))
  const fromInterval = (interval?.vehicleNumber || '').toString().trim()
  if (fromInterval) return { vehicleNumber: fromInterval, interval }

  const exact = findVehicleOnExactFleetDate(ctx.exactVehicleIndex, identityKeys, asOfDate)
  if (exact) return { vehicleNumber: exact, interval: null }

  return { vehicleNumber: '', interval: null }
}

let cachedContext = null
let cachedRiderRef = null
let cachedFleetRef = null

/** Build indexes once — reused across paste lookups (avoids re-scanning full fleet). */
export function buildEvLookupContext(riderRows, fleetRows) {
  if (riderRows === cachedRiderRef && fleetRows === cachedFleetRef && cachedContext) {
    return cachedContext
  }

  const preparedFleet = prepareMergedFleetRows(fleetRows)
  const { riderAssignments, vehicleIntervals } = buildFleetIntervalIndexes(preparedFleet)

  cachedContext = {
    preparedFleet,
    riderAssignments,
    vehicleIntervals,
    exactVehicleIndex: buildExactFleetVehicleIndex(preparedFleet),
    metricsIndex: buildRiderEvIndex(riderRows),
    metricsHistory: buildRiderEvHistoryByWorker(riderRows),
  }
  cachedRiderRef = riderRows
  cachedFleetRef = fleetRows
  return cachedContext
}

export function clearEvLookupContextCache() {
  cachedContext = null
  cachedRiderRef = null
  cachedFleetRef = null
}

function metricIdentityKeys(row) {
  const keys = new Set()
  const worker = (row.worker_code ?? '').toString().trim()
  if (worker) keys.add(normalizeRiderIdKey(worker))
  const phone = normalizePhone(row.mob_number)
  if (phone) keys.add(`phone:${phone}`)
  return keys
}

function metricEvTypeFromRow(row) {
  if (isIcRiderRow(row)) return 'NON-EV'
  return classifyRiderEvType(row.type1, row.type2)
}

/** Parse pasted lines: "29/05/2026\tCHN129-R0829" or space-separated. */
export function parseDateWorkerPaste(text) {
  const rows = []
  const lines = (text || '').split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const parts = line.includes('\t')
      ? line.split('\t').map((p) => p.trim()).filter(Boolean)
      : line.split(/\s{2,}|\s+/).map((p) => p.trim()).filter(Boolean)

    if (parts.length < 2) continue
    if (/^date$/i.test(parts[0]) && /^worker/i.test(parts[1])) continue

    const date = parseFleetDate(parts[0])
    const workerCode = parts.slice(1).join(' ').trim()
    if (!date || !workerCode) continue

    rows.push({
      line: i + 1,
      date,
      dateDisplay: parts[0],
      dateKey: formatMetricDateKey(date),
      workerCode,
      workerKey: normalizeRiderIdKey(workerCode),
    })
  }

  return rows
}

/** Parse pasted lines: "29/05/2026\tDL4SDX8338" — date + vehicle number. */
export function parseDateVehiclePaste(text) {
  const rows = []
  const lines = (text || '').split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const parts = line.includes('\t')
      ? line.split('\t').map((p) => p.trim()).filter(Boolean)
      : line.split(/\s{2,}|\s+/).map((p) => p.trim()).filter(Boolean)

    if (parts.length < 2) continue
    if (/^date$/i.test(parts[0]) && /^vehicle|vehiclenumber|v\s*no/i.test(parts[1])) continue

    const date = parseFleetDate(parts[0])
    const vehicleNumber = parts[1]
    if (!date || !vehicleNumber) continue

    rows.push({
      line: i + 1,
      date,
      dateDisplay: parts[0],
      dateKey: formatMetricDateKey(date),
      vehicleNumber: vehicleNumber.toString().trim(),
      vehicleKey: vehiclePartitionKey(vehicleNumber),
    })
  }

  return rows
}

export function buildRiderEvIndex(riderRows) {
  const index = new Map()

  for (const row of riderRows || []) {
    const date = parseFleetDate(row.date_record)
    if (!date) continue

    const dateKey = formatMetricDateKey(date)
    const evType = metricEvTypeFromRow(row)
    for (const identityKey of metricIdentityKeys(row)) {
      index.set(`${dateKey}|${identityKey}`, evType)
    }
  }

  return index
}

export function buildRiderEvHistoryByWorker(riderRows) {
  const byIdentity = new Map()

  for (const row of riderRows || []) {
    const date = parseFleetDate(row.date_record)
    if (!date) continue

    const record = {
      date,
      dateKey: formatMetricDateKey(date),
      evType: metricEvTypeFromRow(row),
      row,
    }

    for (const identityKey of metricIdentityKeys(row)) {
      if (!byIdentity.has(identityKey)) byIdentity.set(identityKey, [])
      byIdentity.get(identityKey).push(record)
    }
  }

  for (const records of byIdentity.values()) {
    records.sort((a, b) => b.date - a.date)
  }

  return byIdentity
}

export function findEvTypeOnOrBefore(byIdentity, lookupKeys, asOfDate) {
  let best = null

  for (const key of lookupKeys) {
    const records = byIdentity.get(key)
    if (!records?.length) continue

    for (const record of records) {
      if (record.date <= asOfDate && (!best || record.date > best.date)) {
        best = record
      }
    }
  }

  return best
}

function lookupWorkerRow(row, ctx) {
  const identityKeys = lookupIdentityKeys(row.workerCode)
  const { vehicleNumber, interval } = resolveVehicleForRider(ctx, identityKeys, row.date)

  if (vehicleNumber) {
    return {
      ...row,
      evType: 'EV',
      vehicleNumber,
      matchedDateKey: interval
        ? formatMetricDateKey(interval.deployDate)
        : row.dateKey,
      status: 'fleet',
    }
  }

  for (const identityKey of identityKeys) {
    const exactKey = `${row.dateKey}|${identityKey}`
    if (ctx.metricsIndex.has(exactKey)) {
      return {
        ...row,
        evType: ctx.metricsIndex.get(exactKey),
        vehicleNumber: '',
        matchedDateKey: row.dateKey,
        status: 'exact',
      }
    }
  }

  const fallback = findEvTypeOnOrBefore(ctx.metricsHistory, identityKeys, row.date)
  if (fallback) {
    return {
      ...row,
      evType: fallback.evType,
      vehicleNumber: '',
      matchedDateKey: fallback.dateKey,
      status: fallback.dateKey === row.dateKey ? 'exact' : 'fallback',
    }
  }

  return {
    ...row,
    evType: 'NON-EV',
    vehicleNumber: '',
    matchedDateKey: null,
    status: 'not found',
  }
}

/** Fast path — pass pre-built context from buildEvLookupContext(). */
export function lookupRiderEvTypesWithContext(pasteText, ctx) {
  if (!ctx) return []
  const parsed = parseDateWorkerPaste(pasteText)
  return parsed.map((row) => lookupWorkerRow(row, ctx))
}

/**
 * EV if rider has a fleet vehicle deployed as of the lookup date; else rider_metrics; else NON-EV.
 */
export function lookupRiderEvTypes(pasteText, riderRows, fleetRowsOrContext = []) {
  const ctx = fleetRowsOrContext?.riderAssignments
    ? fleetRowsOrContext
    : buildEvLookupContext(riderRows, fleetRowsOrContext)
  return lookupRiderEvTypesWithContext(pasteText, ctx)
}

/** Fast path — pass pre-built context from buildEvLookupContext(). */
export function lookupRiderByVehicleWithContext(pasteText, ctx) {
  if (!ctx) return []
  const parsed = parseDateVehiclePaste(pasteText)

  return parsed.map((row) => {
    const match = findRiderForVehicleOnDate(ctx.vehicleIntervals, row.vehicleKey, row.date)

    if (match) {
      return {
        ...row,
        workerCode: (match.riderId || '').toString().trim(),
        riderName: (match.riderName || '').toString().trim(),
        mobile: (match.mobile || '').toString().trim(),
        deployDateKey: formatMetricDateKey(match.deployDate),
        status: 'deployed',
      }
    }

    return {
      ...row,
      workerCode: '',
      riderName: '',
      mobile: '',
      deployDateKey: '',
      status: 'not found',
    }
  })
}

/** Find which rider had a vehicle deployed on each pasted date. */
export function lookupRiderByVehicle(pasteText, fleetRows, riderRows = []) {
  const ctx = fleetRows?.riderAssignments
    ? fleetRows
    : buildEvLookupContext(riderRows, fleetRows)
  return lookupRiderByVehicleWithContext(pasteText, ctx)
}

export function evLookupToCsv(results) {
  const escapeCsv = (val) => {
    const str = (val ?? '').toString()
    return `"${str.replace(/"/g, '""')}"`
  }

  const headers = ['Date', 'WorkerCode', 'Vehicle Number', 'Type', 'Source', 'Match status']
  const lines = [headers.map(escapeCsv).join(',')]

  for (const row of results) {
    const matchStatus =
      row.status === 'fleet'
        ? 'Fleet deploy'
        : row.status === 'exact'
          ? 'Exact date'
          : row.status === 'fallback'
            ? 'Fallback date'
            : 'Not found'

    lines.push(
      [
        row.dateDisplay,
        row.workerCode,
        row.vehicleNumber || '',
        row.evType,
        row.status === 'fleet' ? 'Fleet' : 'Metrics',
        matchStatus,
      ]
        .map(escapeCsv)
        .join(',')
    )
  }

  return lines.join('\n')
}

export function vehicleRiderLookupToCsv(results) {
  const escapeCsv = (val) => {
    const str = (val ?? '').toString()
    return `"${str.replace(/"/g, '""')}"`
  }

  const headers = ['Date', 'Vehicle Number', 'WorkerCode', 'Rider Name', 'Mobile', 'Deploy Date', 'Status']
  const lines = [headers.map(escapeCsv).join(',')]

  for (const row of results) {
    lines.push(
      [
        row.dateDisplay,
        row.vehicleNumber,
        row.workerCode,
        row.riderName,
        row.mobile,
        row.deployDateKey || '',
        row.status === 'deployed' ? 'Deployed' : 'Not found',
      ]
        .map(escapeCsv)
        .join(',')
    )
  }

  return lines.join('\n')
}

export function vehicleRiderLookupWorkerCodesOnly(results) {
  return results.map((row) => row.workerCode || '').join('\n')
}

export function evLookupTypesOnly(results) {
  return results.map((row) => row.evType).join('\n')
}

export function evLookupToTsv(results) {
  const lines = ['Date\tWorkerCode\tVehicle Number\tType\tMatchedDate\tStatus']
  for (const row of results) {
    lines.push(
      `${row.dateDisplay}\t${row.workerCode}\t${row.vehicleNumber || ''}\t${row.evType}\t${row.matchedDateKey || ''}\t${row.status}`
    )
  }
  return lines.join('\n')
}
