import { addDays, format, startOfDay } from 'date-fns'
import { clientLookupKey, splitSummaryClients } from './clientSummaryClients'
import {
  dedupeCanonicalCities,
  normalizeCityKey,
  normalizeSummaryCity,
  riderCityMatchesFilter,
} from './citySummaryAliases'
import { parseFleetDate } from './fleetDeployReturnExport'
import { SUMMARY_METRICS } from './fleetMasterSheet'
import { normalizeTargetEvType, weekKeyToDateRange } from './fleetClientTargets'
import { rowDateKey } from './ev91MisApi'

export { SUMMARY_METRICS, splitSummaryClients }

/**
 * Ops week for EV91 summary: Sunday–Saturday covering the ISO week key.
 * ISO 31_2026 = Mon 27 Jul–Sun 2 Aug → ops = Sun 26 Jul–Sat 1 Aug
 * (matches new-IC sheets that include Sunday 26/07 in "week 31").
 */
export function weekKeyToEv91SummaryDateRange(weekKey) {
  const iso = weekKeyToDateRange(weekKey)
  if (!iso) return null
  const start = addDays(iso.start, -1)
  const end = addDays(iso.end, -1)
  return {
    start,
    end,
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(end, 'yyyy-MM-dd'),
    label: `${format(start, 'dd/MM/yyyy')} – ${format(end, 'dd/MM/yyyy')}`,
  }
}

/**
 * EV91 API client name aliases → canonical Client Summary name.
 * Keys via clientLookupKey (lowercase, collapsed spaces).
 */
const EV91_CLIENT_CANONICAL_BY_KEY = {
  amazon: 'Amazon',
  'amazon-lma': 'Amazon',
  'amazon lma': 'Amazon',

  'b.b now': 'BB',
  'b.b. now': 'BB',
  bb: 'BB',
  'bb now': 'BB',
  bbnow: 'BB',
  'bb-now': 'BB',
  bigbasket: 'BB',
  'big basket': 'BB',
  'bigbasket now': 'BB',

  binkit: 'Blinkit',
  'blink it': 'Blinkit',
  blinkit: 'Blinkit',

  'doc pharma': 'DOCPHARMA',
  docpharma: 'DOCPHARMA',

  fk: 'FKM-LMA',
  'fk-lma': 'FKM-LMA',
  'fk lma': 'FKM-LMA',
  'fkm-lma': 'FKM-LMA',
  'fkm lma': 'FKM-LMA',
  flipkark: 'FKM-LMA',
  flipkart: 'FKM-LMA',
  'flipkart lma': 'FKM-LMA',
  'flipkart-lma': 'FKM-LMA',

  'flipkart minutes': 'Flipkart Minutes',
  'flipkart-minutes': 'Flipkart Minutes',

  imo: 'INAMO',
  inamo: 'INAMO',

  instamart: 'Instamart',
  swiggy: 'Instamart',
  'swiggy insta': 'Instamart',
  'swiggy insta mart': 'Instamart',
  'swiggy instamart': 'Instamart',

  'rathnadeep super market': 'RD',
  'ratnadeep super market': 'RD',
  rd: 'RD',

  'slick club': 'Slick',
  slick: 'Slick',

  'tata 1mg': 'TATA 1MG',
  'tata1mg': 'TATA 1MG',

  zepto: 'Zepto',

  kwik: 'Kwik',
  kuik: 'Kwik',
}

const CLIENT_NAME_NOT_FOUND_KEY = 'client name not found'

export function normalizeEv91SummaryClient(value) {
  const trimmed = (value ?? '').toString().trim()
  if (!trimmed || trimmed === '-') return 'Unknown'
  const key = clientLookupKey(trimmed)
  if (key === CLIENT_NAME_NOT_FOUND_KEY) return 'CLIENT NAME NOT FOUND'
  const canonical = EV91_CLIENT_CANONICAL_BY_KEY[key]
  return canonical || trimmed
}

function isClientNameNotFound(name) {
  return clientLookupKey(name) === CLIENT_NAME_NOT_FOUND_KEY
}

/** Deployed desc, but always keep CLIENT NAME NOT FOUND as the last column. */
export function compareEv91SummaryClients(a, b) {
  const aMissing = isClientNameNotFound(a.client)
  const bMissing = isClientNameNotFound(b.client)
  if (aMissing !== bMissing) return aMissing ? 1 : -1
  const d = (b.totalDeployed || 0) - (a.totalDeployed || 0)
  if (d !== 0) return d
  return String(a.client || '').localeCompare(String(b.client || ''))
}

function normalizeEv91EventStatus(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('deploy')) return 'deployed'
  if (s.includes('return')) return 'returned'
  return ''
}

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function normalizeWorkerCodeKey(value) {
  let worker = String(value ?? '').trim()
  if (!worker) return ''
  if (/^\d+\.0+$/.test(worker)) worker = worker.split('.')[0]
  return worker
}

/** Strict NON-EV type1 — matches Order History / raw Excel Type1 = NON-EV. */
function isStrictNonEvType(type1) {
  const t = String(type1 || '')
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
  if (t === 'NON-EV' || t === 'NONEV' || t === 'IC') return true
  if (t.includes('NON') && t.includes('EV')) return true
  return false
}

/** Strict EV type1 — first-order Ev Deployed from order_upload (same idea as IC). */
function isStrictEvType(type1) {
  if (isStrictNonEvType(type1)) return false
  const t = String(type1 || '')
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
  if (!t) return false
  if (t === 'EV' || t === 'E-V') return true
  if (t.includes('EV') && !t.includes('NON')) return true
  return false
}

function parseOrderDateKey(value) {
  const date = parseFleetDate(value) || (value ? startOfDay(new Date(value)) : null)
  if (!date || Number.isNaN(date.getTime())) return ''
  return format(startOfDay(date), 'yyyy-MM-dd')
}

export function getCitiesFromEv91Rows(overallRows = []) {
  return dedupeCanonicalCities(
    (overallRows || []).map((row) => normalizeSummaryCity(row.cityName || row.city))
  )
}

/**
 * Precompute each rider's first order-upload day (global).
 * EV91 IC uses order_upload_data only — never rider_metrics (no FL on uploads;
 * "new IC" = first upload ever, Type1 NON-EV, date in selected week).
 */
export function buildFirstOrderIndex(orderRows = []) {
  const firstGlobal = new Map()

  for (const r of orderRows || []) {
    // Strict: order uploads only (ignore rider_metrics / _ic_only mirrors)
    if (r?._ic_only) continue
    if (r?._data_source && r._data_source !== 'order_upload') continue

    const dateKey = parseOrderDateKey(r.date_record)
    if (!dateKey) continue

    const worker = normalizeWorkerCodeKey(r.worker_code)
    const phone = normalizePhone(r.mob_number)
    if (!worker && !phone) continue

    const riderKey = worker || `phone:${phone}`
    const existing = firstGlobal.get(riderKey)
    if (!existing || dateKey < existing.dateKey) {
      const delivered = parseInt(r.delivered, 10) || 0
      firstGlobal.set(riderKey, {
        dateKey,
        riderKey,
        worker: worker || phone,
        phone,
        fl: String(r.fl ?? '').trim() || '—',
        type1: (r.type1 || '').toString().trim(),
        clientRaw: (r.client || '').toString().trim(),
        client: normalizeEv91SummaryClient(r.client),
        cityRaw: (r.city || '').toString().trim(),
        city: normalizeSummaryCity(r.city) || (r.city || '').toString().trim() || 'Unknown',
        delivered,
        source: 'order_upload',
        row: r,
      })
    }
  }

  return firstGlobal
}

/**
 * First-order deployed riders from order_upload in the filter range.
 * @param {'EV'|'IC'} kind — EV = Type1 EV, IC = Type1 NON-EV
 */
function buildOrderFirstDeployByClient(
  orderRowsOrIndex = [],
  { city = 'All', startDate = '', endDate = '', kind = 'IC' } = {}
) {
  const filterCity = city && city !== 'All' ? city : null
  const firstGlobal =
    orderRowsOrIndex instanceof Map ? orderRowsOrIndex : buildFirstOrderIndex(orderRowsOrIndex)
  const typeOk = kind === 'EV' ? isStrictEvType : isStrictNonEvType

  const byClient = new Map()
  const detailRows = []

  for (const info of firstGlobal.values()) {
    if (startDate && info.dateKey < startDate) continue
    if (endDate && info.dateKey > endDate) continue
    if (!typeOk(info.type1)) continue
    if (filterCity && !riderCityMatchesFilter(filterCity, info.row)) continue

    const client = info.client
    if (!byClient.has(client)) byClient.set(client, new Set())
    byClient.get(client).add(info.riderKey)

    detailRows.push({
      kind,
      date: info.dateKey,
      city: info.city,
      client,
      clientRaw: info.clientRaw,
      workerCode: info.worker,
      delivered: info.delivered,
      fl: info.fl || '—',
      type1: info.type1,
      source: info.source || 'order_upload',
    })
  }

  detailRows.sort((a, b) => {
    const d = String(a.date).localeCompare(String(b.date))
    if (d !== 0) return d
    const c = String(a.client).localeCompare(String(b.client))
    if (c !== 0) return c
    return String(a.workerCode).localeCompare(String(b.workerCode))
  })

  const counts = new Map()
  for (const [client, set] of byClient) {
    counts.set(client, set.size)
  }
  return { counts, rows: detailRows }
}

/**
 * IC Deployed from first order-upload day (NON-EV only) in the filter range.
 */
export function buildIcDeployedByClient(
  orderRowsOrIndex = [],
  { city = 'All', startDate = '', endDate = '' } = {}
) {
  return buildOrderFirstDeployByClient(orderRowsOrIndex, {
    city,
    startDate,
    endDate,
    kind: 'IC',
  })
}

/**
 * Ev Deployed from first order-upload day (EV only) — same logic as IC Deployed.
 */
export function buildEvDeployedByClient(
  orderRowsOrIndex = [],
  { city = 'All', startDate = '', endDate = '' } = {}
) {
  return buildOrderFirstDeployByClient(orderRowsOrIndex, {
    city,
    startDate,
    endDate,
    kind: 'EV',
  })
}

/**
 * Raw EV / Return / IC rows behind the summary (same filters + logic).
 * Prefer passing a precomputed firstOrderIndex for speed.
 */
export function buildEv91SummaryRawDetails(
  overallRows = [],
  riderDataOrIndex = [],
  { city = 'All', startDate = '', endDate = '', evDeployedSource = 'overall' } = {}
) {
  const summary = buildEv91ClientWiseSummary(overallRows, riderDataOrIndex, {
    city,
    startDate,
    endDate,
    includeDetails: true,
    evDeployedSource,
  })
  return summary.details || { evRows: [], returnRows: [], icRows: [] }
}

/**
 * Client-wise summary from EV91 Overall Status + new NON-EV IC from orders.
 *
 * Ev Deployed  =
 *   - overall (default): every Overall Status Deployed row in range
 *   - order: brand-new EV riders (first order-done ever in range), same as IC logic
 * IC Deployed  = brand-new NON-EV riders (first order-done ever in range)
 * Return       = every Overall Status Returned row in range
 * Net add on   = Total Deployed − Return
 *
 * @param {'overall'|'order'} options.evDeployedSource
 */
export function buildEv91ClientWiseSummary(
  overallRows = [],
  riderDataOrIndex = [],
  {
    city = 'All',
    startDate = '',
    endDate = '',
    includeDetails = false,
    evDeployedSource = 'overall',
  } = {}
) {
  if (!startDate || !endDate) {
    return {
      clients: [],
      totals: { totalDeployed: 0, evDeployed: 0, icDeployed: 0, returnCount: 0, netAddon: 0 },
      eventCount: 0,
      details: includeDetails ? { evRows: [], returnRows: [], icRows: [] } : undefined,
    }
  }

  const useOrderEv = evDeployedSource === 'order'
  const filterCity = city && city !== 'All' ? city : null
  const filterCityKey = filterCity ? normalizeCityKey(filterCity) : null

  const clientStats = new Map()
  const seenEvents = new Set()
  const evRows = includeDetails ? [] : null
  const returnRows = includeDetails ? [] : null
  let eventCount = 0

  const ensure = (client) => {
    if (!clientStats.has(client)) {
      clientStats.set(client, { returnCount: 0, icDeployed: 0, evDeployed: 0 })
    }
    return clientStats.get(client)
  }

  for (const row of overallRows || []) {
    const status = normalizeEv91EventStatus(row.vehicleStatus)
    if (!status) continue

    const dKey = rowDateKey(row, 'statusDate')
    if (!dKey) continue
    if (startDate && dKey < startDate) continue
    if (endDate && dKey > endDate) continue

    const rowCity = normalizeSummaryCity(row.cityName || row.city) || 'Unknown'
    if (filterCityKey && normalizeCityKey(rowCity) !== filterCityKey) continue

    const vehicle = (row.vehicleNumber || '').toString().trim().toUpperCase() || 'UNKNOWN'
    const riderId =
      (row.clientId || row.clientRiderId || row.ev91RiderId || '').toString().trim() ||
      normalizePhone(row.riderContact) ||
      ''
    const client = normalizeEv91SummaryClient(row.clientName)
    const uniqueKey = `${vehicle}|${row.statusDate || dKey}|${status}|${riderId}|${client}`
    if (seenEvents.has(uniqueKey)) continue
    seenEvents.add(uniqueKey)
    eventCount++

    const stats = ensure(client)
    if (status === 'deployed') {
      // Overall Status Deployed only when not using order-data Ev Deployed
      if (!useOrderEv) {
        stats.evDeployed++
        if (evRows) {
          evRows.push({
            kind: 'EV',
            status: 'Deployed',
            date: dKey,
            city: rowCity,
            client,
            clientRaw: (row.clientName || '').toString().trim(),
            vehicle,
            riderId: (row.clientId || row.clientRiderId || '').toString().trim(),
            ev91RiderId: (row.ev91RiderId || '').toString().trim(),
            riderName: (row.riderName || '').toString().trim(),
            contact: (row.riderContact || '').toString().trim(),
            statusDate: row.statusDate || dKey,
          })
        }
      }
    } else {
      stats.returnCount++
      if (returnRows) {
        returnRows.push({
          kind: 'Return',
          status: 'Returned',
          date: dKey,
          city: rowCity,
          client,
          clientRaw: (row.clientName || '').toString().trim(),
          vehicle,
          riderId: (row.clientId || row.clientRiderId || '').toString().trim(),
          ev91RiderId: (row.ev91RiderId || '').toString().trim(),
          riderName: (row.riderName || '').toString().trim(),
          contact: (row.riderContact || '').toString().trim(),
          statusDate: row.statusDate || dKey,
        })
      }
    }
  }

  let orderEvRows = []
  if (useOrderEv) {
    const { counts: evByClient, rows: orderEv } = buildEvDeployedByClient(riderDataOrIndex, {
      city,
      startDate,
      endDate,
    })
    orderEvRows = orderEv
    for (const [client, count] of evByClient) {
      ensure(client).evDeployed = count
    }
  }

  const { counts: icByClient, rows: icRows } = buildIcDeployedByClient(riderDataOrIndex, {
    city,
    startDate,
    endDate,
  })
  for (const [client, count] of icByClient) {
    ensure(client).icDeployed = count
  }

  const rows = [...clientStats.entries()]
    .map(([client, s]) => {
      const totalDeployed = s.evDeployed + s.icDeployed
      return {
        client,
        totalDeployed,
        evDeployed: s.evDeployed,
        icDeployed: s.icDeployed,
        returnCount: s.returnCount,
        netAddon: totalDeployed - s.returnCount,
      }
    })
    .sort(compareEv91SummaryClients)

  const totals = rows.reduce(
    (acc, r) => ({
      totalDeployed: acc.totalDeployed + r.totalDeployed,
      evDeployed: acc.evDeployed + r.evDeployed,
      icDeployed: acc.icDeployed + r.icDeployed,
      returnCount: acc.returnCount + r.returnCount,
      netAddon: acc.netAddon + r.netAddon,
    }),
    { totalDeployed: 0, evDeployed: 0, icDeployed: 0, returnCount: 0, netAddon: 0 }
  )

  const result = { clients: rows, totals, eventCount, evDeployedSource: useOrderEv ? 'order' : 'overall' }
  if (includeDetails) {
    const sortEv = (a, b) => {
      const d = String(a.date).localeCompare(String(b.date))
      if (d !== 0) return d
      const c = String(a.client).localeCompare(String(b.client))
      if (c !== 0) return c
      return String(a.vehicle || a.workerCode || '').localeCompare(String(b.vehicle || b.workerCode || ''))
    }
    if (useOrderEv) {
      result.details = { evRows: orderEvRows, returnRows: returnRows || [], icRows }
    } else {
      if (evRows) evRows.sort(sortEv)
      if (returnRows) returnRows.sort(sortEv)
      result.details = { evRows: evRows || [], returnRows: returnRows || [], icRows }
    }
  }
  return result
}

/** Target totals with EV91 client aliases so Excel/DB names match summary columns. */
export function buildEv91TargetTotalsByEvType(targetRows, selectedCity = 'All') {
  const ev = new Map()
  const nonEv = new Map()
  const cityKey = selectedCity && selectedCity !== 'All' ? normalizeCityKey(selectedCity) : null

  for (const row of targetRows || []) {
    if (cityKey && normalizeCityKey(row.city) !== cityKey) continue
    const client = normalizeEv91SummaryClient(row.client)
    const type = normalizeTargetEvType(row.type)
    if (!type) continue

    const bucket = type === 'EV' ? ev : nonEv
    bucket.set(client, (bucket.get(client) || 0) + (Number(row.target) || 0))
  }

  return { ev, nonEv }
}

/** Merge targets then keep clients sorted by Total Deployed (large → small). */
export function mergeEv91SummaryWithTargets(summary, targetMaps) {
  const evMap = targetMaps?.ev || new Map()
  const nonEvMap = targetMaps?.nonEv || new Map()
  const clientMap = new Map()

  for (const row of summary.clients || []) {
    clientMap.set(row.client, {
      ...row,
      targetEv: evMap.get(row.client) || 0,
      targetNonEv: nonEvMap.get(row.client) || 0,
    })
  }

  for (const [client, targetEv] of evMap) {
    if (!clientMap.has(client)) {
      clientMap.set(client, {
        client,
        totalDeployed: 0,
        evDeployed: 0,
        icDeployed: 0,
        returnCount: 0,
        netAddon: 0,
        targetEv,
        targetNonEv: nonEvMap.get(client) || 0,
      })
    }
  }

  for (const [client, targetNonEv] of nonEvMap) {
    if (!clientMap.has(client)) {
      clientMap.set(client, {
        client,
        totalDeployed: 0,
        evDeployed: 0,
        icDeployed: 0,
        returnCount: 0,
        netAddon: 0,
        targetEv: evMap.get(client) || 0,
        targetNonEv,
      })
    }
  }

  const clients = [...clientMap.values()].sort(compareEv91SummaryClients)

  const totals = {
    ...summary.totals,
    targetEv: clients.reduce((sum, row) => sum + (row.targetEv || 0), 0),
    targetNonEv: clients.reduce((sum, row) => sum + (row.targetNonEv || 0), 0),
  }

  return { clients, totals, eventCount: summary.eventCount || 0 }
}
