import { format, startOfDay, differenceInCalendarDays } from 'date-fns'
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
  if (!s) return ''
  // Must check before includes('deploy') — "Yet not deployed" / "Not deployed" contain "deploy"
  if (
    s.includes('yet') ||
    s.includes('not yet') ||
    (s.includes('not') && s.includes('deploy')) ||
    s.includes('pending')
  ) {
    return 'Not yet to deploy'
  }
  if (s.includes('return')) return 'Returned'
  if (s.includes('deploy') || s.includes('on road') || s.includes('on-road')) return 'Deployed'
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
 * Merge Current Vehicle Status into Overall deploy intervals.
 * - Deployed → keep/add open-ended allotment
 * - Returned / Yet not deployed → close any open allotment for that vehicle
 *   (fixes Overall open Deploy + Current "Yet not deployed" still showing Deployed)
 */
export function mergeCurrentStatusIntoIndexes(indexes, currentRows = []) {
  const { riderAssignments, vehicleIntervals } = indexes
  if (!currentRows?.length) return indexes

  const closeOpenVehicleIntervals = (vehicleKey, endDay) => {
    const endMs = startOfDay(endDay).getTime()
    const list = vehicleIntervals.get(vehicleKey) || []
    for (const iv of list) {
      if (iv.to) continue
      const fromMs = startOfDay(iv.from).getTime()
      // Never set to < from (corrupt lastStatusDate would wipe all historical days)
      iv.to = endMs >= fromMs ? startOfDay(endDay) : startOfDay(new Date())
    }
    for (const intervals of riderAssignments.values()) {
      for (const iv of intervals) {
        if (iv.to || vehiclePartitionKey(iv.vehicleNumber) !== vehicleKey) continue
        const fromMs = startOfDay(iv.from).getTime()
        iv.to = endMs >= fromMs ? startOfDay(endDay) : startOfDay(new Date())
      }
    }
  }

  for (const row of currentRows) {
    const status = normalizeCurrentStatus(row.currentStatus)
    if (!status) continue

    const vehicleNumber = (row.vehicleNumber || '').toString().trim()
    const vehicleKey = vehiclePartitionKey(vehicleNumber)
    if (!vehicleKey) continue

    const at = parseEventInstant(row.lastStatusDate)
    const day = at && !Number.isNaN(at.getTime()) ? startOfDay(at) : startOfDay(new Date())

    if (status === 'Returned' || status === 'Not yet to deploy') {
      closeOpenVehicleIntervals(vehicleKey, day)
      continue
    }

    if (status !== 'Deployed') continue

    // Never invent "today" for lastStatusDate when adding open deploy
    if (!at || Number.isNaN(at.getTime())) continue

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

    // If rider already has an open interval covering this vehicle, skip; else add open-ended.
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

/**
 * Latest Overall Status event per rider identity (EV91 ID / client ID / phone).
 * Used so a later Return clears "currently Deployed" even if Current/fleet still look open.
 */
export function buildEv91LatestOverallStatusByIdentity(overallRows = []) {
  const events = []
  for (const row of overallRows || []) {
    const status = normalizeEv91OverallStatus(row.vehicleStatus)
    if (!status) continue
    const at = parseEventInstant(row.statusDate)
    if (!at || Number.isNaN(at.getTime())) continue
    const keys = identityKeysForOverallRow(row)
    if (!keys.size) continue
    events.push({
      status,
      at,
      vehicleNumber: (row.vehicleNumber || '').toString().trim(),
      riderName: (row.riderName || '').toString().trim(),
      mobile: (row.riderContact || '').toString().trim(),
      client: (row.clientName || '').toString().trim(),
      city: (row.cityName || row.city || '').toString().trim(),
      source: (row.sourceName || row.source || '').toString().trim(),
      ev91RiderId: (row.ev91RiderId || '').toString().trim(),
      clientId: (row.clientId || row.clientRiderId || '').toString().trim(),
      keys: [...keys],
    })
  }

  events.sort(sortEv91Events)

  const byKey = new Map()
  for (const event of events) {
    for (const key of event.keys) {
      byKey.set(key, event)
    }
  }
  return byKey
}

/** Resolve latest Overall Status for a rider using worker / EV91 / phone identities. */
export function lookupEv91LatestOverallStatus(byKey, { workerCode = '', ev91PublicId = '', mobile = '' } = {}) {
  if (!byKey?.size) return null

  const keys = new Set()
  const probe = {
    clientId: (workerCode || '').toString().trim(),
    clientRiderId: (workerCode || '').toString().trim(),
    ev91RiderId: (ev91PublicId || workerCode || '').toString().trim(),
    riderContact: mobile,
  }
  for (const key of identityKeysForOverallRow(probe)) keys.add(key)
  if (ev91PublicId && ev91PublicId !== workerCode) {
    for (const key of identityKeysForOverallRow({
      ev91RiderId: ev91PublicId,
      riderContact: mobile,
    })) {
      keys.add(key)
    }
  }

  let best = null
  for (const key of keys) {
    const hit = byKey.get(key)
    if (!hit) continue
    if (!best || hit.at > best.at || (hit.at.getTime() === best.at.getTime() && hit.status === 'Returned')) {
      best = hit
    }
  }
  return best
}

/**
 * Latest Current Status label per identity (Deployed / Returned / Not yet to deploy).
 */
export function buildEv91CurrentStatusByIdentity(currentRows = []) {
  const byKey = new Map()
  for (const row of currentRows || []) {
    const status = normalizeCurrentStatus(row.currentStatus)
    if (!status) continue
    const at = parseEventInstant(row.lastStatusDate) || new Date(0)
    const mapped = {
      clientId: row.clientRiderId || row.clientId || '',
      clientRiderId: row.clientRiderId || '',
      ev91RiderId: row.ev91RiderId || '',
      riderContact: row.riderContact || '',
      vehicleNumber: (row.vehicleNumber || '').toString().trim(),
    }
    const event = {
      status,
      at,
      vehicleNumber: mapped.vehicleNumber,
      riderName: (row.riderName || '').toString().trim(),
      mobile: (row.riderContact || '').toString().trim(),
      client: (row.clientName || '').toString().trim(),
      city: (row.city || '').toString().trim(),
      source: (row.source || row.sourceName || '').toString().trim(),
      allotmentDays: Number(row.aging),
      deployDate: at && !Number.isNaN(at.getTime()) ? startOfDay(at) : null,
    }
    for (const key of identityKeysForOverallRow(mapped)) {
      const prev = byKey.get(key)
      if (!prev || at >= prev.at) byKey.set(key, event)
    }
  }
  return byKey
}

export function lookupEv91CurrentStatusLabel(byKey, identity) {
  return lookupEv91LatestOverallStatus(byKey, identity)
}

function canonicalEv91RiderGroupKey(row) {
  const ev91 = (row.ev91RiderId || '').toString().trim()
  if (ev91) return `ev91:${ev91.toUpperCase().replace(/[_\s-]+/g, '-')}`
  const client = (row.clientId || row.clientRiderId || '').toString().trim()
  if (client) return `client:${client.toUpperCase().replace(/[_\s-]+/g, '-')}`
  const phone = normalizePhone(row.riderContact)
  if (phone.length === 10) return `phone:${phone}`
  return ''
}

function readAgingDays(row) {
  const raw = Number(row?.aging ?? row?.Aging)
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null
}

/**
 * Build vehicle cycles for one rider from their Overall Status events.
 * Client-Swap keeps the same allotment open (updates client); only Return closes it.
 * A Client-Swap with no prior Deploy starts the allotment (common in EV91 data).
 */
function buildEv91CyclesForRiderEvents(events, asOfDate) {
  const asOf = startOfDay(asOfDate)
  const byVehicle = new Map()

  for (const event of events || []) {
    const vehicleNumber = (event.row.vehicleNumber || '').toString().trim()
    const vehicleKey = vehiclePartitionKey(vehicleNumber)
    if (!vehicleKey) continue
    if (!byVehicle.has(vehicleKey)) byVehicle.set(vehicleKey, [])
    byVehicle.get(vehicleKey).push(event)
  }

  const cycles = []

  for (const vehicleEvents of byVehicle.values()) {
    vehicleEvents.sort(sortEv91Events)
    let open = null

    const closeOpen = (endEvent) => {
      if (!open) return
      const returnDate = endEvent ? endEvent.date : null
      const endForDays = returnDate || asOf
      const endStatus = endEvent
        ? normalizeEv91OverallStatus(endEvent.row?.vehicleStatus)
        : ''
      const aging =
        endStatus === 'Returned'
          ? readAgingDays(endEvent.row)
          : !returnDate
            ? readAgingDays(open.last.row)
            : null
      const daysOnRoad =
        aging != null ? aging : Math.max(0, differenceInCalendarDays(endForDays, open.from))

      const startClient = (open.start.row.clientName || '').toString().trim()
      const endClient = (open.last.row.clientName || '').toString().trim()
      const swapBits = open.swaps
        .map((s) => {
          const name = (s.row.clientName || '').toString().trim()
          return name ? `${format(s.date, 'dd/MM/yyyy')} ${name}` : ''
        })
        .filter(Boolean)
      const uniqueSwaps = [...new Set(swapBits)]
      let clientSwapSummary = ''
      if (uniqueSwaps.length || (startClient && endClient && startClient !== endClient)) {
        clientSwapSummary =
          uniqueSwaps.length > 0
            ? `Client-Swap: ${uniqueSwaps.join(' · ')}`
            : `Client-Swap: ${startClient} → ${endClient}`
      }

      cycles.push({
        vehicleNumber: open.vehicleNumber,
        deployeeDate: open.from,
        returnDate,
        daysOnRoad,
        status: returnDate ? 'Returned' : 'Deployed',
        cityName: (open.last.row.cityName || open.last.row.city || '').toString().trim(),
        clientName: endClient || startClient,
        startClientName: startClient,
        sourceName: (open.last.row.sourceName || open.last.row.source || '').toString().trim(),
        clientSwapSummary,
        periodOrders: 0,
        fromEv91Overall: true,
      })
      open = null
    }

    for (const event of vehicleEvents) {
      const vehicleNumber = (event.row.vehicleNumber || '').toString().trim()
      if (event.status === 'Deployed') {
        if (open) closeOpen({ date: event.date, row: event.row })
        open = {
          from: event.date,
          vehicleNumber,
          start: event,
          last: event,
          swaps: [],
        }
      } else if (event.status === 'Client-Swap') {
        if (!open) {
          open = {
            from: event.date,
            vehicleNumber,
            start: event,
            last: event,
            swaps: [event],
          }
        } else {
          open.swaps.push(event)
          open.last = event
        }
      } else if (event.status === 'Returned') {
        if (open) closeOpen(event)
      }
    }
    if (open) closeOpen(null)
  }

  return cycles.sort((a, b) => (b.deployeeDate?.getTime() || 0) - (a.deployeeDate?.getTime() || 0))
}

/**
 * Index Rider & Vehicle Insight assignment history from EV91 Overall Status.
 * Keys: EV91 ID / client ID / phone (same as overall identity keys).
 */
export function buildEv91InsightAssignmentIndex(overallRows = [], asOfDate = new Date()) {
  const groups = new Map()

  for (const row of overallRows || []) {
    const status = normalizeEv91OverallStatus(row.vehicleStatus)
    if (!status) continue
    const at = parseEventInstant(row.statusDate)
    if (!at || Number.isNaN(at.getTime())) continue
    const groupKey = canonicalEv91RiderGroupKey(row)
    if (!groupKey) continue
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push({
      status,
      at,
      date: startOfDay(at),
      row,
    })
  }

  const byKey = new Map()

  for (const events of groups.values()) {
    const assignments = buildEv91CyclesForRiderEvents(events, asOfDate)
    if (!assignments.length) continue

    const keys = new Set()
    for (const event of events) {
      for (const key of identityKeysForOverallRow(event.row)) keys.add(key)
    }
    for (const key of keys) {
      const prev = byKey.get(key)
      if (!prev || assignments.length >= prev.length) byKey.set(key, assignments)
    }
  }

  return byKey
}

/** Lookup Overall-based assignment history for a rider identity. */
export function lookupEv91InsightAssignments(index, { workerCode = '', ev91PublicId = '', mobile = '' } = {}) {
  if (!index?.size) return []

  const keys = new Set()
  for (const key of identityKeysForOverallRow({
    clientId: (workerCode || '').toString().trim(),
    clientRiderId: (workerCode || '').toString().trim(),
    ev91RiderId: (ev91PublicId || workerCode || '').toString().trim(),
    riderContact: mobile,
  })) {
    keys.add(key)
  }
  if (ev91PublicId && ev91PublicId !== workerCode) {
    for (const key of identityKeysForOverallRow({
      ev91RiderId: ev91PublicId,
      riderContact: mobile,
    })) {
      keys.add(key)
    }
  }

  let best = []
  for (const key of keys) {
    const hit = index.get(key)
    if (hit?.length && hit.length > best.length) best = hit
  }
  return best
}

function assignmentRangeMs(asgn) {
  const from = asgn?.deployeeDate instanceof Date ? asgn.deployeeDate.getTime() : 0
  const to =
    asgn?.returnDate instanceof Date
      ? asgn.returnDate.getTime()
      : asgn?.status === 'Deployed'
        ? Date.now()
        : from
  return { from, to: Math.max(to, from) }
}

function assignmentOverlapDays(a, b) {
  const ra = assignmentRangeMs(a)
  const rb = assignmentRangeMs(b)
  const start = Math.max(ra.from, rb.from)
  const end = Math.min(ra.to, rb.to)
  if (end < start) return 0
  return Math.max(1, Math.round((end - start) / 86400000))
}

function minDate(a, b) {
  if (!a) return b || null
  if (!b) return a
  return a.getTime() <= b.getTime() ? a : b
}

function maxDate(a, b) {
  if (!a) return b || null
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}

/**
 * Merge Fleet assignment history with EV91 Overall cycles.
 * - Keeps Fleet periods/days (so on-road totals are not undercounted)
 * - Adds EV91-only cycles (e.g. Client-Swap → Return missing in Fleet)
 * - On same vehicle + overlapping dates: enrich client/swap from EV91, keep stronger day count
 */
export function mergeFleetAndEv91InsightAssignments(fleetAssignments = [], ev91Assignments = []) {
  const fleet = (fleetAssignments || []).filter(Boolean)
  const ev91 = (ev91Assignments || []).filter(Boolean)
  if (!ev91.length) {
    return fleet.map((a) => ({ ...a, dataSource: a.dataSource || 'Fleet' }))
  }
  if (!fleet.length) {
    return ev91.map((a) => ({ ...a, dataSource: a.dataSource || 'EV91' }))
  }

  const usedFleet = new Set()
  const merged = []

  for (const ev of ev91) {
    const evKey = vehiclePartitionKey(ev.vehicleNumber)
    let bestFi = -1
    let bestOverlap = 0
    for (let fi = 0; fi < fleet.length; fi++) {
      if (usedFleet.has(fi)) continue
      const fl = fleet[fi]
      if (vehiclePartitionKey(fl.vehicleNumber) !== evKey) continue
      const overlap = assignmentOverlapDays(fl, ev)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestFi = fi
      }
    }

    if (bestFi >= 0 && bestOverlap > 0) {
      usedFleet.add(bestFi)
      const fl = fleet[bestFi]
      const deployeeDate = minDate(fl.deployeeDate, ev.deployeeDate)
      const returnDate =
        fl.returnDate && ev.returnDate
          ? maxDate(fl.returnDate, ev.returnDate)
          : fl.returnDate || ev.returnDate || null
      const status = returnDate ? 'Returned' : 'Deployed'
      const fleetDays = Number(fl.daysOnRoad)
      const evDays = Number(ev.daysOnRoad)
      const recalc =
        deployeeDate != null
          ? Math.max(
              0,
              differenceInCalendarDays(returnDate || startOfDay(new Date()), deployeeDate)
            )
          : 0
      // Prefer the larger of Fleet / EV91 / recalculated span so neither source undercounts.
      const daysOnRoad = Math.max(
        Number.isFinite(fleetDays) && fleetDays > 0 ? fleetDays : 0,
        Number.isFinite(evDays) && evDays > 0 ? evDays : 0,
        recalc
      )
      merged.push({
        ...fl,
        ...ev,
        vehicleNumber: fl.vehicleNumber || ev.vehicleNumber,
        deployeeDate,
        returnDate,
        status,
        daysOnRoad,
        cityName: fl.cityName || ev.cityName || '',
        clientName: ev.clientName || fl.clientName || '',
        startClientName: ev.startClientName || fl.clientName || '',
        sourceName: fl.sourceName || ev.sourceName || '',
        clientSwapSummary: ev.clientSwapSummary || fl.clientSwapSummary || '',
        periodOrders: Number(fl.periodOrders) || Number(ev.periodOrders) || 0,
        fromEv91Overall: true,
        fromFleet: true,
        dataSource: 'Fleet+EV91',
      })
    } else {
      merged.push({
        ...ev,
        dataSource: 'EV91',
        fromEv91Overall: true,
      })
    }
  }

  for (let fi = 0; fi < fleet.length; fi++) {
    if (usedFleet.has(fi)) continue
    merged.push({
      ...fleet[fi],
      dataSource: fleet[fi].dataSource || 'Fleet',
      fromFleet: true,
    })
  }

  return merged.sort(
    (a, b) => (b.deployeeDate?.getTime?.() || 0) - (a.deployeeDate?.getTime?.() || 0)
  )
}

export { selectOverviewOrderRows }
