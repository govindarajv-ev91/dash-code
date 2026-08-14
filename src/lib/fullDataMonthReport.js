import {
  eachDayOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns'
import { normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import { toMetricDateKey } from './mergeRiderMetrics'
import { rowDateKey } from './ev91MisApi'
import { vehiclePartitionKey } from './fleetDeployReturnExport'
import {
  buildEv91OverallIntervalIndexes,
  mergeCurrentStatusIntoIndexes,
  findEv91RiderForVehicleOnDate,
} from './ev91EvLookup'
import { buildVehicleDayKmIndex } from './serviceScheduleReport'
import { KM_PRODUCTIVITY_BUCKETS, kmToBucketKey } from './vehicleKmProductivityReport'
import { parseOrderUploadMonthLabel } from './orderUploadDb'
import { normalizeIotRunDate } from './iotDataReport'
import { getZeroOrderAsOfFromEndDate } from './riderPerformanceReport'
import { calcOrderEarningAndMf, EV_DAILY_RENT } from './fullDataCommercialRates'

const PART_SEP = '\x1f'
/** Keep this much EV91 history before month start (open deploys). */
const OVERALL_HISTORY_DAYS = 180

export const FULL_DATA_METRICS = [
  { key: 'deployCount', label: 'Deployee Count', section: 'Supply' },
  { key: 'returnCount', label: 'Return Count', section: 'Supply' },
  { key: 'riderCount', label: 'Rider Count', section: 'Supply' },
  { key: 'evRiderCount', label: 'EV rider Count', section: 'Supply' },
  { key: 'nonEvRiderCount', label: 'Non-EV rider Count', section: 'Supply' },
  { key: 'totalOrder', label: 'Total Order', section: 'Supply' },
  { key: 'evOrder', label: 'EV order', section: 'Supply' },
  { key: 'nonEvOrder', label: 'Non-EV Order', section: 'Supply' },
  { key: 'zeroOrderRiderCount', label: '0 order Rider count', section: 'Supply' },
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

const NUMERIC_KEYS = FULL_DATA_METRICS.filter((m) => !m.hold).map((m) => m.key)
const MONEY_KEYS = new Set(['totalEarning', 'evEarning', 'nonEarning', 'mfAmount', 'rent', 'totalRevenue'])

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
      m.riderCount = riders
      m.evRiderCount = evRiders
      m.nonEvRiderCount = nonEvRiders
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
      for (const m of dayMap.values()) m.zeroOrderRiderCount = 0
    }

    // Never count today / future, or days with no order upload in the 4-day window
    if (dateKey > maxEnd || !zeroOrderWindowHasOrders(activeDates, dateKey)) {
      await yieldToMain()
      if (shouldCancel()) return base
      continue
    }

    const seenRiders = new Set()
    for (let i = 0; i < relevant.length; i++) {
      const iv = relevant[i]
      if (iv.fromKey > dateKey) continue
      if (iv.toKey != null && iv.toKey <= dateKey) continue
      if (!iv.riderId || seenRiders.has(iv.riderId)) continue
      seenRiders.add(iv.riderId)
      if (!workerZeroOrdersInWindow(orderIndex, iv.riderId, dateKey)) continue
      const m = ensureSlice(base.slices, dateKey, iv.city, iv.client)
      m.zeroOrderRiderCount += 1
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
    for (const [pKey, src] of partMap) {
      if (!matchesPart(pKey, cityFilter, clientFilter)) continue
      for (const key of NUMERIC_KEYS) {
        dest[key] += Number(src[key]) || 0
      }
    }
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
