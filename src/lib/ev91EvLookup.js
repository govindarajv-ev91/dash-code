import { format, startOfDay } from 'date-fns'
import { parseFleetDate, vehiclePartitionKey } from './fleetDeployReturnExport'
import { riderIdLookupKeys } from './riderPerformanceReport'
import {
  parseDateWorkerPaste,
  parseDateVehiclePaste,
} from './riderEvLookup'
import { fetchAllEv91MisData, clearEv91AllCache } from './ev91MisApi'
import { selectOverviewOrderRows } from './mergeRiderMetrics'

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function formatDateKey(date) {
  return format(date, 'dd/MM/yyyy')
}

function normalizeEv91OverallStatus(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('deploy')) return 'Deployed'
  if (s.includes('return')) return 'Returned'
  if (s.includes('swap')) return 'Client-Swap'
  return ''
}

function normalizeCurrentStatus(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('deploy')) return 'Deployed'
  if (s.includes('return')) return 'Returned'
  return ''
}

function lookupIdentityKeys(workerCode) {
  const keys = new Set()
  const raw = (workerCode ?? '').toString().trim()
  if (!raw) return []

  for (const alias of riderIdLookupKeys(raw)) keys.add(alias)

  const phone = normalizePhone(raw)
  if (phone.length === 10) keys.add(`phone:${phone}`)
  return [...keys]
}

/**
 * Identity keys for Overall Status rows.
 * Do NOT index bare digit-strips of EV91 IDs (e.g. BLR-26-R000251 → 26000251).
 */
function identityKeysForOverallRow(row) {
  const keys = new Set()

  const clientId = (row.clientId || row.clientRiderId || '').toString().trim()
  if (clientId) {
    keys.add(clientId)
    const idKey = clientId.toUpperCase().replace(/[_\s-]+/g, '-')
    if (idKey) keys.add(idKey)
    for (const alias of riderIdLookupKeys(clientId)) {
      if (/^[A-Z]{2,5}-\d{2}-R\d+/i.test(clientId) && /^\d+$/.test(alias) && alias.length < 10) {
        continue
      }
      keys.add(alias)
    }
  }

  const ev91RiderId = (row.ev91RiderId || '').toString().trim()
  if (ev91RiderId) {
    keys.add(ev91RiderId)
    keys.add(ev91RiderId.toUpperCase().replace(/[_\s-]+/g, '-'))
  }

  const phone = normalizePhone(row.riderContact)
  if (phone.length === 10) keys.add(`phone:${phone}`)

  return keys
}

function pushRiderInterval(map, key, deployEvent, returnDate) {
  if (!key) return
  if (!map.has(key)) map.set(key, [])
  map.get(key).push({
    from: deployEvent.date,
    to: returnDate,
    vehicleNumber: (deployEvent.row.vehicleNumber || '').toString().trim(),
    mobile: (deployEvent.row.riderContact || '').toString().trim(),
    riderId: (deployEvent.row.clientId || deployEvent.row.clientRiderId || deployEvent.row.ev91RiderId || '').toString().trim(),
    ev91RiderId: (deployEvent.row.ev91RiderId || '').toString().trim(),
    clientId: (deployEvent.row.clientId || deployEvent.row.clientRiderId || '').toString().trim(),
    riderName: (deployEvent.row.riderName || '').toString().trim(),
    clientName: (deployEvent.row.clientName || '').toString().trim(),
    city: (deployEvent.row.cityName || deployEvent.row.city || '').toString().trim(),
    sourceName: (deployEvent.row.sourceName || deployEvent.row.source || '').toString().trim(),
    deployDate: deployEvent.date,
  })
}

function pushVehicleInterval(map, vehicleKey, deployEvent, returnDate) {
  if (!vehicleKey) return
  if (!map.has(vehicleKey)) map.set(vehicleKey, [])
  map.get(vehicleKey).push({
    from: deployEvent.date,
    to: returnDate,
    vehicleNumber: (deployEvent.row.vehicleNumber || '').toString().trim(),
    riderId: (deployEvent.row.clientId || deployEvent.row.clientRiderId || deployEvent.row.ev91RiderId || '').toString().trim(),
    ev91RiderId: (deployEvent.row.ev91RiderId || '').toString().trim(),
    clientId: (deployEvent.row.clientId || deployEvent.row.clientRiderId || '').toString().trim(),
    riderName: (deployEvent.row.riderName || '').toString().trim(),
    mobile: (deployEvent.row.riderContact || '').toString().trim(),
    clientName: (deployEvent.row.clientName || '').toString().trim(),
    city: (deployEvent.row.cityName || deployEvent.row.city || '').toString().trim(),
    sourceName: (deployEvent.row.sourceName || deployEvent.row.source || '').toString().trim(),
    deployDate: deployEvent.date,
  })
}

/** Parse API timestamp keeping real clock time for same-day ordering. */
function parseEventInstant(value) {
  if (value == null || value === '') return null
  const s = String(value).trim()
  if (!s) return null

  // ISO / yyyy-MM-dd first (unambiguous).
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = new Date(s)
    if (!Number.isNaN(iso.getTime())) return iso
  }

  // DD/MM/YYYY (and similar) via fleet parser — do NOT use bare `new Date('03/08/2026')`
  // which is locale-ambiguous (US = 8 Mar, intended often 3 Aug).
  const day = parseFleetDate(s)
  if (day) {
    const timeMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (timeMatch) {
      const withTime = new Date(day)
      withTime.setHours(
        Number(timeMatch[1]) || 0,
        Number(timeMatch[2]) || 0,
        Number(timeMatch[3]) || 0,
        0
      )
      return withTime
    }
    return day
  }

  const raw = new Date(s)
  if (!Number.isNaN(raw.getTime())) return raw
  return null
}

/**
 * Sort by real timestamp first.
 * Same timestamp only: Returned before Deployed/Client-Swap so hand-back then re-deploy works.
 */
function sortEv91Events(a, b) {
  const diff = a.at.getTime() - b.at.getTime()
  if (diff !== 0) return diff
  const rank = (s) => (s === 'Returned' ? 0 : s === 'Client-Swap' ? 1 : 2)
  return rank(a.status) - rank(b.status)
}

/**
 * Build deploy intervals from EV91 Overall Vehicle Status rows.
 *
 * Rules:
 * - Deployed → start (or restart) an open deploy
 * - Client-Swap → still deployed; client mapping changed (do NOT end allotment)
 * - Returned → end the open deploy
 *
 * Same-day Return then Deploy (common when bike changes rider) must keep the
 * new Deploy open — events are ordered by full timestamp, not calendar day alone.
 */
export function buildEv91OverallIntervalIndexes(overallRows = []) {
  const byVehicle = new Map()

  for (const row of overallRows || []) {
    const status = normalizeEv91OverallStatus(row.vehicleStatus)
    if (!status) continue
    const at = parseEventInstant(row.statusDate)
    if (!at || Number.isNaN(at.getTime())) continue
    const vehicleKey = vehiclePartitionKey(row.vehicleNumber)
    if (!vehicleKey) continue
    if (!byVehicle.has(vehicleKey)) byVehicle.set(vehicleKey, [])
    byVehicle.get(vehicleKey).push({
      status,
      at,
      date: startOfDay(at),
      row,
    })
  }

  const riderAssignments = new Map()
  const vehicleIntervals = new Map()

  for (const [vehicleKey, events] of byVehicle) {
    events.sort(sortEv91Events)

    /** @type {{ startEvent: any, identityByClient: Map<string, { from: Date, row: any }> } | null} */
    let open = null

    const addIdentity = (event) => {
      if (!open) return
      const clientId = (event.row.clientId || event.row.ev91RiderId || '').toString().trim()
      const key = clientId || `row-${event.at.getTime()}`
      const prev = open.identityByClient.get(key)
      if (!prev || event.date < prev.from) {
        open.identityByClient.set(key, { from: event.date, row: event.row })
      } else {
        open.identityByClient.set(key, { from: prev.from, row: event.row })
      }
      const ev91 = (event.row.ev91RiderId || '').toString().trim()
      if (ev91 && ev91 !== key) {
        const prevEv = open.identityByClient.get(`ev91:${ev91}`)
        if (!prevEv || event.date < prevEv.from) {
          open.identityByClient.set(`ev91:${ev91}`, { from: event.date, row: event.row })
        } else {
          open.identityByClient.set(`ev91:${ev91}`, { from: prevEv.from, row: event.row })
        }
      }
    }

    const startOpen = (event) => {
      open = {
        startEvent: event,
        identityByClient: new Map(),
      }
      addIdentity(event)
    }

    const closeOpen = (endDate) => {
      if (!open) return

      let latestRow = open.startEvent.row
      let latestFrom = open.startEvent.date
      for (const { from, row } of open.identityByClient.values()) {
        if (from >= latestFrom) {
          latestFrom = from
          latestRow = row
        }
      }
      pushVehicleInterval(
        vehicleIntervals,
        vehicleKey,
        { date: open.startEvent.date, row: latestRow },
        endDate
      )

      const seenKeys = new Set()
      for (const { from, row } of open.identityByClient.values()) {
        const syntheticEvent = { date: from, row }
        for (const idKey of identityKeysForOverallRow(row)) {
          const dedupe = `${idKey}|${from.getTime()}`
          if (seenKeys.has(dedupe)) continue
          seenKeys.add(dedupe)
          pushRiderInterval(riderAssignments, idKey, syntheticEvent, endDate)
        }
      }

      open = null
    }

    for (const event of events) {
      if (event.status === 'Deployed') {
        if (open) closeOpen(event.date)
        startOpen(event)
      } else if (event.status === 'Returned') {
        closeOpen(event.date)
      } else if (event.status === 'Client-Swap') {
        if (!open) startOpen(event)
        else addIdentity(event)
      }
    }
    if (open) closeOpen(null)
  }

  return { riderAssignments, vehicleIntervals }
}

/**
 * Ensure currently-deployed Current Status rows are open-ended in the indexes.
 * Covers cases where Overall Status history is incomplete or same-day ordering was messy.
 */
export function mergeCurrentStatusIntoIndexes(indexes, currentRows = []) {
  const { riderAssignments, vehicleIntervals } = indexes
  if (!currentRows?.length) return indexes

  for (const row of currentRows) {
    if (normalizeCurrentStatus(row.currentStatus) !== 'Deployed') continue
    const vehicleNumber = (row.vehicleNumber || '').toString().trim()
    const vehicleKey = vehiclePartitionKey(vehicleNumber)
    if (!vehicleKey) continue

    const at = parseEventInstant(row.lastStatusDate)
    // Never invent "today" — that makes historical IoT days look Not deployed.
    if (!at || Number.isNaN(at.getTime())) continue
    const day = startOfDay(at)
    const mappedRow = {
      vehicleNumber,
      clientId: row.clientRiderId || row.clientId || '',
      clientRiderId: row.clientRiderId || '',
      ev91RiderId: row.ev91RiderId || '',
      riderName: row.riderName || '',
      riderContact: row.riderContact || '',
      clientName: row.clientName || '',
      cityName: row.city || row.cityName || '',
      city: row.city || '',
      sourceName: row.sourceName || row.source || '',
      source: row.source || row.sourceName || '',
    }
    const event = { date: day, row: mappedRow }

    // If rider already has an open interval covering "today", skip; else add open-ended.
    const idKeys = identityKeysForOverallRow(mappedRow)
    let hasOpen = false
    for (const key of idKeys) {
      const intervals = riderAssignments.get(key) || []
      if (intervals.some((iv) => !iv.to && vehiclePartitionKey(iv.vehicleNumber) === vehicleKey)) {
        hasOpen = true
        break
      }
    }
    if (hasOpen) continue

    for (const key of idKeys) {
      pushRiderInterval(riderAssignments, key, event, null)
    }
    pushVehicleInterval(vehicleIntervals, vehicleKey, event, null)
  }

  return { riderAssignments, vehicleIntervals }
}

/**
 * Open deploy (to=null): matches any asOf >= from.
 * Closed deploy (returned): matches from <= asOf < to
 *   (return day = handed back, not EV for that closed interval).
 */
function findIntervalOnDate(intervals, asOfDate) {
  if (!intervals?.length || !asOfDate) return null
  const asOf = startOfDay(asOfDate).getTime()
  let best = null
  for (const interval of intervals) {
    const from = startOfDay(interval.from).getTime()
    if (from > asOf) continue
    if (interval.to) {
      const to = startOfDay(interval.to).getTime()
      if (asOf >= to) continue
    }
    if (!best || interval.from > best.from) best = interval
  }
  return best
}

export function findEv91RiderVehicleOnDate(riderAssignments, identityKeys, asOfDate) {
  if (!riderAssignments || !asOfDate) return null
  let best = null
  for (const key of identityKeys) {
    const hit = findIntervalOnDate(riderAssignments.get(key), asOfDate)
    if (hit && (!best || hit.from > best.from)) best = hit
  }
  return best
}

export function findEv91RiderForVehicleOnDate(vehicleIntervals, vehicleKey, asOfDate) {
  if (!vehicleIntervals || !vehicleKey) return null
  return findIntervalOnDate(vehicleIntervals.get(vehicleKey), asOfDate)
}

/** Load all Overall Status rows from EV91 API. */
export async function fetchEv91OverallStatusAll({ force = false } = {}) {
  if (force) clearEv91AllCache('overall-status')
  return fetchAllEv91MisData('overall-status')
}

/** Load all Current Status rows (for open-deploy safety net). */
export async function fetchEv91CurrentStatusAll({ force = false } = {}) {
  if (force) clearEv91AllCache('current-status')
  return fetchAllEv91MisData('current-status')
}

/**
 * Context for paste lookup from Overall + Current Vehicle Status.
 * EV = deployed vehicle on that date; otherwise NON-EV.
 */
export function buildEv91EvLookupContext(overallRows, orderRows = [], currentRows = []) {
  const indexes = buildEv91OverallIntervalIndexes(overallRows)
  mergeCurrentStatusIntoIndexes(indexes, currentRows)
  return {
    overallCount: (overallRows || []).length,
    currentCount: (currentRows || []).length,
    riderAssignments: indexes.riderAssignments,
    vehicleIntervals: indexes.vehicleIntervals,
    orderRowCount: (orderRows || []).length,
  }
}

function lookupWorkerRow(row, ctx) {
  const identityKeys = lookupIdentityKeys(row.workerCode)
  const interval = findEv91RiderVehicleOnDate(ctx.riderAssignments, identityKeys, row.date)

  if (interval?.vehicleNumber) {
    return {
      ...row,
      evType: 'EV',
      vehicleNumber: interval.vehicleNumber,
      ev91RiderId: interval.ev91RiderId || '',
      clientId: interval.clientId || '',
      riderName: interval.riderName || '',
      matchedDateKey: formatDateKey(interval.deployDate),
      status: 'overall',
    }
  }

  return {
    ...row,
    evType: 'NON-EV',
    vehicleNumber: '',
    ev91RiderId: '',
    clientId: '',
    riderName: '',
    matchedDateKey: null,
    status: 'not found',
  }
}

export function lookupEv91RiderEvTypesWithContext(pasteText, ctx) {
  if (!ctx) return []
  return parseDateWorkerPaste(pasteText).map((row) => lookupWorkerRow(row, ctx))
}

export function lookupEv91RiderByVehicleWithContext(pasteText, ctx) {
  if (!ctx) return []
  return parseDateVehiclePaste(pasteText).map((row) => {
    const match = findEv91RiderForVehicleOnDate(ctx.vehicleIntervals, row.vehicleKey, row.date)
    if (match) {
      return {
        ...row,
        workerCode: (match.clientId || match.ev91RiderId || '').toString().trim(),
        clientId: match.clientId || '',
        ev91RiderId: match.ev91RiderId || '',
        riderName: match.riderName || '',
        mobile: match.mobile || '',
        clientName: match.clientName || '',
        city: match.city || '',
        deployDateKey: formatDateKey(match.deployDate),
        status: 'deployed',
      }
    }
    return {
      ...row,
      workerCode: '',
      clientId: '',
      ev91RiderId: '',
      riderName: '',
      mobile: '',
      clientName: '',
      city: '',
      deployDateKey: '',
      status: 'not found',
    }
  })
}

export function ev91EvLookupToCsv(results) {
  const escapeCsv = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`
  const headers = ['Date', 'WorkerCode', 'Vehicle Number', 'EV91 ID', 'Client ID', 'Type', 'Source', 'Match status']
  const lines = [headers.map(escapeCsv).join(',')]
  for (const row of results) {
    const matchStatus =
      row.status === 'overall' ? 'EV91 deploy' : 'Not deployed in EV91 Status'
    lines.push(
      [
        row.dateDisplay,
        row.workerCode,
        row.vehicleNumber || '',
        row.ev91RiderId || '',
        row.clientId || '',
        row.evType,
        row.status === 'overall' ? 'EV91' : '—',
        matchStatus,
      ]
        .map(escapeCsv)
        .join(',')
    )
  }
  return lines.join('\n')
}

export function ev91VehicleRiderLookupToCsv(results) {
  const escapeCsv = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`
  const headers = [
    'Date',
    'Vehicle Number',
    'Client ID',
    'EV91 ID',
    'Rider Name',
    'Mobile',
    'Client',
    'City',
    'Deploy Date',
    'Status',
  ]
  const lines = [headers.map(escapeCsv).join(',')]
  for (const row of results) {
    lines.push(
      [
        row.dateDisplay,
        row.vehicleNumber,
        row.clientId || row.workerCode || '',
        row.ev91RiderId || '',
        row.riderName,
        row.mobile,
        row.clientName || '',
        row.city || '',
        row.deployDateKey || '',
        row.status === 'deployed' ? 'Deployed' : 'Not found',
      ]
        .map(escapeCsv)
        .join(',')
    )
  }
  return lines.join('\n')
}

export function ev91EvLookupTypesOnly(results) {
  return results.map((row) => row.evType).join('\n')
}

export function ev91VehicleRiderLookupIdsOnly(results) {
  return results.map((row) => row.clientId || row.ev91RiderId || row.workerCode || '').join('\n')
}

export { selectOverviewOrderRows }
