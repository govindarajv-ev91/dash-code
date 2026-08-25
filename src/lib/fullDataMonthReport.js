import {
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns'
import { normalizeSummaryCity } from './citySummaryAliases'
import { clientLookupKey, normalizeSummaryClient } from './clientSummaryClients'
import { toMetricDateKey } from './mergeRiderMetrics'
import { rowDateKey } from './ev91MisApi'
import { vehiclePartitionKey } from './fleetDeployReturnExport'
import {
  buildEv91OverallIntervalIndexes,
  mergeCurrentStatusIntoIndexes,
  findEv91RiderForVehicleOnDate,
  findEv91RiderVehicleOnDate,
} from './ev91EvLookup'
import { buildVehicleDayKmIndex } from './serviceScheduleReport'
import { KM_PRODUCTIVITY_BUCKETS, kmToBucketKey } from './vehicleKmProductivityReport'
import { parseOrderUploadMonthLabel } from './orderUploadDb'
import { normalizeIotRunDate, iotRowDistanceKm } from './iotDataReport'
import { getZeroOrderAsOfFromEndDate, riderIdLookupKeys } from './riderPerformanceReport'
import { calcOrderEarningAndMf, EV_DAILY_RENT } from './fullDataCommercialRates'
import {
  buildOnboardingSourceLookupIndex,
  lookupOnboardingSource,
  canonicalSourceName,
  sourceNameGroupKey,
} from './onboardingSourceLookup'
import {
  buildEv91PublicRiderIndex,
  lookupEv91PublicRiderId,
} from './ev91OnboardingPending'

const PART_SEP = '\x1f'
/** Keep this much EV91 history before month start (open deploys). */
const OVERALL_HISTORY_DAYS = 180

export const FULL_DATA_METRICS = [
  { key: 'deployCount', label: 'Deployee Count', section: 'Supply' },
  { key: 'returnCount', label: 'Return Count', section: 'Supply' },
  { key: 'riderCount', label: 'Rider Count', section: 'Supply', uniqueMonth: true },
  { key: 'evRiderCount', label: 'EV rider Count', section: 'Supply', uniqueMonth: true },
  { key: 'nonEvRiderCount', label: 'Non-EV rider Count', section: 'Supply', uniqueMonth: true },
  {
    key: 'ordersPerRider',
    label: 'Order per rider',
    section: 'Supply',
    ratio: true,
    hint: 'Orders ÷ riders for BB, Blinkit, Zepto, Porter 2W, Flipkart-LMA, Amazon, Swiggy',
  },
  { key: 'totalOrder', label: 'Total Order', section: 'Supply' },
  { key: 'evOrder', label: 'EV order', section: 'Supply' },
  { key: 'nonEvOrder', label: 'Non-EV Order', section: 'Supply' },
  { key: 'zeroOrderRiderCount', label: '0 order Rider count', section: 'Supply', yesterdayTotal: true },
  {
    key: 'd1ZeroOrderRiderCount',
    label: 'D-1 0 order rider count',
    section: 'Supply',
    yesterdayTotal: true,
    hint: 'BB, Blinkit, Zepto, Porter 2W, Flipkart-LMA, Amazon, Swiggy only',
  },
  { key: 'totalEarning', label: 'Total Earing', section: 'Supply' },
  { key: 'evEarning', label: 'EV Earing', section: 'Supply' },
  { key: 'nonEarning', label: 'Non Earing', section: 'Supply' },
  { key: 'mfAmount', label: 'MF Amount', section: 'Supply' },
  { key: 'rent', label: 'Rent', section: 'Supply' },
  { key: 'totalRevenue', label: 'Total Revnue', section: 'Supply' },
  { key: 'totalKm', label: 'Total KM', section: 'Ev' },
  { key: 'deployKm', label: 'Deployee KM', section: 'Ev' },
  { key: 'returnKm', label: 'Return KM', section: 'Ev' },
  { key: 'kmAbove0Count', label: 'KM > 0 Count', section: 'Ev' },
  { key: 'evDeployKmCount', label: 'Deployee Count (KM>0)', section: 'Ev' },
  { key: 'evReturnKmCount', label: 'Return Count (KM>0)', section: 'Ev' },
  ...KM_PRODUCTIVITY_BUCKETS.map((b) => ({
    key: `bucket_${b.key}`,
    label: b.label,
    section: 'Ev',
    bucketKey: b.key,
  })),
  ...KM_PRODUCTIVITY_BUCKETS.map((b) => ({
    key: `deployBucket_${b.key}`,
    label: `Deployee ${b.label}`,
    section: 'Ev',
    bucketKey: b.key,
  })),
  ...KM_PRODUCTIVITY_BUCKETS.map((b) => ({
    key: `returnBucket_${b.key}`,
    label: `Return ${b.label}`,
    section: 'Ev',
    bucketKey: b.key,
  })),
]

const NUMERIC_KEYS = FULL_DATA_METRICS.filter((m) => !m.hold && !m.ratio).map((m) => m.key)
const MONEY_KEYS = new Set(['totalEarning', 'evEarning', 'nonEarning', 'mfAmount', 'rent', 'totalRevenue'])
const RATIO_KEYS = new Set(FULL_DATA_METRICS.filter((m) => m.ratio).map((m) => m.key))
const YESTERDAY_TOTAL_KEYS = new Set(
  FULL_DATA_METRICS.filter((m) => m.yesterdayTotal).map((m) => m.key)
)
const UNIQUE_MONTH_KEYS = new Set(
  FULL_DATA_METRICS.filter((m) => m.uniqueMonth).map((m) => m.key)
)

function uniqueIdsFromDays(byDate, days, listKey) {
  const ids = new Set()
  for (const d of days || []) {
    const list = byDate?.[d.dateKey]?.[listKey]
    if (!list) continue
    for (const id of list) ids.add(id)
  }
  return ids.size
}

/** Total column = yesterday's count only (not month sum, not today). */
function yesterdayMetricValue(byDate, days, key, asOf = new Date()) {
  const yKey = yesterdayDateKey(asOf)
  const inRange = (days || []).some((d) => d.dateKey === yKey)
  if (inRange) return Number(byDate?.[yKey]?.[key]) || 0
  return 0
}

function calcOrdersPerRider(orders, riders) {
  const r = Number(riders) || 0
  if (r <= 0) return 0
  return Math.ceil(Number(orders) / r)
}

function isEvType(type1) {
  const t = String(type1 || '').toUpperCase()
  return t.includes('EV') && !t.includes('NON')
}

function emptyDayMetrics() {
  const o = {
    deployCount: 0,
    returnCount: 0,
    riderCount: 0,
    evRiderCount: 0,
    nonEvRiderCount: 0,
    totalOrder: 0,
    evOrder: 0,
    nonEvOrder: 0,
    zeroOrderRiderCount: 0,
    d1ZeroOrderRiderCount: 0,
    ordersPerRider: 0,
    totalEarning: 0,
    evEarning: 0,
    nonEarning: 0,
    mfAmount: 0,
    rent: 0,
    totalRevenue: 0,
    totalKm: 0,
    deployKm: 0,
    returnKm: 0,
    kmAbove0Count: 0,
    evDeployKmCount: 0,
    evReturnKmCount: 0,
  }
  for (const b of KM_PRODUCTIVITY_BUCKETS) {
    o[`bucket_${b.key}`] = 0
    o[`deployBucket_${b.key}`] = 0
    o[`returnBucket_${b.key}`] = 0
  }
  return o
}

function partKey(city, client) {
  return `${normalizeSummaryCity(city)}${PART_SEP}${normalizeSummaryClient(client)}`
}

function parsePartKey(key) {
  const i = key.indexOf(PART_SEP)
  if (i < 0) return { city: 'Unknown', client: 'Unknown' }
  return { city: key.slice(0, i), client: key.slice(i + 1) }
}

function matchesPart(key, cityFilter, clientFilter) {
  if ((!cityFilter || cityFilter === 'All') && (!clientFilter || clientFilter === 'All')) return true
  const { city, client } = parsePartKey(key)
  if (cityFilter && cityFilter !== 'All' && city !== cityFilter) return false
  if (clientFilter && clientFilter !== 'All' && client !== clientFilter) return false
  return true
}

function ensureSlice(slices, dateKey, city, client) {
  if (!slices.has(dateKey)) slices.set(dateKey, new Map())
  const dayMap = slices.get(dateKey)
  const key = partKey(city, client)
  if (!dayMap.has(key)) dayMap.set(key, emptyDayMetrics())
  return dayMap.get(key)
}

function bumpBucket(metrics, prefix, km) {
  const key = kmToBucketKey(km)
  metrics[`${prefix}${key}`] = (metrics[`${prefix}${key}`] || 0) + 1
}

function buildIotUploadedDates(iotRows = []) {
  const dates = new Set()
  for (const row of iotRows || []) {
    const d = normalizeIotRunDate(row.run_date)
    if (d) dates.add(d)
  }
  return dates
}

function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => setTimeout(resolve, 0))
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** Drop EV91 rows outside [fromKey-HISTORY, toKey] so index build stays light. */
export function trimOverallRowsForMonth(overallRows = [], fromKey = '', toKey = '') {
  if (!fromKey || !toKey) return overallRows || []
  let histFrom = fromKey
  try {
    histFrom = format(subDays(parseISO(fromKey), OVERALL_HISTORY_DAYS), 'yyyy-MM-dd')
  } catch {
    histFrom = fromKey
  }
  return (overallRows || []).filter((row) => {
    const d = rowDateKey(row, 'statusDate')
    if (!d) return false
    return d >= histFrom && d <= toKey
  })
}

export function monthDaysFromLabel(monthLabel) {
  const parsed = parseOrderUploadMonthLabel(monthLabel)
  if (!parsed) return { days: [], fromKey: '', toKey: '', monthLabel: monthLabel || '' }
  const start = startOfMonth(new Date(parsed.year, parsed.monthIndex, 1))
  const monthEnd = endOfMonth(start)
  // Page includes today (not tomorrow). Share still cuts off at yesterday.
  const today = startOfDay(new Date())
  const end = monthEnd < today ? monthEnd : today
  if (start > end) {
    return {
      days: [],
      fromKey: format(start, 'yyyy-MM-dd'),
      toKey: format(end, 'yyyy-MM-dd'),
      monthLabel: monthLabel || '',
    }
  }
  const days = eachDayOfInterval({ start, end }).map((d) => ({
    dateKey: format(d, 'yyyy-MM-dd'),
    label: format(d, 'dd-MMM'),
  }))
  return {
    days,
    fromKey: format(start, 'yyyy-MM-dd'),
    toKey: format(end, 'yyyy-MM-dd'),
    monthLabel: monthLabel || '',
  }
}

export function collectFullDataFilterOptions(orderRows = [], overallRows = []) {
  const cities = new Set()
  const clients = new Set()
  for (const row of orderRows || []) {
    const city = normalizeSummaryCity(row.city)
    const client = normalizeSummaryClient(row.client)
    if (city && city !== 'Unknown') cities.add(city)
    if (client && client !== 'Unknown') clients.add(client)
  }
  for (const row of overallRows || []) {
    const city = normalizeSummaryCity(row.cityName || row.city)
    const client = normalizeSummaryClient(row.clientName)
    if (city && city !== 'Unknown') cities.add(city)
    if (client && client !== 'Unknown') clients.add(client)
  }
  return {
    cities: [...cities].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    clients: [...clients].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  }
}

/** worker UPPER → dateKey → delivered sum (order_upload only — fast). */
function buildOrderDeliveredIndex(orderRows = []) {
  const byWorker = new Map()
  for (const row of orderRows || []) {
    const worker = (row.worker_code || '').toString().trim().toUpperCase()
    const dateKey = toMetricDateKey(row.date_record)
    if (!worker || !dateKey) continue
    const delivered = Number(row.delivered) || 0
    if (!byWorker.has(worker)) byWorker.set(worker, new Map())
    const dayMap = byWorker.get(worker)
    dayMap.set(dateKey, (dayMap.get(dateKey) || 0) + delivered)
  }
  return byWorker
}

/**
 * D-1 0-order row: only these clients.
 * BB, Blinkit, Zepto, Porter 2W, Flipkart-LMA, Amazon, Swiggy.
 */
function isD1ZeroOrderClient(clientName) {
  const key = clientLookupKey(normalizeSummaryClient(clientName) || clientName)
  if (!key) return false
  if (key === 'bb' || key.startsWith('bb ') || key.includes('bigbasket') || key.includes('big basket')) {
    return true
  }
  if (key.includes('blinkit') || key.includes('blinket') || key.includes('binkit')) return true
  if (key.includes('zepto')) return true
  if (key.includes('porter')) return true
  if (key.includes('flipkart-lma') || key.includes('flipkart lma') || key.includes('fkm-lma') || key.includes('fkm lma')) {
    return true
  }
  if (key === 'amazon' || key.startsWith('amazon')) return true
  if (key.includes('swiggy') || key === 'instamart' || key.includes('instamart')) return true
  return false
}

function workerZeroOrdersInWindow(orderIndex, workerId, endDateKey) {
  if (!workerId) return true
  const endDate = startOfDay(parseISO(endDateKey))
  if (Number.isNaN(endDate.getTime())) return false
  const asOf = getZeroOrderAsOfFromEndDate(endDate)
  const dayMap = orderIndex.get(workerId.toUpperCase())
  for (let n = 1; n <= 4; n++) {
    const dayKey = format(subDays(asOf, n), 'yyyy-MM-dd')
    if ((dayMap?.get(dayKey) || 0) > 0) return false
  }
  return true
}

/** Latest allowed 0-order window end = yesterday (never today/future). */
function maxZeroOrderEndDateKey(asOf = new Date()) {
  return format(subDays(startOfDay(asOf), 1), 'yyyy-MM-dd')
}

/** Dates that have any delivered > 0 in order upload. */
function buildOrderActiveDates(orderIndex) {
  const dates = new Set()
  for (const dayMap of orderIndex.values()) {
    for (const [d, v] of dayMap) {
      if ((v || 0) > 0) dates.add(d)
    }
  }
  return dates
}

/** True if the 4-day 0-order window has any uploaded orders (else skip day). */
function zeroOrderWindowHasOrders(activeDates, endDateKey) {
  const endDate = startOfDay(parseISO(endDateKey))
  if (Number.isNaN(endDate.getTime())) return false
  const asOf = getZeroOrderAsOfFromEndDate(endDate)
  for (let n = 1; n <= 4; n++) {
    if (activeDates.has(format(subDays(asOf, n), 'yyyy-MM-dd'))) return true
  }
  return false
}

function flattenDeployIntervals(vehicleIntervals) {
  const list = []
  for (const [vKey, intervals] of vehicleIntervals || []) {
    for (const iv of intervals || []) {
      if (!iv?.from) continue
      list.push({
        vKey,
        fromKey: format(startOfDay(iv.from), 'yyyy-MM-dd'),
        toKey: iv.to ? format(startOfDay(iv.to), 'yyyy-MM-dd') : null,
        city: iv.city || '',
        client: iv.clientName || '',
        riderId: (iv.clientId || iv.ev91RiderId || iv.riderId || '').toString().trim().toUpperCase(),
        ev91RiderId: (iv.ev91RiderId || '').toString().trim(),
        vehicleNumber: (iv.vehicleNumber || '').toString().trim(),
        sourceName: (iv.sourceName || iv.source || '').toString().trim(),
      })
    }
  }
  return list
}

function emptyBase(monthLabel) {
  return {
    monthLabel,
    fromKey: '',
    toKey: '',
    days: [],
    slices: new Map(),
    iotUploadedDates: [],
    metrics: FULL_DATA_METRICS,
  }
}

/**
 * Async chunked build — yields to the browser so the page stays responsive.
 * Does NOT use full fleet/rider_metrics scans (those froze the tab).
 */
export async function buildFullDataMonthBaseAsync(
  {
    monthLabel = '',
    orderRows = [],
    overallRows = [],
    currentRows = [],
    iotRows = [],
  } = {},
  { shouldCancel = () => false, onProgress = null, onReady = null, skipZeroOrder = true } = {}
) {
  const { days, fromKey, toKey } = monthDaysFromLabel(monthLabel)
  if (!days.length) return emptyBase(monthLabel)

  const report = (step) => {
    if (typeof onProgress === 'function') onProgress(step)
  }

  const slices = new Map()
  const iotUploadedDates = buildIotUploadedDates(iotRows)
  await yieldToMain()
  if (shouldCancel()) return emptyBase(monthLabel)
  report('orders')

  // --- Orders (Supply) ---
  const riderDayParts = new Map()
  for (const row of orderRows || []) {
    const dateKey = toMetricDateKey(row.date_record)
    if (!dateKey || dateKey < fromKey || dateKey > toKey) continue

    const city = row.city
    const client = row.client
    const delivered = Number(row.delivered) || 0
    const isEv = isEvType(row.type1)
    const m = ensureSlice(slices, dateKey, city, client)
    m.totalOrder += delivered
    if (isEv) m.evOrder += delivered
    else m.nonEvOrder += delivered

    if (delivered > 0) {
      const { earning, mf } = calcOrderEarningAndMf(client, city, delivered)
      m.totalEarning += earning
      m.mfAmount += mf
      if (isEv) m.evEarning += earning
      else m.nonEarning += earning
    }

    const worker = (row.worker_code || '').toString().trim()
    if (!worker) continue
    const pKey = partKey(city, client)
    if (!riderDayParts.has(dateKey)) riderDayParts.set(dateKey, new Map())
    const partMap = riderDayParts.get(dateKey)
    if (!partMap.has(pKey)) partMap.set(pKey, new Map())
    const workers = partMap.get(pKey)
    const prev = workers.get(worker) || { delivered: 0, hasEv: false, hasNonEv: false }
    prev.delivered += delivered
    if (isEv) prev.hasEv = true
    else prev.hasNonEv = true
    workers.set(worker, prev)
  }

  for (const [dateKey, partMap] of riderDayParts) {
    for (const [pKey, workers] of partMap) {
      const { city, client } = parsePartKey(pKey)
      const m = ensureSlice(slices, dateKey, city, client)
      let riders = 0
      let evRiders = 0
      let nonEvRiders = 0
      for (const info of workers.values()) {
        if (info.delivered <= 0) continue
        riders += 1
        if (info.hasEv) evRiders += 1
        if (info.hasNonEv) nonEvRiders += 1
      }
      const riderIds = new Set()
      const evRiderIds = new Set()
      const nonEvRiderIds = new Set()
      m.riderCount = riders
      m.evRiderCount = evRiders
      m.nonEvRiderCount = nonEvRiders
      for (const [worker, info] of workers) {
        if (info.delivered <= 0) continue
        const id = String(worker).trim().toUpperCase()
        if (!id) continue
        riderIds.add(id)
        if (info.hasEv) evRiderIds.add(id)
        if (info.hasNonEv) nonEvRiderIds.add(id)
      }
      m._riderIds = riderIds
      m._evRiderIds = evRiderIds
      m._nonEvRiderIds = nonEvRiderIds
    }
  }

  await yieldToMain()
  if (shouldCancel()) return emptyBase(monthLabel)
  report('ev91')

  // --- Trim + index EV91 (bounded history) ---
  const trimmedOverall = trimOverallRowsForMonth(overallRows, fromKey, toKey)
  await yieldToMain()
  if (shouldCancel()) return emptyBase(monthLabel)
  const indexes = buildEv91OverallIntervalIndexes(trimmedOverall)
  await yieldToMain()
  if (shouldCancel()) return emptyBase(monthLabel)
  mergeCurrentStatusIntoIndexes(indexes, currentRows || [])
  const { vehicleIntervals } = indexes
  const flatIntervals = flattenDeployIntervals(vehicleIntervals).filter(
    (iv) => iv.fromKey <= toKey && (iv.toKey == null || iv.toKey > fromKey)
  )

  await yieldToMain()
  if (shouldCancel()) return emptyBase(monthLabel)
  report('deploy')

  // --- Deploy / Return event counts ---
  const deployEventsByDate = new Map()
  const returnEventsByDate = new Map()
  const seenEvent = new Set()

  for (const row of trimmedOverall) {
    const dateKey = rowDateKey(row, 'statusDate')
    if (!dateKey || dateKey < fromKey || dateKey > toKey) continue

    const s = String(row.vehicleStatus || '').toLowerCase()
    let kind = ''
    if (s.includes('deploy')) kind = 'deploy'
    else if (s.includes('return')) kind = 'return'
    else continue

    const vehicleNumber = (row.vehicleNumber || '').toString().trim()
    const vKey = vehiclePartitionKey(vehicleNumber)
    if (!vKey) continue
    const riderId =
      (row.clientId || row.clientRiderId || row.ev91RiderId || '').toString().trim() || ''
    const uniqueKey = `${vKey}|${dateKey}|${kind}|${riderId}`
    if (seenEvent.has(uniqueKey)) continue
    seenEvent.add(uniqueKey)

    const city = row.cityName || row.city
    const client = row.clientName
    const m = ensureSlice(slices, dateKey, city, client)
    if (kind === 'deploy') {
      m.deployCount += 1
      if (!deployEventsByDate.has(dateKey)) deployEventsByDate.set(dateKey, new Map())
      deployEventsByDate.get(dateKey).set(vKey, { city, client })
    } else {
      m.returnCount += 1
      if (!returnEventsByDate.has(dateKey)) returnEventsByDate.set(dateKey, new Map())
      returnEventsByDate.get(dateKey).set(vKey, { city, client })
    }
  }

  await yieldToMain()
  if (shouldCancel()) return emptyBase(monthLabel)
  report('km')

  // --- IoT KM: only uploaded vehicle-days ---
  // Partition: every vehicle-day is either Return (return event that day) OR Deployee (otherwise).
  // So Deployee + Return = Total (KM and KM>0 counts).
  const dayKmIndex = buildVehicleDayKmIndex(iotRows)
  let kmOps = 0
  for (const [vKey, dayMap] of dayKmIndex || []) {
    for (const [dateKey, kmRaw] of dayMap) {
      if (dateKey < fromKey || dateKey > toKey) continue
      if (!iotUploadedDates.has(dateKey)) continue
      const km = Number(kmRaw) || 0

      const returnMeta = returnEventsByDate.get(dateKey)?.get(vKey)
      const dayDate = startOfDay(parseISO(dateKey))
      const hit = returnMeta
        ? null
        : findEv91RiderForVehicleOnDate(vehicleIntervals, vKey, dayDate)

      const city = returnMeta?.city || hit?.city || 'Unknown'
      const client = returnMeta?.client || hit?.clientName || 'Unknown'
      const m = ensureSlice(slices, dateKey, city, client)

      m.totalKm += km
      if (km > 0) {
        m.kmAbove0Count += 1
        bumpBucket(m, 'bucket_', km)
      }

      if (returnMeta) {
        m.returnKm += km
        if (km > 0) {
          m.evReturnKmCount += 1
          bumpBucket(m, 'returnBucket_', km)
        }
      } else {
        m.deployKm += km
        if (km > 0) {
          m.evDeployKmCount += 1
          bumpBucket(m, 'deployBucket_', km)
        }
      }

      kmOps += 1
      if (kmOps % 800 === 0) {
        await yieldToMain()
        if (shouldCancel()) return emptyBase(monthLabel)
      }
    }
  }

  await yieldToMain()
  if (shouldCancel()) return emptyBase(monthLabel)
  report('rent')

  // Rent = on-road (deployed interval covers day) vehicles × ₹230 / day
  for (let di = 0; di < days.length; di++) {
    const dateKey = days[di].dateKey
    const countByPart = new Map()
    const seenVehicle = new Set()
    for (const iv of flatIntervals) {
      if (iv.fromKey > dateKey) continue
      if (iv.toKey != null && iv.toKey <= dateKey) continue
      if (!iv.vKey || seenVehicle.has(iv.vKey)) continue
      seenVehicle.add(iv.vKey)
      const pKey = partKey(iv.city, iv.client)
      countByPart.set(pKey, (countByPart.get(pKey) || 0) + 1)
    }
    for (const [pKey, count] of countByPart) {
      const { city, client } = parsePartKey(pKey)
      const m = ensureSlice(slices, dateKey, city, client)
      m.rent += count * EV_DAILY_RENT
    }
    if (di % 3 === 2) {
      await yieldToMain()
      if (shouldCancel()) return emptyBase(monthLabel)
    }
  }

  for (const dayMap of slices.values()) {
    for (const m of dayMap.values()) {
      m.totalKm = Math.round(m.totalKm * 100) / 100
      m.deployKm = Math.round(m.deployKm * 100) / 100
      m.returnKm = Math.round(m.returnKm * 100) / 100
      m.totalEarning = Math.round(m.totalEarning * 100) / 100
      m.evEarning = Math.round(m.evEarning * 100) / 100
      m.nonEarning = Math.round(m.nonEarning * 100) / 100
      m.mfAmount = Math.round(m.mfAmount * 100) / 100
      m.rent = Math.round(m.rent * 100) / 100
      m.totalRevenue = Math.round((m.totalEarning + m.mfAmount + m.rent) * 100) / 100
    }
  }

  const base = {
    monthLabel,
    fromKey,
    toKey,
    days,
    slices,
    iotUploadedDates: [...iotUploadedDates].sort(),
    metrics: FULL_DATA_METRICS,
    _flatIntervals: flatIntervals,
    _orderRowsRef: orderRows,
  }

  report('ready')
  if (typeof onReady === 'function') onReady(base)

  if (skipZeroOrder) {
    report('done')
    return base
  }

  report('zero-order')
  await fillZeroOrderIntoBaseAsync(base, {
    shouldCancel,
    orderRows,
    flatIntervals,
  })
  report('done')
  return base
}

/** Fill 0-order counts into an existing base (can run after table is already shown). */
export async function fillZeroOrderIntoBaseAsync(
  base,
  { shouldCancel = () => false, orderRows = null, flatIntervals = null } = {}
) {
  if (!base?.days?.length) return base
  const intervals = flatIntervals || base._flatIntervals || []
  const orders = orderRows || base._orderRowsRef || []
  const orderIndex = buildOrderDeliveredIndex(orders)
  const activeDates = buildOrderActiveDates(orderIndex)
  const yesterday = maxZeroOrderEndDateKey()
  let lastOrderDay = ''
  for (const d of activeDates) {
    if (d > lastOrderDay) lastOrderDay = d
  }
  // Cap at yesterday AND last day that has order upload (no empty/future days)
  const maxEnd =
    lastOrderDay && lastOrderDay < yesterday ? lastOrderDay : yesterday
  const fromKey = base.fromKey
  const toKey = base.toKey
  const relevant = intervals.filter(
    (iv) => iv.fromKey <= toKey && (iv.toKey == null || iv.toKey > fromKey)
  )

  for (let di = 0; di < base.days.length; di++) {
    const dateKey = base.days[di].dateKey
    // reset then rebuild for this date across parts
    const dayMap = base.slices.get(dateKey)
    if (dayMap) {
      for (const m of dayMap.values()) {
        m.zeroOrderRiderCount = 0
        m.d1ZeroOrderRiderCount = 0
      }
    }

    // Same 4-day 0-order window as "0 order Rider count"
    if (dateKey > maxEnd || !zeroOrderWindowHasOrders(activeDates, dateKey)) {
      await yieldToMain()
      if (shouldCancel()) return base
      continue
    }

    const seenRiders = new Set()
    const seenD1Riders = new Set()
    for (let i = 0; i < relevant.length; i++) {
      const iv = relevant[i]
      if (iv.fromKey > dateKey) continue
      if (iv.toKey != null && iv.toKey <= dateKey) continue
      if (!iv.riderId) continue
      if (!workerZeroOrdersInWindow(orderIndex, iv.riderId, dateKey)) continue

      if (!seenRiders.has(iv.riderId)) {
        seenRiders.add(iv.riderId)
        const m = ensureSlice(base.slices, dateKey, iv.city, iv.client)
        m.zeroOrderRiderCount += 1
      }

      // Same 0-order riders, only the selected clients
      if (isD1ZeroOrderClient(iv.client) && !seenD1Riders.has(iv.riderId)) {
        seenD1Riders.add(iv.riderId)
        const m = ensureSlice(base.slices, dateKey, iv.city, iv.client)
        m.d1ZeroOrderRiderCount += 1
      }

      if (i > 0 && i % 1000 === 0) {
        await yieldToMain()
        if (shouldCancel()) return base
      }
    }
    await yieldToMain()
    if (shouldCancel()) return base
  }
  return base
}

/** Sync helper for tests — prefer buildFullDataMonthBaseAsync in UI. */
export async function buildFullDataMonthBase(opts = {}) {
  return buildFullDataMonthBaseAsync(opts)
}

export function materializeFullDataReport(base, cityFilter = 'All', clientFilter = 'All') {
  if (!base?.days?.length) {
    return {
      monthLabel: base?.monthLabel || '',
      fromKey: '',
      toKey: '',
      days: [],
      byDate: {},
      totals: emptyDayMetrics(),
      metrics: FULL_DATA_METRICS,
      iotUploadedDates: [],
    }
  }

  const byDate = {}
  for (const d of base.days) byDate[d.dateKey] = emptyDayMetrics()

  for (const [dateKey, partMap] of base.slices || []) {
    if (!byDate[dateKey]) continue
    const dest = byDate[dateKey]
    let d1ClientOrders = 0
    let d1ClientRiders = 0
    const dayRiderIds = new Set()
    const dayEvRiderIds = new Set()
    const dayNonEvRiderIds = new Set()
    for (const [pKey, src] of partMap) {
      if (!matchesPart(pKey, cityFilter, clientFilter)) continue
      for (const key of NUMERIC_KEYS) {
        dest[key] += Number(src[key]) || 0
      }
      const { client } = parsePartKey(pKey)
      if (isD1ZeroOrderClient(client)) {
        d1ClientOrders += Number(src.totalOrder) || 0
        d1ClientRiders += Number(src.riderCount) || 0
      }
      for (const id of src._riderIds || []) dayRiderIds.add(id)
      for (const id of src._evRiderIds || []) dayEvRiderIds.add(id)
      for (const id of src._nonEvRiderIds || []) dayNonEvRiderIds.add(id)
    }
    dest._riderIds = [...dayRiderIds]
    dest._evRiderIds = [...dayEvRiderIds]
    dest._nonEvRiderIds = [...dayNonEvRiderIds]
    dest._d1ClientOrders = d1ClientOrders
    dest._d1ClientRiders = d1ClientRiders
    dest.ordersPerRider = calcOrdersPerRider(d1ClientOrders, d1ClientRiders)
    dest.totalKm = Math.round(dest.totalKm * 100) / 100
    dest.deployKm = Math.round(dest.deployKm * 100) / 100
    dest.returnKm = Math.round(dest.returnKm * 100) / 100
    for (const k of MONEY_KEYS) {
      dest[k] = Math.round((Number(dest[k]) || 0) * 100) / 100
    }
  }

  const totals = emptyDayMetrics()
  for (const metric of FULL_DATA_METRICS) {
    if (metric.hold) {
      totals[metric.key] = null
      continue
    }
    if (metric.ratio || RATIO_KEYS.has(metric.key)) {
      let orders = 0
      let riders = 0
      for (const d of base.days) {
        orders += Number(byDate[d.dateKey]?._d1ClientOrders) || 0
        riders += Number(byDate[d.dateKey]?._d1ClientRiders) || 0
      }
      totals[metric.key] = calcOrdersPerRider(orders, riders)
      continue
    }
    if (metric.yesterdayTotal || YESTERDAY_TOTAL_KEYS.has(metric.key)) {
      totals[metric.key] = yesterdayMetricValue(byDate, base.days, metric.key)
      continue
    }
    if (metric.uniqueMonth || UNIQUE_MONTH_KEYS.has(metric.key)) {
      const listKey =
        metric.key === 'evRiderCount'
          ? '_evRiderIds'
          : metric.key === 'nonEvRiderCount'
            ? '_nonEvRiderIds'
            : '_riderIds'
      totals[metric.key] = uniqueIdsFromDays(byDate, base.days, listKey)
      continue
    }
    let sum = 0
    for (const d of base.days) {
      sum += Number(byDate[d.dateKey]?.[metric.key]) || 0
    }
    if (
      metric.key === 'totalKm' ||
      metric.key === 'deployKm' ||
      metric.key === 'returnKm' ||
      MONEY_KEYS.has(metric.key)
    ) {
      totals[metric.key] = Math.round(sum * 100) / 100
    } else {
      totals[metric.key] = sum
    }
  }

  return {
    monthLabel: base.monthLabel,
    fromKey: base.fromKey,
    toKey: base.toKey,
    days: base.days,
    byDate,
    totals,
    metrics: FULL_DATA_METRICS,
    iotUploadedDates: base.iotUploadedDates || [],
  }
}

export function buildFullDataMonthReport(opts = {}) {
  return materializeFullDataReport(emptyBase(opts.monthLabel), opts.cityFilter, opts.clientFilter)
}

export function formatFullDataCell(value, hold = false) {
  if (hold || value == null) return '—'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    if (Number.isInteger(value)) return value.toLocaleString('en-IN')
    return value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }
  return String(value)
}

export function todayDateKey(asOf = new Date()) {
  return format(startOfDay(asOf), 'yyyy-MM-dd')
}

export function yesterdayDateKey(asOf = new Date()) {
  return format(subDays(startOfDay(asOf), 1), 'yyyy-MM-dd')
}

/** Share image uses through yesterday — page still shows today. */
export function sliceFullDataReportThroughYesterday(report, asOf = new Date()) {
  const yKey = yesterdayDateKey(asOf)
  const days = (report?.days || []).filter((d) => d.dateKey <= yKey)
  const totals = {}
  for (const metric of report?.metrics || FULL_DATA_METRICS) {
    if (metric.hold) {
      totals[metric.key] = null
      continue
    }
    if (metric.ratio || RATIO_KEYS.has(metric.key)) {
      let orders = 0
      let riders = 0
      for (const d of days) {
        orders += Number(report.byDate?.[d.dateKey]?._d1ClientOrders) || 0
        riders += Number(report.byDate?.[d.dateKey]?._d1ClientRiders) || 0
      }
      totals[metric.key] = calcOrdersPerRider(orders, riders)
      continue
    }
    if (metric.yesterdayTotal || YESTERDAY_TOTAL_KEYS.has(metric.key)) {
      totals[metric.key] = yesterdayMetricValue(report.byDate, days, metric.key, asOf)
      continue
    }
    if (metric.uniqueMonth || UNIQUE_MONTH_KEYS.has(metric.key)) {
      const listKey =
        metric.key === 'evRiderCount'
          ? '_evRiderIds'
          : metric.key === 'nonEvRiderCount'
            ? '_nonEvRiderIds'
            : '_riderIds'
      totals[metric.key] = uniqueIdsFromDays(report.byDate, days, listKey)
      continue
    }
    let sum = 0
    for (const d of days) {
      sum += Number(report.byDate?.[d.dateKey]?.[metric.key]) || 0
    }
    if (
      metric.key === 'totalKm' ||
      metric.key === 'deployKm' ||
      metric.key === 'returnKm' ||
      MONEY_KEYS.has(metric.key)
    ) {
      totals[metric.key] = Math.round(sum * 100) / 100
    } else {
      totals[metric.key] = sum
    }
  }
  return {
    ...report,
    days,
    totals,
    fromKey: days[0]?.dateKey || report?.fromKey || '',
    toKey: days[days.length - 1]?.dateKey || yKey,
  }
}

/**
 * Compact WhatsApp text for Full Data (month totals under current filters).
 * Skips held earnings rows. Keeps under typical wa.me length limits.
 */
export function buildFullDataWhatsAppText(
  report,
  { monthLabel = '', cityFilter = 'All', clientFilter = 'All' } = {}
) {
  const lines = [
    '*FleetPro — Full Data Report*',
    `Month: ${monthLabel || report?.monthLabel || '—'}`,
    `City: ${cityFilter || 'All'}`,
    `Client: ${clientFilter || 'All'}`,
  ]
  if (report?.fromKey && report?.toKey) {
    lines.push(`Range: ${report.fromKey} → ${report.toKey}`)
  }
  lines.push('')

  let section = ''
  for (const metric of report?.metrics || FULL_DATA_METRICS) {
    if (metric.hold) continue
    if (metric.section !== section) {
      section = metric.section
      lines.push(`*${section === 'Supply' ? 'Supply' : 'Ev / KM'}*`)
    }
    const raw = report?.totals?.[metric.key]
    lines.push(`• ${metric.label}: ${formatFullDataCell(raw, false)}`)
  }

  lines.push('')
  lines.push('_Shared from FleetPro Full Data_')
  return lines.join('\n')
}

/** Open WhatsApp with pre-filled report text (user picks chat). */
export function shareFullDataWhatsApp(report, filters = {}) {
  const text = buildFullDataWhatsAppText(report, filters)
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`
  window.open(url, '_blank', 'noopener,noreferrer')
  return text
}

function matchesCityClientFilter(city, client, cityFilter = 'All', clientFilter = 'All') {
  const c = normalizeSummaryCity(city)
  const cl = normalizeSummaryClient(client)
  if (cityFilter && cityFilter !== 'All' && c !== cityFilter) return false
  if (clientFilter && clientFilter !== 'All' && cl !== clientFilter) return false
  return true
}

export function buildFullDataSummaryExportRows(report) {
  return (report?.metrics || []).map((metric) => {
    const out = {
      Section: metric.section,
      List: metric.label,
      Total: metric.hold ? '' : report.totals?.[metric.key] ?? '',
    }
    for (const d of report?.days || []) {
      const v = report.byDate?.[d.dateKey]?.[metric.key]
      out[d.label] = metric.hold || v == null ? '' : v
    }
    return out
  })
}

/** Rider-day order upload rows (raw detail behind Supply orders). */
export function buildFullDataOrderDetailRows(
  orderRows = [],
  { fromKey = '', toKey = '', cityFilter = 'All', clientFilter = 'All' } = {}
) {
  const rows = []
  for (const row of orderRows || []) {
    const dateKey = toMetricDateKey(row.date_record)
    if (!dateKey) continue
    if (fromKey && dateKey < fromKey) continue
    if (toKey && dateKey > toKey) continue
    const city = normalizeSummaryCity(row.city)
    const client = normalizeSummaryClient(row.client)
    if (!matchesCityClientFilter(city, client, cityFilter, clientFilter)) continue
    const delivered = Number(row.delivered) || 0
    rows.push({
      Date: dateKey,
      City: city,
      Client: client,
      'Worker Code': (row.worker_code || '').toString().trim(),
      Type: (row.type1 || '').toString().trim(),
      'EV / Non-EV': isEvType(row.type1) ? 'EV' : 'Non-EV',
      Delivered: delivered,
    })
  }
  rows.sort((a, b) => a.Date.localeCompare(b.Date) || a.Client.localeCompare(b.Client) || a['Worker Code'].localeCompare(b['Worker Code']))
  return rows
}

/** Unique rider + client order totals (detail behind Order per rider). */
export function buildFullDataOrderRiderDetailRows(
  orderRows = [],
  overallRows = [],
  { fromKey = '', toKey = '', cityFilter = 'All', clientFilter = 'All' } = {}
) {
  const nameByRider = new Map()
  for (const row of overallRows || []) {
    const id = (row.clientId || row.clientRiderId || row.ev91RiderId || '').toString().trim().toUpperCase()
    const name = (row.riderName || '').toString().trim()
    if (id && name && !nameByRider.has(id)) nameByRider.set(id, name)
  }

  const byKey = new Map()
  for (const row of orderRows || []) {
    const dateKey = toMetricDateKey(row.date_record)
    if (!dateKey) continue
    if (fromKey && dateKey < fromKey) continue
    if (toKey && dateKey > toKey) continue
    const city = normalizeSummaryCity(row.city)
    const client = normalizeSummaryClient(row.client)
    if (!matchesCityClientFilter(city, client, cityFilter, clientFilter)) continue
    const worker = (row.worker_code || '').toString().trim().toUpperCase()
    if (!worker) continue
    const delivered = Number(row.delivered) || 0
    const key = `${worker}|${client}|${city}`
    if (!byKey.has(key)) {
      byKey.set(key, {
        worker,
        client,
        city,
        days: new Set(),
        totalDelivered: 0,
        zeroOrderDays: 0,
        evDays: 0,
        nonEvDays: 0,
      })
    }
    const rec = byKey.get(key)
    rec.days.add(dateKey)
    rec.totalDelivered += delivered
    if (delivered <= 0) rec.zeroOrderDays += 1
    if (isEvType(row.type1)) rec.evDays += 1
    else rec.nonEvDays += 1
  }

  const rows = [...byKey.values()].map((rec) => {
    const orderDays = rec.days.size
    const avg = orderDays ? Math.ceil(rec.totalDelivered / orderDays) : 0
    return {
      'Worker Code': rec.worker,
      'Rider Name': nameByRider.get(rec.worker) || '',
      Client: rec.client,
      City: rec.city,
      'EV / Non-EV': rec.evDays >= rec.nonEvDays ? 'EV' : 'Non-EV',
      'Order days': orderDays,
      'Total Delivered': rec.totalDelivered,
      'Order per rider / day': avg,
      '0 order days': rec.zeroOrderDays,
    }
  })
  rows.sort(
    (a, b) =>
      String(a.Client).localeCompare(String(b.Client)) ||
      String(a.City).localeCompare(String(b.City)) ||
      String(a['Worker Code']).localeCompare(String(b['Worker Code']))
  )
  return rows
}

/**
 * One row per date × 0-order rider (same 4-day window as Full Data).
 * Date + Client included.
 */
export function buildFullDataZeroOrderDetailRows(
  orderRows = [],
  overallRows = [],
  {
    days = [],
    fromKey = '',
    toKey = '',
    cityFilter = 'All',
    clientFilter = 'All',
    flatIntervals = null,
  } = {}
) {
  const nameByRider = new Map()
  const extraByRider = new Map()
  for (const row of overallRows || []) {
    const clientId = (row.clientId || row.clientRiderId || '').toString().trim().toUpperCase()
    const ev91Id = (row.ev91RiderId || '').toString().trim()
    const id = clientId || ev91Id.toUpperCase()
    if (!id) continue
    const name = (row.riderName || '').toString().trim()
    if (name && !nameByRider.has(id)) nameByRider.set(id, name)
    const vehicle = (row.vehicleNumber || '').toString().trim()
    const source = (row.sourceName || row.source || '').toString().trim()
    const prev = extraByRider.get(id) || { vehicle: '', source: '', ev91Id: '' }
    extraByRider.set(id, {
      vehicle: prev.vehicle || vehicle,
      source: prev.source || source,
      ev91Id: prev.ev91Id || ev91Id,
    })
    if (ev91Id) {
      const prevEv = extraByRider.get(ev91Id.toUpperCase()) || prev
      extraByRider.set(ev91Id.toUpperCase(), {
        vehicle: prevEv.vehicle || vehicle,
        source: prevEv.source || source,
        ev91Id: prevEv.ev91Id || ev91Id,
      })
    }
  }

  const orderIndex = buildOrderDeliveredIndex(orderRows)
  const activeDates = buildOrderActiveDates(orderIndex)
  const yesterday = maxZeroOrderEndDateKey()
  let lastOrderDay = ''
  for (const d of activeDates) {
    if (d > lastOrderDay) lastOrderDay = d
  }
  const maxEnd = lastOrderDay && lastOrderDay < yesterday ? lastOrderDay : yesterday

  const intervals = (flatIntervals || []).filter(
    (iv) => iv.fromKey <= (toKey || iv.fromKey) && (iv.toKey == null || iv.toKey > (fromKey || iv.fromKey))
  )

  const rows = []
  for (const day of days || []) {
    const dateKey = day.dateKey
    if (!dateKey) continue
    if (fromKey && dateKey < fromKey) continue
    if (toKey && dateKey > toKey) continue
    if (dateKey > maxEnd || !zeroOrderWindowHasOrders(activeDates, dateKey)) continue

    const seen = new Set()
    for (const iv of intervals) {
      if (iv.fromKey > dateKey) continue
      if (iv.toKey != null && iv.toKey <= dateKey) continue
      if (!iv.riderId || seen.has(iv.riderId)) continue
      if (!matchesCityClientFilter(iv.city, iv.client, cityFilter, clientFilter)) continue
      if (!workerZeroOrdersInWindow(orderIndex, iv.riderId, dateKey)) continue
      seen.add(iv.riderId)
      const extra = extraByRider.get(String(iv.riderId).toUpperCase()) || {}
      rows.push({
        Date: dateKey,
        'Worker Code': iv.riderId,
        'EV91 ID': iv.ev91RiderId || extra.ev91Id || '',
        'Rider Name': nameByRider.get(String(iv.riderId).toUpperCase()) || '',
        'V Number': iv.vehicleNumber || extra.vehicle || iv.vKey || '',
        'Source Name': iv.sourceName || extra.source || '',
        Client: normalizeSummaryClient(iv.client),
        City: normalizeSummaryCity(iv.city),
        'D-1 client': isD1ZeroOrderClient(iv.client) ? 'Yes' : 'No',
      })
    }
  }
  rows.sort(
    (a, b) =>
      String(a.Date).localeCompare(String(b.Date)) ||
      String(a.Client).localeCompare(String(b.Client)) ||
      String(a['Worker Code']).localeCompare(String(b['Worker Code']))
  )
  return rows
}

/** EV91 deploy / return event rows (raw detail behind Deployee / Return). */
export function buildFullDataDeployDetailRows(
  overallRows = [],
  { fromKey = '', toKey = '', cityFilter = 'All', clientFilter = 'All' } = {}
) {
  const rows = []
  const seen = new Set()
  for (const row of overallRows || []) {
    const dateKey = rowDateKey(row, 'statusDate')
    if (!dateKey) continue
    if (fromKey && dateKey < fromKey) continue
    if (toKey && dateKey > toKey) continue
    const status = String(row.vehicleStatus || '').toLowerCase()
    let kind = ''
    if (status.includes('deploy')) kind = 'Deploy'
    else if (status.includes('return')) kind = 'Return'
    else continue
    const city = normalizeSummaryCity(row.cityName || row.city)
    const client = normalizeSummaryClient(row.clientName)
    if (!matchesCityClientFilter(city, client, cityFilter, clientFilter)) continue
    const vehicle = (row.vehicleNumber || '').toString().trim()
    const riderId = (row.clientId || row.clientRiderId || row.ev91RiderId || '').toString().trim()
    const uniq = `${vehicle}|${dateKey}|${kind}|${riderId}`
    if (seen.has(uniq)) continue
    seen.add(uniq)
    rows.push({
      Date: dateKey,
      Status: kind,
      City: city,
      Client: client,
      Vehicle: vehicle,
      'Rider ID': riderId,
      'Rider Name': (row.riderName || '').toString().trim(),
    })
  }
  rows.sort((a, b) => a.Date.localeCompare(b.Date) || a.Status.localeCompare(b.Status) || a.Vehicle.localeCompare(b.Vehicle))
  return rows
}

/** IoT vehicle-day KM rows (raw detail behind Ev KM). */
export function buildFullDataIotDetailRows(iotRows = [], { fromKey = '', toKey = '' } = {}) {
  const rows = []
  for (const row of iotRows || []) {
    const dateKey = normalizeIotRunDate(row.run_date)
    if (!dateKey) continue
    if (fromKey && dateKey < fromKey) continue
    if (toKey && dateKey > toKey) continue
    const km = iotRowDistanceKm(row) || Number(row.total_distance) || 0
    rows.push({
      Date: dateKey,
      Vehicle: (row.vehicle_number || '').toString().trim(),
      KM: Math.round(km * 100) / 100,
    })
  }
  rows.sort((a, b) => a.Date.localeCompare(b.Date) || a.Vehicle.localeCompare(b.Vehicle))
  return rows
}

/**
 * Earliest order day per rider × city × client (all order upload history).
 */
function buildRiderWorkStartIndex(orderRows = []) {
  const byKey = new Map()
  for (const row of orderRows || []) {
    const dateKey = toMetricDateKey(row.date_record)
    if (!dateKey) continue
    if ((Number(row.delivered) || 0) <= 0) continue
    const worker = (row.worker_code || '').toString().trim().toUpperCase()
    if (!worker) continue
    const city = normalizeSummaryCity(row.city)
    const client = normalizeSummaryClient(row.client)
    const key = `${worker}\t${city}\t${client}`
    const prev = byKey.get(key)
    if (!prev || dateKey < prev) byKey.set(key, dateKey)
  }
  return byKey
}

/** Identity keys for EV91 riderAssignments lookup (worker / EV91 id / phone). */
function riderDeployIdentityKeys(...ids) {
  const keys = new Set()
  for (const raw of ids) {
    const text = (raw ?? '').toString().trim()
    if (!text) continue
    keys.add(text)
    keys.add(text.toUpperCase())
    keys.add(text.toUpperCase().replace(/[_\s-]+/g, '-'))
    for (const alias of riderIdLookupKeys(text)) keys.add(alias)
  }
  return [...keys]
}

/**
 * EV for Rider Wise = vehicle still allotted on that date (EV91 Overall).
 * Return day and after = Non-EV. If rider never appears in EV91, fall back to order Type1.
 */
function isRiderEvOnDate(riderAssignments, identityKeys, dateKey, type1Fallback) {
  if (!dateKey) return isEvType(type1Fallback)
  const asOf = startOfDay(parseISO(dateKey))
  if (Number.isNaN(asOf.getTime())) return isEvType(type1Fallback)

  const hit = findEv91RiderVehicleOnDate(riderAssignments, identityKeys, asOf)
  if (hit?.vehicleNumber) return true

  // Known in EV91 history but no open allotment on this day → returned / not deployed
  if (riderAssignments && identityKeys?.length) {
    let known = false
    for (const key of identityKeys) {
      if (riderAssignments.has(key) && riderAssignments.get(key)?.length) {
        known = true
        break
      }
    }
    if (known) return false
  }

  return isEvType(type1Fallback)
}

function riderHasEv91VehicleHistory(riderAssignments, identityKeys) {
  if (!riderAssignments || !identityKeys?.length) return false
  for (const key of identityKeys) {
    if (riderAssignments.has(key) && riderAssignments.get(key)?.length) return true
  }
  return false
}

/**
 * V current status for Rider Wise (EV riders only).
 * Deployee = vehicle currently allotted · Return = had vehicle but returned · blank = Non-EV (never EV91 vehicle).
 */
function riderVehicleCurrentStatus(riderAssignments, identityKeys, asOfDateKey) {
  if (!riderHasEv91VehicleHistory(riderAssignments, identityKeys)) return ''
  const asOf = asOfDateKey ? startOfDay(parseISO(asOfDateKey)) : startOfDay(new Date())
  if (Number.isNaN(asOf.getTime())) return ''
  const hit = findEv91RiderVehicleOnDate(riderAssignments, identityKeys, asOf)
  if (hit?.vehicleNumber) return 'Deployee'
  return 'Return'
}

/**
 * Source-wise daily Supply from order upload.
 * Source name comes from rider_onboarding.source_name (lookup by worker code).
 * Rider Wise EV/Non-EV uses EV91 deploy/return intervals (not order Type1 alone).
 */
export function buildFullDataSourceWiseDailyRows(
  orderRows = [],
  onboardingRows = [],
  overallRows = [],
  mappingRows = [],
  allOrderRows = [],
  currentRows = [],
  { fromKey = '', toKey = '', cityFilter = 'All', clientFilter = 'All' } = {}
) {
  const sourceIndex = buildOnboardingSourceLookupIndex(onboardingRows)
  const ev91Index = buildEv91PublicRiderIndex(overallRows, mappingRows)
  const workStartIndex = buildRiderWorkStartIndex(allOrderRows.length ? allOrderRows : orderRows)

  const deployIndexes = buildEv91OverallIntervalIndexes(overallRows)
  mergeCurrentStatusIntoIndexes(deployIndexes, currentRows)
  const { riderAssignments } = deployIndexes

  const nameByRider = new Map()
  for (const row of overallRows || []) {
    const id = (row.clientId || row.clientRiderId || row.ev91RiderId || '').toString().trim().toUpperCase()
    const name = (row.riderName || '').toString().trim()
    if (id && name && !nameByRider.has(id)) nameByRider.set(id, name)
  }

  const buckets = new Map()
  const riderBuckets = new Map()
  const identityCache = new Map()

  for (const row of orderRows || []) {
    const dateKey = toMetricDateKey(row.date_record)
    if (!dateKey) continue
    if (fromKey && dateKey < fromKey) continue
    if (toKey && dateKey > toKey) continue
    const city = normalizeSummaryCity(row.city)
    const client = normalizeSummaryClient(row.client)
    if (!matchesCityClientFilter(city, client, cityFilter, clientFilter)) continue

    const worker = (row.worker_code || '').toString().trim().toUpperCase()
    const delivered = Number(row.delivered) || 0
    const type1Ev = isEvType(row.type1)
    const source = canonicalSourceName(
      lookupOnboardingSource(sourceIndex, { riderIds: [worker, row.worker_code, row.rider_id] }) || 'Unknown'
    ) || 'Unknown'

    // Source Daily / Month still follow order Type1 (same as Full Data matrix)
    const isEv = type1Ev

    const key = `${sourceNameGroupKey(source)}\t${city}\t${client}\t${dateKey}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        source,
        city,
        client,
        dateKey,
        riders: new Set(),
        evRiders: new Set(),
        nonEvRiders: new Set(),
        totalOrder: 0,
        evOrder: 0,
        nonEvOrder: 0,
        earning: 0,
        evEarning: 0,
        nonEarning: 0,
        mfAmount: 0,
      })
    }
    const b = buckets.get(key)
    b.totalOrder += delivered
    if (isEv) b.evOrder += delivered
    else b.nonEvOrder += delivered

    if (delivered > 0) {
      const { earning, mf } = calcOrderEarningAndMf(client, city, delivered)
      b.earning += earning
      b.mfAmount += mf
      if (isEv) b.evEarning += earning
      else b.nonEarning += earning
      if (worker) {
        b.riders.add(worker)
        if (isEv) b.evRiders.add(worker)
        else b.nonEvRiders.add(worker)

        const riderKey = `${worker}\t${sourceNameGroupKey(source)}\t${city}\t${client}`
        if (!riderBuckets.has(riderKey)) {
          riderBuckets.set(riderKey, {
            worker,
            source,
            city,
            client,
            totalOrder: 0,
            evOrder: 0,
            nonEvOrder: 0,
            earning: 0,
            evEarning: 0,
            nonEarning: 0,
            mfAmount: 0,
            evDays: 0,
            nonEvDays: 0,
            orderDays: new Set(),
            dayEvFlags: new Map(),
          })
        }

        let identityKeys = identityCache.get(worker)
        if (!identityKeys) {
          const mappedEv91 = lookupEv91PublicRiderId(ev91Index, worker) || ''
          identityKeys = riderDeployIdentityKeys(worker, row.worker_code, row.rider_id, mappedEv91)
          identityCache.set(worker, identityKeys)
        }

        // Rider Wise: EV only while vehicle is allotted (return day onward = Non-EV)
        const riderIsEv = isRiderEvOnDate(riderAssignments, identityKeys, dateKey, row.type1)

        const r = riderBuckets.get(riderKey)
        r.totalOrder += delivered
        if (riderIsEv) {
          r.evOrder += delivered
          r.evDays += 1
        } else {
          r.nonEvOrder += delivered
          r.nonEvDays += 1
        }
        r.earning += earning
        r.mfAmount += mf
        if (riderIsEv) r.evEarning += earning
        else r.nonEarning += earning
        r.orderDays.add(dateKey)
        r.dayEvFlags.set(dateKey, riderIsEv)
      }
    }
  }

  const daily = [...buckets.values()]
    .map((b) => ({
      Source: b.source,
      City: b.city || '',
      Client: b.client || '',
      Date: b.dateKey,
      'Rider Count': b.riders.size,
      'EV rider Count': b.evRiders.size,
      'Non-EV rider Count': b.nonEvRiders.size,
      'Total Order': b.totalOrder,
      'EV Order': b.evOrder,
      'Non-EV Order': b.nonEvOrder,
      Earning: Math.round(b.earning * 100) / 100,
      'EV Earning': Math.round(b.evEarning * 100) / 100,
      'Non Earning': Math.round(b.nonEarning * 100) / 100,
      'MF Amount': Math.round(b.mfAmount * 100) / 100,
    }))
    .sort(
      (a, b) =>
        a.Date.localeCompare(b.Date) ||
        String(a.City).localeCompare(String(b.City)) ||
        String(a.Client).localeCompare(String(b.Client)) ||
        String(a.Source).localeCompare(String(b.Source))
    )

  const monthBySource = new Map()
  for (const b of buckets.values()) {
    const monthKey = `${sourceNameGroupKey(b.source)}\t${b.city}\t${b.client}`
    if (!monthBySource.has(monthKey)) {
      monthBySource.set(monthKey, {
        source: b.source,
        city: b.city,
        client: b.client,
        riders: new Set(),
        evRiders: new Set(),
        nonEvRiders: new Set(),
        totalOrder: 0,
        evOrder: 0,
        nonEvOrder: 0,
        earning: 0,
        evEarning: 0,
        nonEarning: 0,
        mfAmount: 0,
      })
    }
    const m = monthBySource.get(monthKey)
    for (const id of b.riders) m.riders.add(id)
    for (const id of b.evRiders) m.evRiders.add(id)
    for (const id of b.nonEvRiders) m.nonEvRiders.add(id)
    m.totalOrder += b.totalOrder
    m.evOrder += b.evOrder
    m.nonEvOrder += b.nonEvOrder
    m.earning += b.earning
    m.evEarning += b.evEarning
    m.nonEarning += b.nonEarning
    m.mfAmount += b.mfAmount
  }

  const month = [...monthBySource.values()]
    .map((m) => ({
      Source: m.source,
      City: m.city || '',
      Client: m.client || '',
      'Unique Rider Count': m.riders.size,
      'Unique EV rider Count': m.evRiders.size,
      'Unique Non-EV rider Count': m.nonEvRiders.size,
      'Total Order': m.totalOrder,
      'EV Order': m.evOrder,
      'Non-EV Order': m.nonEvOrder,
      Earning: Math.round(m.earning * 100) / 100,
      'EV Earning': Math.round(m.evEarning * 100) / 100,
      'Non Earning': Math.round(m.nonEarning * 100) / 100,
      'MF Amount': Math.round(m.mfAmount * 100) / 100,
    }))
    .sort(
      (a, b) =>
        String(a.City).localeCompare(String(b.City)) ||
        String(a.Client).localeCompare(String(b.Client)) ||
        b['Total Order'] - a['Total Order'] ||
        String(a.Source).localeCompare(String(b.Source))
    )

  const riders = [...riderBuckets.values()]
    .map((r) => {
      const daysOrderDone = r.orderDays.size
      const sortedDays = [...r.orderDays].sort()
      const riderScopeKey = `${r.worker}\t${r.city}\t${r.client}`
      const workStartDate = workStartIndex.get(riderScopeKey) || sortedDays[0] || ''
      const lastWorkDate = sortedDays[sortedDays.length - 1] || ''
      const durationDays =
        workStartDate && lastWorkDate
          ? differenceInCalendarDays(parseISO(lastWorkDate), parseISO(workStartDate)) + 1
          : 0
      // Status as of last order day (after vehicle return → Non-EV)
      const lastDayEv =
        lastWorkDate && r.dayEvFlags?.has(lastWorkDate)
          ? r.dayEvFlags.get(lastWorkDate)
          : r.evDays >= r.nonEvDays

      const mappedEv91 = lookupEv91PublicRiderId(ev91Index, r.worker) || ''
      const identityKeys =
        identityCache.get(r.worker) || riderDeployIdentityKeys(r.worker, mappedEv91)
      // Current vehicle status: Deployee / Return for EV91 riders only; blank for Non-EV
      const vCurrentStatus = riderVehicleCurrentStatus(
        riderAssignments,
        identityKeys,
        todayDateKey()
      )

      return {
        'Rider ID': r.worker,
        'EV91 ID': mappedEv91,
        'Rider Name': nameByRider.get(r.worker) || '',
        Source: r.source,
        City: r.city || '',
        Client: r.client || '',
        'EV / Non-EV': lastDayEv ? 'EV' : 'Non-EV',
        'V current status': vCurrentStatus,
        'Work start date': workStartDate,
        'Last work date': lastWorkDate,
        'Duration days': durationDays,
        'Days order done': daysOrderDone,
        'Order per day': daysOrderDone ? Math.ceil(r.totalOrder / daysOrderDone) : 0,
        'Total Order': r.totalOrder,
        'EV Order': r.evOrder,
        'Non-EV Order': r.nonEvOrder,
        Earning: Math.round(r.earning * 100) / 100,
        'EV Earning': Math.round(r.evEarning * 100) / 100,
        'Non Earning': Math.round(r.nonEarning * 100) / 100,
        'MF Amount': Math.round(r.mfAmount * 100) / 100,
      }
    })
    .sort(
      (a, b) =>
        String(a.Source).localeCompare(String(b.Source)) ||
        String(a.City).localeCompare(String(b.City)) ||
        String(a.Client).localeCompare(String(b.Client)) ||
        String(a['Rider ID']).localeCompare(String(b['Rider ID']))
    )

  return { daily, month, riders }
}
