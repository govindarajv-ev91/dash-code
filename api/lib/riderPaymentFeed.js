const MIS_BASE = 'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics'
export const PAYMENT_FIELDS = 'id,rider_id,rider_name,client_name,week,month,gross_payout,cod_deduction,damage,traffic,ev_rent,final_net_payout'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const idKey = (value) => String(value ?? '').trim().toUpperCase().replace(/[_\s-]+/g, '-')
const clientKey = (value) => {
  const key = String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (['bb', 'bb now', 'bbnow', 'bigbasket', 'big basket'].includes(key)) return 'bb'
  if (['blinkit', 'blinket', 'binkit'].includes(key)) return 'blinkit'
  if (['fkm lma', 'flipkart lma'].includes(key)) return 'flipkart lma'
  if (['swiggy', 'swiggy instamart', 'instamart'].includes(key)) return 'swiggy instamart'
  return key
}

export function paymentMonthWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year').value)
  const month = Number(parts.find((part) => part.type === 'month').value)
  return [new Date(Date.UTC(year, month - 2, 1)), new Date(Date.UTC(year, month - 1, 1))]
    .map((date) => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1,
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` }))
}

function monthLabels(window) {
  return [...new Set(window.flatMap(({ year, month, key }) => {
    const name = MONTHS[month - 1]
    return [key, `${name}-${year}`, `${name} ${year}`, `${name}-${String(year).slice(-2)}`, `${name} ${String(year).slice(-2)}`]
      .flatMap((value) => [value, value.toLowerCase(), value.toUpperCase()])
  }))]
}

function aliases(value) {
  const raw = String(value ?? '').trim()
  const normalized = idKey(raw).replace(/^(\d+)\.0+$/, '$1')
  const values = new Set([raw, normalized, normalized.toLowerCase(), normalized.replace(/-/g, '_')])
  // Only the established FE alias is allowed; never strip digits from an EV91 ID.
  const fe = normalized.match(/^FE(\d{5,})$/)
  if (fe) values.add(fe[1])
  if (/^\d{5,}$/.test(normalized)) values.add(`FE${normalized}`)
  return [...values].filter(Boolean)
}

function sameId(a, b) {
  const keys = new Set(aliases(a).map(idKey))
  return aliases(b).some((value) => keys.has(idKey(value)))
}

async function fetchMappings(endpoint, riderId, fetchImpl, misApiKey) {
  const all = []
  let offset = 0
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ search: riderId, limit: '500', offset: String(offset) })
    const response = await fetchImpl(`${MIS_BASE}/${endpoint}?${params}`, {
      headers: { 'x-api-key': misApiKey, Accept: 'application/json' },
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    })
    const body = await response.json()
    if (!response.ok || !body || body.success === false) throw new Error('Rider mapping service is unavailable.')
    const rows = body.data || body.rows
    if (!Array.isArray(rows)) throw new Error('Invalid rider mapping response.')
    all.push(...rows.filter((row) => idKey(row.ev91RiderId) === idKey(riderId)))
    offset += rows.length
    const pagination = body.pagination || {}
    if (!rows.length || pagination.hasMore === false || (Number.isFinite(pagination.total) && offset >= pagination.total)) return all
  }
  throw new Error('Rider mapping pagination did not finish.')
}

export async function fetchRiderPaymentFeed({ riderId, supabase, fetchImpl = fetch, now = new Date(),
  misApiKey = globalThis.process?.env?.EV91_MIS_API_KEY || globalThis.process?.env?.VITE_EV91_MIS_API_KEY || 'ev91-mis-public-2026' }) {
  const window = paymentMonthWindow(now)
  const [overall, mapping] = await Promise.all([
    fetchMappings('overall-status', riderId, fetchImpl, misApiKey),
    fetchMappings('client-mapping-history', riderId, fetchImpl, misApiKey),
  ])
  const identities = [...mapping, ...overall].map((row) => ({
    clientId: String(row.clientId || row.clientRiderId || '').trim(),
    clientName: String(row.clientName || '').trim(),
    riderName: String(row.riderName || row.name || '').trim(),
  }))
  const ids = [...new Set([riderId, ...identities.map((row) => row.clientId)].flatMap(aliases))]
  if (ids.length > 500) throw new Error('Too many rider mappings to resolve safely.')
  const rows = []
  let cursor = null
  while (true) {
    let query = supabase.from('rider_payment_data').select(PAYMENT_FIELDS)
      .in('rider_id', ids).in('month', monthLabels(window)).order('id', { ascending: true }).limit(500)
    if (cursor != null) query = query.gt('id', cursor)
    const { data, error } = await query.abortSignal(AbortSignal.timeout(15000))
    if (error) throw new Error('Payment data is unavailable.')
    if (!Array.isArray(data)) throw new Error('Invalid payment response.')
    if (!data.length) break
    const next = String(data.at(-1).id ?? '')
    if (!/^\d+$/.test(next) || (cursor != null && BigInt(next) <= BigInt(cursor))) throw new Error('Payment pagination did not advance.')
    cursor = next
    rows.push(...data)
  }
  const money = (value) => value == null || value === '' ? 0 : Number(value)
  const data = rows.flatMap((row) => {
    const direct = idKey(row.rider_id) === idKey(riderId)
    const matches = identities.filter((identity) => sameId(identity.clientId, row.rider_id) &&
      (!identity.clientName || clientKey(identity.clientName) === clientKey(row.client_name)))
    if (!direct && !matches.length) return []
    const clientIds = [...new Set((direct ? identities.filter((identity) => identity.clientName && clientKey(identity.clientName) === clientKey(row.client_name)) : matches).map((identity) => identity.clientId).filter(Boolean))]
    const amounts = Object.fromEntries(['gross_payout', 'cod_deduction', 'damage', 'traffic', 'ev_rent', 'final_net_payout'].map((key) => [key, money(row[key])]))
    if (Object.values(amounts).some((value) => !Number.isFinite(value))) throw new Error('Invalid payment amount.')
    return [{ id: String(row.id), ev91_id: riderId,
      rider_name: String(row.rider_name || matches.find((identity) => identity.riderName)?.riderName || ''),
      client_id: clientIds.length === 1 ? clientIds[0] : direct ? null : String(row.rider_id),
      client_name: row.client_name || '', week: row.week, month: row.month, ...amounts }]
  })
  return { success: true, ev91_id: riderId, timezone: 'Asia/Kolkata', months: window.map((month) => month.key), count: data.length, data }
}
