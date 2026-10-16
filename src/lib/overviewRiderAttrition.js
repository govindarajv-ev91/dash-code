import { addDays, addMonths, addWeeks, differenceInCalendarDays, eachDayOfInterval, endOfMonth, endOfWeek, format, getISOWeek, parseISO, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns'
import { toMetricDateKey } from './mergeRiderMetrics'
import { normalizeRiderIdKey } from './riderPerformanceReport'
import { clientLookupKey, normalizeSummaryClient } from './clientSummaryClients'
import { normalizeSummaryCity } from './citySummaryAliases'
import { lookupOverviewAttritionPhone, normalizeOverviewAttritionPhone } from './overviewAttritionContacts.js'

export const ATTRITION_INACTIVE_DAYS = 4
export const OVERVIEW_ATTRITION_RULES = {
  monthly: 'Worked in the previous calendar month, but has no orders in the comparison month.',
  weekly: 'Worked in the previous calendar week, but has no orders in the comparison week (Monday–Sunday).',
  daily: 'Four consecutive days without orders after the latest working date, with no later return to work.',
}
export const OVERVIEW_ATTRITION_PERCENTAGE_RULES = {
  monthly: 'Attrition % = attrited riders ÷ previous month’s working riders × 100.',
  weekly: 'Attrition % = attrited riders ÷ previous week’s working riders × 100.',
  daily: 'Attrition % = new daily attrition ÷ riders who worked four days earlier × 100.',
}

function addCohortRider(cohorts, date, row) {
  if (!cohorts.has(date)) cohorts.set(date, new Map())
  const scopes = cohorts.get(date)
  const key = JSON.stringify([row.client, row.city])
  if (!scopes.has(key)) scopes.set(key, { client: row.client, city: row.city, ev: 0, nonEv: 0, total: 0 })
  const cohort = scopes.get(key)
  cohort.total += 1
  cohort[row.isEv ? 'ev' : 'nonEv'] += 1
}

function periodLabel(date, period) {
  const parsed = parseISO(date)
  return period === 'monthly' ? format(parsed, 'MMM yyyy')
    : period === 'weekly' ? `Week ${getISOWeek(parsed)} · ${format(parsed, 'dd MMM yyyy')}`
      : format(parsed, 'dd MMM yyyy')
}

/** Build once for the complete activity history, before applying chart filters. */
export function buildOverviewAttritionIndex(rows = []) {
  const workingDays = new Map()
  const scopes = new Map()
  let latestDate = ''
  let firstDate = ''

  for (const row of rows || []) {
    const date = toMetricDateKey(row?.date_record)
    const rider = normalizeRiderIdKey(row?.worker_code)
    if (!date || !rider || row?._ic_only) continue
    if (date > latestDate) latestDate = date
    if (!firstDate || date < firstDate) firstDate = date
    const client = normalizeSummaryClient(row.client)
    const city = normalizeSummaryCity(row.city)
    const scopeKey = JSON.stringify([client, city])
    const previous = scopes.get(scopeKey)
    if (!previous) scopes.set(scopeKey, { client, city, firstDate: date, latestDate: date })
    else {
      if (date < previous.firstDate) previous.firstDate = date
      if (date > previous.latestDate) previous.latestDate = date
    }
    // Zero-order uploads establish coverage, but never establish working activity.
    const orders = Number(row.delivered ?? row.orders)
    if (!Number.isFinite(orders) || orders <= 0) continue
    const isEv = [row.type1, row.type2].some((value) => {
      const type = String(value || '').toUpperCase()
      return type.includes('EV') && !type.includes('NON')
    })
    if (!workingDays.has(rider)) workingDays.set(rider, new Map())
    const days = workingDays.get(rider)
    // Deduplicate each rider/day. Prefer the largest activity record when a
    // rider works in multiple scopes that day; stable ties ignore input order.
    const workerCode = String(row.worker_code).trim()
    const workerName = String(row.worker_name || '').trim()
    const tieKey = JSON.stringify([client, city, isEv, workerCode, workerName])
    const existing = days.get(date)
    if (!existing || orders > existing.orders || (orders === existing.orders && tieKey < existing.tieKey)) {
      days.set(date, {
        rider, workerCode, workerName,
        date, client, city, isEv, orders, tieKey,
      })
    }
  }

  const events = []
  const activity = { monthly: new Map(), weekly: new Map() }
  const riderCohorts = { monthly: new Map(), weekly: new Map(), daily: new Map() }
  const datePeriods = new Map()
  for (const days of workingDays.values()) {
    const history = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
    const workStartedDate = history[0].date
    for (const [position, day] of history.entries()) {
      addCohortRider(riderCohorts.daily, day.date, day)
      if (!datePeriods.has(day.date)) datePeriods.set(day.date, {
        monthly: `${day.date.slice(0, 7)}-01`, weekly: periodKey(parseISO(day.date), 'weekly'),
      })
      for (const period of ['monthly', 'weekly']) {
        const key = datePeriods.get(day.date)[period]
        if (!activity[period].has(key)) activity[period].set(key, new Map())
        activity[period].get(key).set(day.rider, { ...day, workStartedDate, nextWorkingDate: history[position + 1]?.date || '' })
      }
    }
    // Only the final working date can qualify. Every earlier absence ended
    // with a return to work, even if that return is outside the chart filters.
    const lastWork = history.at(-1)
    const date = format(addDays(parseISO(lastWork.date), ATTRITION_INACTIVE_DAYS), 'yyyy-MM-dd')
    if (date > latestDate) continue
    events.push({
      rider: lastWork.rider, workerCode: lastWork.workerCode, workerName: lastWork.workerName,
      date, workStartedDate, lastWorkingDate: lastWork.date, nextWorkingDate: '',
      client: lastWork.client, city: lastWork.city, isEv: lastWork.isEv,
    })
  }
  const periodEvents = { daily: events, monthly: [], weekly: [] }
  for (const period of ['monthly', 'weekly']) {
    for (const [previousDate, previousRiders] of activity[period]) {
      for (const rider of previousRiders.values()) addCohortRider(riderCohorts[period], previousDate, rider)
      const date = format(period === 'monthly' ? addMonths(parseISO(previousDate), 1) : addWeeks(parseISO(previousDate), 1), 'yyyy-MM-dd')
      if (date > latestDate) continue
      const currentRiders = activity[period].get(date)
      const calendarEnd = format(period === 'monthly' ? endOfMonth(parseISO(date)) : endOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const comparisonThrough = calendarEnd < latestDate ? calendarEnd : latestDate
      for (const lastWork of previousRiders.values()) {
        // Work anywhere in this comparison period prevents attrition. A
        // return in a later period does not erase a wholly missed month/week.
        if (currentRiders?.has(lastWork.rider)) continue
        periodEvents[period].push({
          rider: lastWork.rider, workerCode: lastWork.workerCode, workerName: lastWork.workerName,
          date, attritionDate: comparisonThrough, previousPeriod: periodLabel(previousDate, period),
          comparisonFrom: date, comparisonThrough, periodStatus: calendarEnd > latestDate ? 'In progress' : 'Complete',
          workStartedDate: lastWork.workStartedDate, lastWorkingDate: lastWork.date, nextWorkingDate: lastWork.nextWorkingDate,
          client: lastWork.client, city: lastWork.city, isEv: lastWork.isEv,
          inactiveDays: differenceInCalendarDays(parseISO(comparisonThrough), parseISO(lastWork.date)),
        })
      }
    }
  }
  return { events, periodEvents, riderCohorts, scopes: [...scopes.values()], firstDate, latestDate }
}

function periodKey(date, period) {
  if (period === 'monthly') return format(startOfMonth(date), 'yyyy-MM-dd')
  if (period === 'weekly') return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  return format(date, 'yyyy-MM-dd')
}

/** Month/week compare working cohorts; daily retains the four-day absence rule. */
export function buildOverviewAttritionSeries(
  index,
  { dateFrom = '', dateTo = '', client = 'All', city = 'All', period = 'monthly' } = {}
) {
  const { scopes = [], firstDate = '', latestDate = '' } = index || {}
  const events = index?.periodEvents?.[period] || []
  const maxDate = latestDate && dateTo ? (dateTo < latestDate ? dateTo : latestDate) : latestDate
  const minDate = dateFrom || (maxDate ? format(startOfMonth(subMonths(parseISO(maxDate), 8)), 'yyyy-MM-dd') : '')
  const minPeriod = minDate ? periodKey(parseISO(minDate), period) : ''
  const maxPeriod = maxDate ? periodKey(parseISO(maxDate), period) : ''
  const visibleScopes = scopes.filter((scope) => scope.latestDate >= minDate && scope.firstDate <= maxDate)
  visibleScopes.push(...events.filter((event) => event.date >= minPeriod && event.date <= maxPeriod))
  const clients = [...new Set(visibleScopes.map((scope) => scope.client))].sort().map((name) => ({ name }))
  const cities = [...new Set(visibleScopes.map((scope) => scope.city))].sort().map((name) => ({ name }))
  const result = { series: [], details: [], totals: { ev: 0, nonEv: 0, total: 0 }, clients, cities, dateFrom: minDate, asOfDate: maxDate, returnCheckThrough: latestDate, period, rule: OVERVIEW_ATTRITION_RULES[period], percentageRule: OVERVIEW_ATTRITION_PERCENTAGE_RULES[period] }
  if (!maxDate || minDate > maxDate || firstDate > maxDate) return result
  const hasScope = visibleScopes.some((scope) =>
    (client === 'All' || scope.client === client) && (city === 'All' || scope.city === city)) ||
    events.some((event) => event.date >= minPeriod && event.date <= maxPeriod &&
      (client === 'All' || event.client === client) && (city === 'All' || event.city === city))
  if (!hasScope) return result

  const buckets = new Map()
  for (const date of eachDayOfInterval({ start: parseISO(minDate), end: parseISO(maxDate) })) {
    const key = periodKey(date, period)
    if (!buckets.has(key)) buckets.set(key, new Map())
  }
  for (const event of events) {
    if (event.date < minPeriod || event.date > maxPeriod) continue
    if (client !== 'All' && event.client !== client) continue
    if (city !== 'All' && event.city !== city) continue
    const riders = buckets.get(periodKey(parseISO(event.date), period))
    riders.set(event.rider, event)
  }
  result.series = [...buckets].map(([date, riders]) => {
    const ev = [...riders.values()].filter((rider) => rider.isEv).length
    const total = riders.size
    const baseDate = format(period === 'monthly' ? subMonths(parseISO(date), 1)
      : subDays(parseISO(date), period === 'weekly' ? 7 : ATTRITION_INACTIVE_DAYS), 'yyyy-MM-dd')
    const base = { ev: 0, nonEv: 0, total: 0 }
    for (const cohort of index?.riderCohorts?.[period]?.get(baseDate)?.values() || []) {
      if (client !== 'All' && cohort.client !== client) continue
      if (city !== 'All' && cohort.city !== city) continue
      for (const type of ['ev', 'nonEv', 'total']) base[type] += cohort[type]
    }
    const calendarEnd = period === 'monthly' ? format(endOfMonth(parseISO(date)), 'yyyy-MM-dd')
      : period === 'weekly' ? format(endOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd') : date
    const point = {
      date,
      period: periodLabel(date, period),
      ev, nonEv: total - ev, total,
      basePeriod: periodLabel(baseDate, period),
      evRiderBase: base.ev, nonEvRiderBase: base.nonEv, totalRiderBase: base.total,
      evAttritionPercent: base.ev ? ev / base.ev * 100 : null,
      nonEvAttritionPercent: base.nonEv ? (total - ev) / base.nonEv * 100 : null,
      totalAttritionPercent: base.total ? total / base.total * 100 : null,
      periodStatus: calendarEnd > latestDate ? 'In progress' : 'Complete',
    }
    for (const event of [...riders.values()].sort((a, b) => a.rider.localeCompare(b.rider))) {
      result.details.push({
        period: point.period, periodDate: date, workerCode: event.workerCode, workerName: event.workerName,
        client: event.client, city: event.city, type: event.isEv ? 'EV' : 'Non-EV',
        workStartedDate: event.workStartedDate, lastWorkingDate: event.lastWorkingDate, attritionDate: event.attritionDate || event.date,
        inactiveDays: event.inactiveDays ?? ATTRITION_INACTIVE_DAYS,
        nextWorkingDate: event.nextWorkingDate || '', previousPeriod: event.previousPeriod || '',
        comparisonFrom: event.comparisonFrom || format(addDays(parseISO(event.lastWorkingDate), 1), 'yyyy-MM-dd'),
        comparisonThrough: event.comparisonThrough || event.date, periodStatus: event.periodStatus || 'Complete',
      })
    }
    result.totals.ev += point.ev
    result.totals.nonEv += point.nonEv
    result.totals.total += point.total
    return point
  })
  return result
}

/** Export-only check. Keep chart counts and the report itself unchanged. */
export function buildOverviewAttritionExportDetails(report, activityRows = [], phoneIndex) {
  const workByPhone = new Map()
  // Full activity history, before any client/city/date display filters. Different
  // rider IDs can belong to the same phone under different clients.
  for (const row of activityRows) {
    if (row?._ic_only || !normalizeRiderIdKey(row?.worker_code)) continue
    const orders = Number(row.delivered ?? row.orders)
    if (!Number.isFinite(orders) || orders <= 0) continue
    const phone = normalizeOverviewAttritionPhone(lookupOverviewAttritionPhone(phoneIndex, row.worker_code) || row.mob_number)
    if (!phone) continue
    const date = toMetricDateKey(row.date_record)
    if (!date) continue
    const clientName = normalizeSummaryClient(row.client)
    const client = clientLookupKey(clientName)
    if (!workByPhone.has(phone)) workByPhone.set(phone, new Map())
    const clients = workByPhone.get(phone)
    if (!clients.has(client)) clients.set(client, { name: clientName, dates: new Set() })
    clients.get(client).dates.add(date)
  }
  for (const clients of workByPhone.values()) {
    for (const activity of clients.values()) activity.dates = [...activity.dates].sort()
  }

  function workedInRange(dates, from, through) {
    let lo = 0, hi = dates.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (dates[mid] < from) lo = mid + 1
      else hi = mid
    }
    return lo < dates.length && dates[lo] <= through
  }

  const details = report.details.map((detail) => {
    const phone = normalizeOverviewAttritionPhone(lookupOverviewAttritionPhone(phoneIndex, detail.workerCode))
    const clients = workByPhone.get(phone)
    const from = detail.comparisonFrom
    // Daily attrition excludes later returns anywhere in loaded history. A
    // later month's/week's return does not erase a wholly missed period.
    const through = report.period === 'daily' ? report.returnCheckThrough : detail.comparisonThrough
    const ownClient = clientLookupKey(normalizeSummaryClient(detail.client))
    const otherWorkingClients = []
    if (clients && from && through && from <= through) {
      for (const [client, activity] of clients) {
        if (client !== ownClient && workedInRange(activity.dates, from, through)) otherWorkingClients.push(activity.name)
      }
    }
    return { ...detail, otherWorkingClients: otherWorkingClients.sort((a, b) => a.localeCompare(b)) }
  })
  return { details, otherClientCount: details.filter((detail) => detail.otherWorkingClients.length).length }
}
