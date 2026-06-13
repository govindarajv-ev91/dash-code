import { format, startOfDay } from 'date-fns'
import { parseFleetDate, vehiclePartitionKey } from './fleetDeployReturnExport'
import { getCurrentlyDeployedAssignments, normalizeRiderIdKey } from './riderPerformanceReport'
import { isIcRiderRow } from './fleetMasterSheet'
import {
  prepareMergedFleetRows,
  buildRiderVehicleAssignmentIndex,
  findRiderVehicleOnDate,
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

function assignmentMatchesWorker(assignment, workerCode) {
  const lookupKeys = riderKeysForLookup(workerCode)
  const assignId = normalizeRiderIdKey(assignment.riderId)
  if (assignId && lookupKeys.has(assignId)) return true
  const assignPhone = normalizePhone(assignment.mobile)
  if (assignPhone && lookupKeys.has(`phone:${assignPhone}`)) return true
  return false
}

/** Per vehicle + deploy rider: contact ids/phones from fleet rows on or before as-of. */
function buildVehicleRiderContactIndex(fleetRows, asOfDate) {
  const asOf = startOfDay(asOfDate)
  const byVehicle = new Map()

  for (const row of fleetRows || []) {
    const date = parseFleetDate(row.date_record)
    if (!date || date > asOf) continue
    const vehicleKey = vehiclePartitionKey(row.vehicle_number)
    if (!vehicleKey) continue

    const riderId = normalizeRiderIdKey(row.rider_id) || '_unknown'
    if (!byVehicle.has(vehicleKey)) byVehicle.set(vehicleKey, new Map())
    const riders = byVehicle.get(vehicleKey)
    if (!riders.has(riderId)) riders.set(riderId, { ids: new Set(), phones: new Set() })

    const bucket = riders.get(riderId)
    const id = normalizeRiderIdKey(row.rider_id)
    const phone = normalizePhone(row.rider_contact_number)
    if (id) bucket.ids.add(id)
    if (phone) bucket.phones.add(phone)
  }

  return byVehicle
}

function contactIndexMatches(contactIndex, vehicleKey, deployRiderId, workerCode) {
  const lookupKeys = riderKeysForLookup(workerCode)
  const riders = contactIndex.get(vehicleKey)
  if (!riders) return false

  const deployId = normalizeRiderIdKey(deployRiderId)
  const buckets = deployId ? [riders.get(deployId)].filter(Boolean) : [...riders.values()]

  for (const bucket of buckets) {
    for (const id of bucket.ids) {
      if (lookupKeys.has(id)) return true
    }
    for (const p of bucket.phones) {
      if (lookupKeys.has(`phone:${p}`)) return true
    }
  }
  return false
}

/** Cache deployed riders + contact index per lookup date in the batch. */
function buildFleetLookupCaches(preparedFleetRows, dates) {
  const assignmentsCache = new Map()
  const contactIndexCache = new Map()
  for (const date of dates) {
    const dateKey = format(date, 'yyyy-MM-dd')
    if (assignmentsCache.has(dateKey)) continue
    assignmentsCache.set(dateKey, getCurrentlyDeployedAssignments(preparedFleetRows, date))
    contactIndexCache.set(dateKey, buildVehicleRiderContactIndex(preparedFleetRows, date))
  }
  return { assignmentsCache, contactIndexCache }
}

function resolveVehicleForRider(preparedFleet, vehicleIndex, identityKeys, asOfDate, fleetAssignment) {
  const fromAssignment = (fleetAssignment?.vehicleNumber || '').toString().trim()
  if (fromAssignment) return fromAssignment

  const interval = findRiderVehicleOnDate(vehicleIndex, identityKeys, startOfDay(asOfDate))
  const fromInterval = (interval?.vehicleNumber || '').toString().trim()
  if (fromInterval) return fromInterval

  return findVehicleOnExactFleetDate(preparedFleet, identityKeys, asOfDate)
}

function findFleetDeployment(assignmentsCache, contactIndexCache, workerCode, asOfDate) {
  const dateKey = format(asOfDate, 'yyyy-MM-dd')
  const asOf = startOfDay(asOfDate)
  const assignments = assignmentsCache.get(dateKey) || []
  const contactIndex = contactIndexCache.get(dateKey)

  for (const assignment of assignments) {
    const deployDay = startOfDay(assignment.deployDate)
    if (deployDay > asOf) continue

    if (assignmentMatchesWorker(assignment, workerCode)) return assignment

    const vehicleKey = vehiclePartitionKey(assignment.vehicleNumber)
    if (vehicleKey && contactIndex && contactIndexMatches(contactIndex, vehicleKey, assignment.riderId, workerCode)) {
      return assignment
    }
  }

  return null
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

/** Find which rider had a vehicle deployed on each pasted date. */
export function lookupRiderByVehicle(pasteText, fleetRows = []) {
  const parsed = parseDateVehiclePaste(pasteText)
  const preparedFleet = prepareMergedFleetRows(fleetRows)
  const uniqueDates = [...new Map(parsed.map((r) => [format(r.date, 'yyyy-MM-dd'), r.date])).values()]
  const { assignmentsCache } = buildFleetLookupCaches(preparedFleet, uniqueDates)

  return parsed.map((row) => {
    const dateKey = format(row.date, 'yyyy-MM-dd')
    const assignments = assignmentsCache.get(dateKey) || []
    const match = assignments.find(
      (assignment) => vehiclePartitionKey(assignment.vehicleNumber) === row.vehicleKey
    )

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

    // Return-day rows: rider still linked to vehicle on that calendar date.
    for (const fleetRow of preparedFleet) {
      const date = parseFleetDate(fleetRow.date_record)
      if (!date || format(startOfDay(date), 'yyyy-MM-dd') !== dateKey) continue
      if (vehiclePartitionKey(fleetRow.vehicle_number) !== row.vehicleKey) continue
      const status = (fleetRow.vehicle_status || '').toString().trim()
      if (!/deployee|return|deploy/i.test(status)) continue
      const riderId = (fleetRow.rider_id || '').toString().trim()
      if (!riderId) continue
      return {
        ...row,
        workerCode: riderId,
        riderName: (fleetRow.rider_name || '').toString().trim(),
        mobile: (fleetRow.rider_contact_number || '').toString().trim(),
        deployDateKey: formatMetricDateKey(date),
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

/** Per worker ID or phone, metrics rows sorted newest → oldest (for date fallback). */
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

function lookupIdentityKeys(workerCode) {
  return [...riderKeysForLookup(workerCode)]
}

/**
 * EV if rider has a fleet vehicle deployed as of the lookup date; else rider_metrics; else NON-EV.
 */
export function lookupRiderEvTypes(pasteText, riderRows, fleetRows = []) {
  const parsed = parseDateWorkerPaste(pasteText)
  const index = buildRiderEvIndex(riderRows)
  const byWorker = buildRiderEvHistoryByWorker(riderRows)
  const preparedFleet = prepareMergedFleetRows(fleetRows)
  const vehicleIndex = buildRiderVehicleAssignmentIndex(preparedFleet)
  const uniqueDates = [...new Map(parsed.map((r) => [format(r.date, 'yyyy-MM-dd'), r.date])).values()]
  const { assignmentsCache, contactIndexCache } = buildFleetLookupCaches(preparedFleet, uniqueDates)

  return parsed.map((row) => {
    const identityKeys = lookupIdentityKeys(row.workerCode)

    const fleetAssignment = findFleetDeployment(assignmentsCache, contactIndexCache, row.workerCode, row.date)
    const vehicleNumber = resolveVehicleForRider(
      preparedFleet,
      vehicleIndex,
      identityKeys,
      row.date,
      fleetAssignment
    )

    if (fleetAssignment || vehicleNumber) {
      return {
        ...row,
        evType: 'EV',
        vehicleNumber,
        matchedDateKey: fleetAssignment
          ? formatMetricDateKey(fleetAssignment.deployDate)
          : formatMetricDateKey(row.date),
        status: 'fleet',
      }
    }

    for (const identityKey of identityKeys) {
      const exactKey = `${row.dateKey}|${identityKey}`
      if (index.has(exactKey)) {
        return {
          ...row,
          evType: index.get(exactKey),
          vehicleNumber,
          matchedDateKey: row.dateKey,
          status: 'exact',
        }
      }
    }

    const fallback = findEvTypeOnOrBefore(byWorker, identityKeys, row.date)
    if (fallback) {
      return {
        ...row,
        evType: fallback.evType,
        vehicleNumber,
        matchedDateKey: fallback.dateKey,
        status: fallback.dateKey === row.dateKey ? 'exact' : 'fallback',
      }
    }

    return {
      ...row,
      evType: 'NON-EV',
      vehicleNumber,
      matchedDateKey: null,
      status: 'not found',
    }
  })
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

/** One worker code per line — for paste-back into sheets. */
export function vehicleRiderLookupWorkerCodesOnly(results) {
  return results.map((row) => row.workerCode || '').join('\n')
}

/** One type per line — for paste-back into sheets (Type column only). */
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
