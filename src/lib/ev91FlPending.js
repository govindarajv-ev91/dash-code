import { differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns'
import { normalizeSummaryCity } from './citySummaryAliases'
import { clientLookupKey, normalizeSummaryClient } from './clientSummaryClients'
import { toMetricDateKey } from './mergeRiderMetrics'
import { normalizeRiderIdKey, riderIdLookupKeys } from './riderPerformanceReport'
import { buildClientMappingIndex, lookupClientMapping } from './ev91OnboardingPending'
import { isMissingSourceName } from './onboardingSourceLookup'

export const FL_PENDING_COLUMNS = [
  { key: 'clientId', label: 'Client ID (Order)' },
  { key: 'ev91RiderId', label: 'EV91 ID' },
  { key: 'workerName', label: 'Rider Name' },
  { key: 'city', label: 'City' },
  { key: 'client', label: 'Client' },
  { key: 'sourceName', label: 'Source Name' },
  { key: 'status', label: 'FL Status' },
  { key: 'firstOrderDate', label: 'Order Start Date' },
  { key: 'lastWorkingDate', label: 'LWD' },
  { key: 'agingDays', label: 'Aging (Days)' },
  { key: 'inactiveDays', label: 'Days Since LWD' },
  { key: 'totalOrders', label: 'Total Orders' },
  { key: 'orderDays', label: 'Working Days' },
  { key: 'mobile', label: 'Phone' },
]

export const FL_PENDING_EXPORT_COLUMNS = [
  ...FL_PENDING_COLUMNS,
  { key: 'ev91ReferredBy', label: 'Source / Referred By' },
]

function text(...values) {
  return values.map((value) => String(value ?? '').trim()).find((value) => !isMissingSourceName(value)) || ''
}

function riderKey(value) {
  const normalized = normalizeRiderIdKey(value)
  const fe = normalized.match(/^(?:FE)?(\d{5,})$/)
  return fe ? fe[1] : normalized
}

function indexOnboarding(rows) {
  const index = new Map()
  for (const row of rows || []) {
    const entry = {
      sourceName: text(row.source_name),
      workerName: text(row.rider_name, row.worker_name, row.name),
      mobile: text(row.rider_mobile_number, row.mobile, row.phone, row.mob_number),
    }
    const aliases = new Set()
    for (const id of [row.rider_id_details, row.rider_id, row.worker_code, row.client_rider_id, row.merge]) {
      for (const alias of riderIdLookupKeys(id)) aliases.add(alias)
    }
    const previous = [...aliases].map((alias) => index.get(alias)).filter(Boolean)
    for (const field of ['sourceName', 'workerName', 'mobile']) {
      entry[field] = previous.find((item) => item[field])?.[field] || entry[field]
    }
    for (const prev of previous) Object.assign(prev, entry)
    for (const alias of aliases) index.set(alias, entry)
  }
  return index
}

function indexRiderDetails(rows) {
  const byPublic = new Map(), byClient = new Map()
  for (const row of rows || []) {
    const publicId = text(row.publicRiderID, row.publicRiderId)
    if (publicId) byPublic.set(normalizeRiderIdKey(publicId), row)
    for (const alias of riderIdLookupKeys(row.clientRiderId || row.clientId)) {
      // A conflicting public ID needs a mapping to disambiguate it.
      const prev = byClient.get(alias)
      if (prev === null) continue
      if (prev && text(prev.publicRiderID, prev.publicRiderId) !== publicId) byClient.set(alias, null)
      else byClient.set(alias, row)
    }
  }
  return { byPublic, byClient }
}

/** Client IDs remain separate across cities/clients so each group's orders reconcile. */
export function buildEv91FlPendingRows(orderRows = [], mappingRows = [], onboardingRows = [], riderDetails = [], asOfDate = new Date()) {
  const asOf = startOfDay(asOfDate)
  const asOfKey = format(asOf, 'yyyy-MM-dd')
  const onboardingIndex = indexOnboarding(onboardingRows)
  const detailsIndex = indexRiderDetails(riderDetails)
  const mappingGroups = new Map()
  for (const row of mappingRows || []) {
    const clientKey = clientLookupKey(normalizeSummaryClient(row.clientName || row.ClientName))
    if (!mappingGroups.has(clientKey)) mappingGroups.set(clientKey, [])
    mappingGroups.get(clientKey).push(row)
  }
  const mappingIndexes = new Map([...mappingGroups].map(([key, rows]) => [key, buildClientMappingIndex(rows)]))
  const riders = new Map()
  for (const row of orderRows || []) {
    if (row._ic_only) continue
    const clientId = text(row.worker_code)
    if (!clientId) continue
    const dateKey = toMetricDateKey(row.date_record)
    if (dateKey && dateKey > asOfKey) continue
    const city = normalizeSummaryCity(row.city)
    const client = normalizeSummaryClient(row.client)
    const key = JSON.stringify([riderKey(clientId), city, clientLookupKey(client)])
    if (!riders.has(key)) riders.set(key, {
      key, clientId, city, client, workerName: '', mobile: '', totalOrders: 0, byDate: new Map(),
    })
    const rider = riders.get(key)
    const delivered = Number(row.delivered)
    const orders = Number.isFinite(delivered) ? delivered : 0
    rider.totalOrders += orders
    if (dateKey) rider.byDate.set(dateKey, (rider.byDate.get(dateKey) || 0) + orders)
    // Names and contacts from the latest order row when supplied.
    if (!rider.contactDate || (dateKey && dateKey >= rider.contactDate)) {
      rider.workerName = text(row.worker_name) || rider.workerName
      rider.mobile = text(row.mob_number) || rider.mobile
      rider.contactDate = dateKey
    }
    if (/^FE/i.test(clientId)) rider.clientId = clientId
  }

  const rows = []
  for (const rider of riders.values()) {
    const mapping = lookupClientMapping(mappingIndexes.get(clientLookupKey(rider.client)), rider.clientId)
      || lookupClientMapping(mappingIndexes.get('unknown'), rider.clientId)
    const mappedEv91Id = text(mapping?.ev91RiderId)
    const detail = (mappedEv91Id ? detailsIndex.byPublic.get(normalizeRiderIdKey(mappedEv91Id)) : null)
      || lookupClientMapping(detailsIndex.byClient, rider.clientId)
    const ev91RiderId = mappedEv91Id || text(detail?.publicRiderID, detail?.publicRiderId)
    const ev91Detail = ev91RiderId ? detailsIndex.byPublic.get(normalizeRiderIdKey(ev91RiderId)) : null
    const onboarding = lookupClientMapping(onboardingIndex, rider.clientId)
    const dates = [...rider.byDate].filter(([, orders]) => orders > 0).map(([date]) => date).sort()
    const firstOrderDate = dates[0] || ''
    const lastWorkingDate = dates.at(-1) || ''
    rows.push({
      key: rider.key,
      clientId: rider.clientId,
      ev91RiderId,
      ev91ReferredBy: text(ev91Detail?.referredById),
      workerName: onboarding?.workerName || text(detail?.name, detail?.riderName) || rider.workerName,
      mobile: onboarding?.mobile || text(detail?.phone) || rider.mobile || text(mapping?.phoneNumber),
      city: rider.city,
      client: rider.client,
      sourceName: onboarding?.sourceName || '',
      status: !onboarding ? 'Client ID not in onboarding' : !onboarding.sourceName ? 'Source name missing' : 'FL Complete',
      pending: !onboarding || !onboarding.sourceName,
      firstOrderDate,
      lastWorkingDate,
      agingDays: firstOrderDate ? Math.max(0, differenceInCalendarDays(asOf, parseISO(firstOrderDate))) : null,
      inactiveDays: lastWorkingDate ? Math.max(0, differenceInCalendarDays(asOf, parseISO(lastWorkingDate))) : null,
      totalOrders: rider.totalOrders,
      orderDays: dates.length,
    })
  }
  return rows.sort((a, b) => b.pending - a.pending || (b.agingDays ?? -1) - (a.agingDays ?? -1)
    || a.city.localeCompare(b.city) || a.clientId.localeCompare(b.clientId))
}

export function filterEv91FlPendingRows(rows, { city = 'All', client = 'All', status = 'pending', search = '' } = {}) {
  const query = search.trim().toLowerCase()
  return rows.filter((row) => (city === 'All' || row.city === city)
    && (client === 'All' || clientLookupKey(row.client) === clientLookupKey(client))
    && (status === 'All' || (status === 'pending' ? row.pending : row.status === status))
    && (!query || [row.clientId, row.ev91RiderId, row.workerName, row.mobile, row.sourceName, row.city, row.client, row.status]
      .join(' ').toLowerCase().includes(query)))
}

export function summarizeEv91FlPendingRows(rows = []) {
  const groups = new Map()
  for (const row of rows) {
    const key = JSON.stringify([row.city, clientLookupKey(row.client)])
    if (!groups.has(key)) groups.set(key, { City: row.city, Client: row.client, Riders: 0,
      'FL Pending': 0, 'Client ID not in onboarding': 0, 'Source name missing': 0, 'Total Orders': 0 })
    const group = groups.get(key)
    group.Riders += 1
    group['FL Pending'] += Number(row.pending)
    if (row.pending) group[row.status] += 1
    group['Total Orders'] += row.totalOrders
  }
  return [...groups.values()].sort((a, b) => a.City.localeCompare(b.City) || a.Client.localeCompare(b.Client))
}

export function flPendingExportRows(rows) {
  return rows.map((row) => Object.fromEntries(FL_PENDING_EXPORT_COLUMNS.map(({ key, label }) => [label, row[key] ?? ''])))
}
