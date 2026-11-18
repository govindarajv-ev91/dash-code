import { normalizeRows, canonicalWeekInfo, payoutNumber } from './clientPeriodTrendReports.js'
import { normalizeSummaryCity } from './citySummaryAliases.js'
import { normalizeSummaryClient } from './clientSummaryClients.js'
import { buildOverviewAttritionPhoneIndex, lookupOverviewAttritionPhone, normalizeOverviewAttritionPhone } from './overviewAttritionContacts.js'

export const WHATSAPP_COLUMNS = ['Mobnumber', 'Rider ID', 'RiderName', 'Orders', 'COD_Deduction', 'Others', 'EVrent', 'FinalNetPayout']

export function paymentWeekKey(row) {
  return JSON.stringify([String(row.week ?? ''), row.month == null ? null : String(row.month)])
}

export function paymentWeekOptions(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!String(row.week ?? '').trim()) continue
    const value = paymentWeekKey(row)
    const previous = groups.get(value)
    const start = String(row.period_start || '')
    if (!previous || start > previous.start) groups.set(value, {
      value, label: `${row.week}${row.month ? ` · ${row.month}` : ''}`, start,
    })
  }
  return [...groups.values()].sort((a, b) => b.start.localeCompare(a.start) || b.label.localeCompare(a.label, undefined, { numeric: true }))
}

function mappingId(value) {
  return String(value || '').trim().toUpperCase().replace(/\.0+$/, '').replace(/[\s_-]+/g, '')
}

function mappingKey(riderId, client, city) {
  return JSON.stringify([mappingId(riderId), normalizeSummaryClient(client).toLowerCase(), normalizeSummaryCity(city).toLowerCase()])
}

function mappingClientName(value) {
  const text = String(value || '').trim()
  return /^(?:client name not found|unknown|n\/?a|null|none|not available|-+)$/i.test(text) ? '' : text
}

export function buildWhatsappMappingPhoneIndex(rows = []) {
  const index = new Map()
  for (const row of rows) {
    const phone = normalizeOverviewAttritionPhone(row.phoneNumber)
    if (!phone) continue
    const date = Date.parse(row.lastUpdated) || 0
    for (const id of [row.clientId, row.ev91RiderId]) {
      if (!mappingId(id)) continue
      const key = mappingKey(id, mappingClientName(row.clientName || row.ClientName), row.city || '')
      const previous = index.get(key)
      if (!previous || date > previous.date) index.set(key, { phone, date })
      else if (date === previous.date && phone !== previous.phone) previous.phone = ''
    }
  }
  return index
}

export function lookupWhatsappMappingPhone(index, row) {
  // A client ID may be reused by another client or city. Never match it by name.
  for (const [client, city] of [[row.client_name, row.city], [row.client_name, ''], ['', row.city], ['', '']]) {
    const found = index.get(mappingKey(row.rider_id, client, city))
    if (found) return found.phone
  }
  return ''
}

export function isPayoutDone(status) {
  return String(status || '').trim().toLowerCase() === 'released'
}

export function prepareWhatsappPayments(rows) {
  return rows.filter((row) => isPayoutDone(row.payment_status)).map((original) => {
    const row = original.period_start ? original : normalizeRows([original])[0] || original
    return {
      ...row,
      city: normalizeSummaryCity(row.city) || 'Unknown',
      client_name: String(row.client_name || '').trim() || 'Unknown',
      weekStart: canonicalWeekInfo(row).start,
    }
  })
}

export function buildWhatsappReport(rows, { week, paymentWeek = '', clients = null, cities = null, contacts = {} }) {
  const phones = buildOverviewAttritionPhoneIndex(contacts)
  const mappingPhones = buildWhatsappMappingPhoneIndex(contacts.mappingRows)
  const groups = new Map()
  for (const row of rows) {
    if ((paymentWeek ? paymentWeekKey(row) !== paymentWeek : (!week || row.weekStart !== week)) || !isPayoutDone(row.payment_status) ||
        (clients !== null && !clients.includes(row.client_name)) ||
        (cities !== null && !cities.includes(row.city))) continue
    // Keep different client/city payouts separate even when rider IDs are reused.
    const key = JSON.stringify([row.client_name, row.city, String(row.rider_id || '').trim().toUpperCase() || `row:${row.id}`])
    const phone = lookupOverviewAttritionPhone(phones, row.rider_id) || lookupWhatsappMappingPhone(mappingPhones, row)
    if (!groups.has(key)) groups.set(key, {
      Mobnumber: phone ? `91${phone}` : '',
      'Rider ID': String(row.rider_id || '').trim(),
      RiderName: String(row.rider_name || '').trim(),
      Orders: 0, COD_Deduction: 0, Others: 'NA', EVrent: 0, FinalNetPayout: 0,
    })
    const target = groups.get(key)
    target.Orders += payoutNumber(row.orders)
    target.COD_Deduction += payoutNumber(row.cod_deduction)
    target.EVrent += payoutNumber(row.ev_rent)
    target.FinalNetPayout += payoutNumber(row.final_net_payout)
  }
  return [...groups.values()].map((row) => Object.fromEntries(WHATSAPP_COLUMNS.map((key) =>
    [key, typeof row[key] === 'number' ? Math.round((row[key] + Number.EPSILON) * 100) / 100 : row[key]])))
    .sort((a, b) => a.RiderName.localeCompare(b.RiderName))
}
