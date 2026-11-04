import { eachDayOfInterval, format, parseISO, subDays } from 'date-fns'
import { buildEv91OverallIntervalIndexes, mergeCurrentStatusIntoIndexes } from './ev91EvLookup'
import { fillZeroOrderIntoBaseAsync, flattenDeployIntervals, trimOverallRowsForMonth, materializeFullDataReport, collectFullDataFilterOptions, buildFullDataZeroOrderDetailRows } from './fullDataMonthReport'
import { clientLookupKey, normalizeSummaryClient, dedupeCanonicalClients } from './clientSummaryClients'

/** Group spelling/case aliases consistently in options, assignments and exports. */
export function normalizeOverviewEvClient(value) {
  const key = clientLookupKey(value).replace(/-/g, ' ').replace(/\s+/g, ' ')
  if (['bb', 'bb now', 'bbnow', 'bigbasket', 'big basket', 'bigbasket now', 'big basket now'].includes(key)) return 'BB'
  if (['blinkit', 'blinket', 'binkit'].includes(key)) return 'Blinkit'
  if (key === 'zepto') return 'Zepto'
  if (key === 'amazon') return 'Amazon'
  if (['porter', 'porter 2w', 'porter2w'].includes(key)) return 'Porter 2W'
  if (['flipkart lma', 'fkm lma'].includes(key)) return 'Flipkart-LMA'
  if (['swiggy', 'swiggy instamart', 'instamart'].includes(key)) return 'Swiggy Instamart'
  const normalized = normalizeSummaryClient(value)
  return normalized.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normalizeClientRows(rows) {
  return rows.map((row) => ({ ...row,
    ...(row.client != null ? { client: normalizeOverviewEvClient(row.client) } : {}),
    ...(row.clientName != null ? { clientName: normalizeOverviewEvClient(row.clientName) } : {}),
  }))
}

export function collectOverviewEvZeroOrderFilterOptions(orderRows = [], overallRows = [], currentRows = []) {
  const options = collectFullDataFilterOptions(normalizeClientRows(orderRows), normalizeClientRows(overallRows), normalizeClientRows(currentRows))
  return { ...options, clients: dedupeCanonicalClients(options.clients) }
}

/** Use the Full Data calculation, including its live D-1 population and grace period. */
export async function buildOverviewEvZeroOrderReport({
  orderRows = [], overallRows = [], currentRows = [], riderDetailsById = null,
  dateFrom = '', dateTo = '', asOfDate = new Date(), shouldCancel = () => false,
  cityFilter = 'All', clientFilter = [],
} = {}) {
  const yesterday = format(subDays(asOfDate, 1), 'yyyy-MM-dd')
  const toKey = dateTo && dateTo < yesterday ? dateTo : yesterday
  const fromKey = dateFrom || format(subDays(parseISO(toKey), 29), 'yyyy-MM-dd')
  if (fromKey > toKey) return { series: [], getDetails: () => [] }
  orderRows = normalizeClientRows(orderRows)
  overallRows = normalizeClientRows(overallRows)
  currentRows = normalizeClientRows(currentRows)
  clientFilter = (Array.isArray(clientFilter) ? clientFilter : clientFilter && clientFilter !== 'All' ? [clientFilter] : []).map(normalizeOverviewEvClient)
  const days = eachDayOfInterval({ start: parseISO(fromKey), end: parseISO(toKey) })
    .map((day) => ({ dateKey: format(day, 'yyyy-MM-dd') }))
  const indexes = buildEv91OverallIntervalIndexes(trimOverallRowsForMonth(overallRows, fromKey, toKey))
  mergeCurrentStatusIntoIndexes(indexes, currentRows)
  const base = { days, slices: new Map() }
  const flatIntervals = flattenDeployIntervals(indexes.vehicleIntervals)
  await fillZeroOrderIntoBaseAsync(base, {
    orderRows, currentRows, riderDetailsById, asOfDate, shouldCancel,
    flatIntervals,
  })
  if (shouldCancel()) return { series: [], getDetails: () => [] }
  const filtered = materializeFullDataReport(base, cityFilter, clientFilter)
  const series = days.map(({ dateKey }) => ({
    date: dateKey,
    count: filtered.byDate[dateKey].d1ZeroOrderRiderCount,
  }))
  return {
    series,
    getDetails: () => buildFullDataZeroOrderDetailRows(orderRows, overallRows, {
      days, fromKey, toKey, cityFilter, clientFilter, flatIntervals, currentRows, riderDetailsById, asOfDate,
    }).filter((row) => row['Included in D-1 count'] === 'Yes'),
  }
}

export async function buildOverviewEvZeroOrderSeries(options) {
  return (await buildOverviewEvZeroOrderReport(options)).series
}
