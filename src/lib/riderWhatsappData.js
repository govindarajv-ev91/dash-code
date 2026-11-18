import { supabase } from './supabaseClient'
import { fetchAllData, readSupabasePage } from './supabaseFetch'
import { FLEET_LEGACY_TABLE, FLEET_FORM_TABLE, FLEET_RIDER_LOOKUP_COLUMNS } from './fleetDataConfig'
import { buildOverviewAttritionPhoneIndex, lookupOverviewAttritionPhone } from './overviewAttritionContacts'
import { prepareWhatsappPayments, paymentWeekOptions } from './riderWhatsappReport'
import { fetchAllEv91MisData } from './ev91MisApi'

const PAYMENT_COLUMNS = 'id,period_start,week,month,rider_id,rider_name,client_name,city,payment_status,orders,cod_deduction,ev_rent,final_net_payout'

export async function loadWhatsappWeekOptions({ signal } = {}) {
  const rows = []
  let offset = 0
  while (true) {
    const query = supabase.rpc('rider_whatsapp_payment_weeks').order('week').order('month').range(offset, offset + 499)
    let response
    try {
      response = await readSupabasePage(query, 'payment weeks', 15000, signal)
    } catch (error) {
      if (signal?.aborted || !['REQUEST_TIMEOUT', '57014'].includes(error.code)) throw error
      response = { error }
    }
    const { data, error } = response
    if (error) {
      const functionDenied = /permission denied for function\s+(?:public\.)?rider_whatsapp_payment_weeks/i.test(error.message || '')
      if (!['PGRST202', '42883', '57014', 'REQUEST_TIMEOUT'].includes(error.code) && !functionDenied) throw error
      // Older installations may lack the function or its execution grant.
      // Direct reads still enforce the caller's table permissions and RLS.
      const fallback = await fetchAllData('rider_payment_data', 'id,week,month,period_start', 'id', {
        useKeyset: true, untilEmpty: true, throwOnError: true, requestTimeoutMs: 15000, maxRetries: 1, signal,
      })
      return paymentWeekOptions(fallback.data)
    }
    if (!data?.length) return paymentWeekOptions(rows)
    rows.push(...data)
    offset += data.length
  }
}

async function loadWeekPayments({ paymentWeek, month }, signal) {
  const rows = []
  let cursor = null
  while (true) {
    let query = supabase.from('rider_payment_data').select(PAYMENT_COLUMNS)
      .eq('week', paymentWeek).order('id', { ascending: true }).limit(500)
    query = month == null ? query.is('month', null) : query.eq('month', month)
    if (cursor) query = query.gt('id', cursor.id)
    const { data, error } = await readSupabasePage(query, 'selected week payments', 15000, signal)
    if (error) throw error
    if (!data?.length) return rows
    const last = data.at(-1)
    if (!/^\d+$/.test(String(last.id)) || (cursor && BigInt(last.id) <= BigInt(cursor.id))) {
      throw new Error('Unable to read all selected week payments. Please retry.')
    }
    rows.push(...data)
    cursor = last
  }
}

async function fetchContactBatches(table, columns, riderIds, signal, onboarding = false) {
  const rows = []
  const batches = []
  for (let index = 0; index < riderIds.length; index += 100) batches.push(riderIds.slice(index, index + 100))
  let next = 0
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (next < batches.length) {
      const ids = batches[next++]
      const options = { useKeyset: true, untilEmpty: true, throwOnError: true, maxRetries: 1, requestTimeoutMs: 15000, signal }
      const result = await fetchAllData(table, columns, 'id', {
        ...options, queryModifier: (query) => query.in(onboarding ? 'rider_id_details' : 'rider_id', ids),
      })
      rows.push(...result.data)
      if (onboarding) {
        const merged = await fetchAllData(table, columns, 'id', {
          ...options, queryModifier: (query) => query.in('merge', ids.map((id) => `voice${id}`)),
        })
        rows.push(...merged.data)
      }
    }
  }))
  return rows
}

export async function loadWhatsappPaymentData({ week, signal } = {}) {
  let selection
  try { selection = JSON.parse(week) } catch { /* Validated below. */ }
  if (!Array.isArray(selection) || selection.length !== 2 || typeof selection[0] !== 'string' || !selection[0].trim() ||
      (selection[1] !== null && typeof selection[1] !== 'string')) throw new Error('Select a valid payment week before loading payments.')
  const payments = await loadWeekPayments({ paymentWeek: selection[0], month: selection[1] }, signal)
  const ids = [...new Set(prepareWhatsappPayments(payments).map((row) => String(row.rider_id || '').trim()).filter(Boolean))]
  const onboardingRows = await fetchContactBatches('rider_onboarding', 'id,rider_id_details,merge,rider_mobile_number', ids, signal, true)
  const phoneIndex = buildOverviewAttritionPhoneIndex({ onboardingRows })
  const missingIds = ids.filter((id) => !lookupOverviewAttritionPhone(phoneIndex, id))
  const [fleetRows, newFleetRows] = await Promise.all([
    fetchContactBatches(FLEET_LEGACY_TABLE, FLEET_RIDER_LOOKUP_COLUMNS, missingIds, signal),
    fetchContactBatches(FLEET_FORM_TABLE, FLEET_RIDER_LOOKUP_COLUMNS, missingIds, signal),
  ])
  const contacts = { onboardingRows, fleetRows, newFleetRows, mappingRows: [] }
  const allPhones = buildOverviewAttritionPhoneIndex(contacts)
  let warning = ''
  if (ids.some((id) => !lookupOverviewAttritionPhone(allPhones, id))) {
    if (signal?.aborted) throw signal.reason
    try {
      const mapping = await fetchAllEv91MisData('client-mapping-history')
      if (signal?.aborted) throw signal.reason
      contacts.mappingRows = mapping.data || []
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      warning = `Client Mapping History phone lookup failed: ${error?.message || 'Please retry.'} Some phone numbers may be missing.`
    }
  }
  return { payments, contacts, warning }
}
