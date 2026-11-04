import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { preferTrendRiderRecord } from './overviewClientTrendRiders.js'

const typeOrder = { Total: 0, EV: 1, 'Non-EV': 2 }
const groupKey = (row, type = row.type) => JSON.stringify([row.cityName, row.clientName, type])
const typesFor = (row) => ['Total', row.isEv ? 'EV' : 'Non-EV']

function trackRider(assignments, scope, row, newGroup) {
  if (!assignments.has(scope)) assignments.set(scope, new Map())
  const riders = assignments.get(scope)
  const existing = riders.get(row.rider)
  if (!existing) riders.set(row.rider, { row, groups: 1 })
  else {
    if (newGroup) existing.groups += 1
    if (preferTrendRiderRecord(row, existing.row)) existing.row = row
  }
}

function createPeriodKey(period) {
  const cache = new Map()
  return (date) => {
    if (!cache.has(date)) cache.set(date, period === 'daily' ? date : period === 'weekly'
      ? format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd') : `${date.slice(0, 7)}-01`)
    return cache.get(date)
  }
}

function addRanks(rows, partitionKey, riderMetric) {
  const partitions = new Map()
  for (const row of rows) {
    const key = partitionKey(row)
    if (!partitions.has(key)) partitions.set(key, [])
    partitions.get(key).push(row)
  }
  for (const group of partitions.values()) {
    for (const [field, prefix] of [[riderMetric, 'rider'], ['orders', 'order']]) {
      const values = [...new Set(group.map((row) => row[field]))].sort((a, b) => b - a)
      const ranks = new Map(values.map((value, index) => [value, index + 1]))
      for (const row of group) {
        row[`${prefix}RankHigh`] = ranks.get(row[field])
        row[`${prefix}RankLow`] = values.length - ranks.get(row[field]) + 1
      }
    }
  }
  return rows
}

/** Aggregate the chart's normalized records once, rather than rerunning it per city/client. */
function buildPeriods(details, contextDetails, period, includeOverlaps = false) {
  const periodKey = createPeriodKey(period)
  const visiblePeriods = new Set(details.map((row) => periodKey(row.date)))
  const buckets = new Map()
  const assignments = new Map()
  const getBucket = (row, type, key) => {
    const id = JSON.stringify([key, row.cityName, row.clientName, type])
    if (!buckets.has(id)) buckets.set(id, {
      periodStart: key, cityName: row.cityName, clientName: row.clientName, type,
      orders: 0, riders: new Set(), records: 0, allocatedRiders: 0,
    })
    return buckets.get(id)
  }
  const addRider = (row, type, key) => {
    const bucket = getBucket(row, type, key)
    trackRider(assignments, JSON.stringify([key, type]), row, !bucket.riders.has(row.rider))
    bucket.riders.add(row.rider)
  }

  for (const row of details) {
    const key = periodKey(row.date)
    for (const type of typesFor(row)) {
      const bucket = getBucket(row, type, key)
      bucket.orders += row.orders
      bucket.records += 1
      if (period !== 'daily' && row.rider) addRider(row, type, key)
    }
  }
  if (period === 'daily') {
    // A preceding-day rider can contribute even if their city/client has no
    // record on this chart date. Never add their previous orders to this day.
    const activeDates = new Map()
    for (const source of [contextDetails, details]) {
      for (const row of source) {
        if (!row.rider || row.orders <= 0) continue
        if (!activeDates.has(row.date)) {
          const start = parseISO(row.date)
          activeDates.set(row.date, Array.from({ length: 4 }, (_, offset) => format(addDays(start, offset), 'yyyy-MM-dd'))
            .filter((date) => visiblePeriods.has(date)))
        }
        for (const key of activeDates.get(row.date)) {
          for (const type of typesFor(row)) addRider(row, type, key)
        }
      }
    }
  }
  const overlaps = []
  for (const [scope, riders] of assignments) {
    const [periodStart, type] = JSON.parse(scope)
    for (const [rider, { row, groups }] of riders) {
      // Allocate both counts from the same record. Independent assignments
      // per type double-count riders who change type or city/client.
      if (type === 'Total') {
        for (const assignedType of typesFor(row)) getBucket(row, assignedType, periodStart).allocatedRiders += 1
      }
      if (includeOverlaps && groups > 1) overlaps.push({
        periodStart, type, rider, cityName: row.cityName, clientName: row.clientName,
        lastRecordDate: row.date, groups, extraCounts: groups - 1,
      })
    }
  }
  return {
    points: [...buckets.values()].map(({ allocatedRiders, riders, ...row }) => ({ ...row, riders: allocatedRiders, groupRiders: riders.size })),
    overlaps,
  }
}

function buildLifetime(history, periods) {
  const groups = new Map()
  const assignments = new Map()
  for (const row of history) {
    for (const type of typesFor(row)) {
      const key = groupKey(row, type)
      if (!groups.has(key)) groups.set(key, {
        cityName: row.cityName, clientName: row.clientName, type,
        orders: 0, uniqueRiders: new Set(), allocatedRiders: 0, firstDate: row.date, lastDate: row.date, periodCount: 0,
      })
      const group = groups.get(key)
      group.orders += row.orders
      if (row.rider) {
        trackRider(assignments, type, row, !group.uniqueRiders.has(row.rider))
        group.uniqueRiders.add(row.rider)
      }
      if (row.date < group.firstDate) group.firstDate = row.date
      if (row.date > group.lastDate) group.lastDate = row.date
    }
  }
  for (const [type, riders] of assignments) {
    if (type !== 'Total') continue
    for (const { row } of riders.values()) {
      for (const assignedType of typesFor(row)) groups.get(groupKey(row, assignedType)).allocatedRiders += 1
    }
  }
  // Earliest period wins ties, independent of source row order.
  for (const point of [...periods].sort((a, b) => a.periodStart.localeCompare(b.periodStart))) {
    const group = groups.get(groupKey(point))
    group.periodCount += 1
    for (const [metric, prefix] of [['riders', 'Riders'], ['orders', 'Orders']]) {
      if (group[`peak${prefix}`] == null || point[metric] > group[`peak${prefix}`]) {
        group[`peak${prefix}`] = point[metric]
        group[`peak${prefix}Date`] = point.periodStart
      }
      if (group[`lowest${prefix}`] == null || point[metric] < group[`lowest${prefix}`]) {
        group[`lowest${prefix}`] = point[metric]
        group[`lowest${prefix}Date`] = point.periodStart
      }
    }
  }
  return [...groups.values()].map(({ allocatedRiders, uniqueRiders, ...row }) => ({ ...row, uniqueRiders: allocatedRiders, groupRiders: uniqueRiders.size }))
}

function reconcilePeriods(report, selected) {
  const totals = new Map()
  const groupTotals = new Map()
  for (const row of selected) {
    const key = JSON.stringify([row.periodStart, row.type])
    if (!totals.has(key)) totals.set(key, { riders: 0, groupRiders: 0 })
    const sum = totals.get(key)
    sum.riders += row.riders
    sum.groupRiders += row.groupRiders
    const group = JSON.stringify([row.periodStart, row.cityName, row.clientName])
    if (!groupTotals.has(group)) groupTotals.set(group, { total: 0, typed: 0 })
    groupTotals.get(group)[row.type === 'Total' ? 'total' : 'typed'] += row.riders
  }
  for (const [group, counts] of groupTotals) {
    if (counts.total !== counts.typed) throw new Error(`EV/Non-EV rider reconciliation failed for ${group}.`)
  }
  const checks = []
  for (const point of report.series) {
    const periodStart = point.periodKey.length === 7 ? `${point.periodKey}-01` : point.periodKey
    for (const [type, metric] of [['Total', 'riders'], ['EV', 'evRiders'], ['Non-EV', 'nonEvRiders']]) {
      const sum = totals.get(JSON.stringify([periodStart, type])) || { riders: 0, groupRiders: 0 }
      // Never download a workbook whose main grouped counts disagree with its chart.
      if (sum.riders !== point[metric]) throw new Error(`Rider reconciliation failed for ${periodStart} (${type}).`)
      checks.push({ periodStart, type, chartRiders: point[metric], ...sum, extraCounts: sum.groupRiders - sum.riders })
    }
  }
  return checks
}

export function buildOverviewClientTrendAnalysis(report, { period = 'monthly', metric = 'riders' } = {}) {
  const { details, contextDetails, historyDetails } = report.exportData
  const { points, overlaps } = buildPeriods(details, contextDetails, period, true)
  const selected = addRanks(points, (row) => JSON.stringify([row.periodStart, row.type]), 'riders')
  const historyPeriods = buildPeriods(historyDetails, [], period).points
  const lifetime = addRanks(buildLifetime(historyDetails, historyPeriods), (row) => row.type, 'uniqueRiders')
  const compare = (riderKey) => (a, b) => typeOrder[a.type] - typeOrder[b.type]
    || (metric === 'orders' ? b.orders - a.orders : b[riderKey] - a[riderKey])
    || a.cityName.localeCompare(b.cityName) || a.clientName.localeCompare(b.clientName)
  selected.sort((a, b) => a.periodStart.localeCompare(b.periodStart) || compare('riders')(a, b))
  lifetime.sort(compare('uniqueRiders'))
  overlaps.sort((a, b) => a.periodStart.localeCompare(b.periodStart) || typeOrder[a.type] - typeOrder[b.type] || a.rider.localeCompare(b.rider))
  const historyDates = historyDetails.reduce((range, row) => ({
    from: !range.from || row.date < range.from ? row.date : range.from,
    to: !range.to || row.date > range.to ? row.date : range.to,
  }), { from: '', to: '' })
  return { selected, lifetime, historyDates, overlaps, checks: reconcilePeriods(report, selected) }
}
