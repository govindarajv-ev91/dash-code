import { cityLookupKey, normalizeSummaryCity } from './citySummaryAliases'

export const CITY_MAIL_CONFIG_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSHj8-2m6CG_yHk83DHIfWNuTLL4sO0vqY2xuFGjiUwdyI0BYMhry9nDkQLezfqmfm25E73XoACm2GG/pub?gid=0&single=true&output=csv'

function parseCsvLine(row) {
  const parts = []
  let current = ''
  let inQuotes = false
  for (const char of row) {
    if (char === '"') inQuotes = !inQuotes
    else if (char === ',' && !inQuotes) {
      parts.push(current.trim())
      current = ''
    } else current += char
  }
  parts.push(current.trim().replace(/\r/g, ''))
  return parts
}

/** Parse city mail sheet: City, City Key, CC Mail Id, To */
export function parseCityMailConfigCsv(csv) {
  const cityKeyByLookup = new Map()
  const mailByCityKey = new Map()
  const sheetRows = []

  for (const row of (csv || '').split('\n').slice(1)) {
    if (!row.trim()) continue
    const parts = parseCsvLine(row)
    if (parts.length < 4) continue

    const city = parts[0].trim().replace(/\r/g, '')
    const cityKey = parts[1].trim().replace(/\r/g, '')
    const cc = parts[2].trim().replace(/\r/g, '')
    const to = parts.slice(3).join(',').trim().replace(/\r/g, '')
    if (!cityKey) continue

    sheetRows.push({ city, cityKey })

    const register = (name) => {
      if (!name) return
      cityKeyByLookup.set(cityLookupKey(name), cityKey)
      cityKeyByLookup.set(name.toLowerCase(), cityKey)
    }

    register(city)
    register(cityKey)
    register(normalizeSummaryCity(city))

    const keyLower = cityKey.toLowerCase()
    if (!mailByCityKey.has(keyLower)) {
      mailByCityKey.set(keyLower, { to, cc, cityKey })
    }
  }

  return { cityKeyByLookup, mailByCityKey, sheetRows }
}

/** Map rider_metrics city → sheet City Key. */
export function resolveCityKey(cityName, cityKeyByLookup) {
  if (!cityName) return 'Unknown'
  const canonical = normalizeSummaryCity(cityName)
  const lookups = [
    cityLookupKey(canonical),
    canonical.toLowerCase(),
    cityLookupKey(cityName),
    cityName.toLowerCase(),
  ]

  for (const lk of lookups) {
    const hit = cityKeyByLookup.get(lk)
    if (hit) return hit
  }

  return canonical !== 'Unknown' ? canonical : cityName
}

/** All metric city names that belong to a City Key (for scoped as-of date). */
export function citiesForCityKey(cityKey, sheetRows) {
  const target = cityKey.toLowerCase()
  const names = new Set()

  for (const { city, cityKey: rowKey } of sheetRows) {
    if (rowKey.toLowerCase() !== target) continue
    names.add(normalizeSummaryCity(city))
    names.add(city)
  }

  if (cityKey) {
    names.add(normalizeSummaryCity(cityKey))
    names.add(cityKey)
  }

  return [...names].filter((n) => n && n !== 'Unknown')
}

export function citiesForCityKeys(cityKeys, sheetRows) {
  const names = new Set()
  for (const key of cityKeys) {
    citiesForCityKey(key, sheetRows).forEach((n) => names.add(n))
  }
  return [...names]
}

export function getMailConfigForCityKey(cityKey, mailByCityKey) {
  if (!cityKey) return {}
  return mailByCityKey.get(cityKey.toLowerCase()) || {}
}

export function listCityKeyOptions(sheetRows, riderCityKeys = []) {
  const keys = new Set()
  sheetRows.forEach((r) => r.cityKey && keys.add(r.cityKey))
  riderCityKeys.forEach((k) => k && keys.add(k))
  return [...keys].sort((a, b) => a.localeCompare(b))
}

export function parseMailRecipients(...parts) {
  return parts
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e && e !== '<Email>')
    .join(',')
}

/**
 * Sheet layout: City, City Key, CC Mail Id, To.
 * To is often "<Email>" — city managers then live in CC Mail Id and must be primary To.
 */
export function resolveCityMailRecipients(config, { userCc = '', leadershipFallback = '' } = {}) {
  const sheetTo = parseMailRecipients(config?.to && config.to !== '<Email>' ? config.to : '')
  const sheetCc = parseMailRecipients(config?.cc && config.cc !== '<Email>' ? config.cc : '')
  const manualCc = parseMailRecipients(userCc)

  let to = sheetTo
  let cc = manualCc

  if (!to && sheetCc) {
    to = sheetCc
  } else if (to && sheetCc) {
    cc = parseMailRecipients(manualCc, sheetCc)
  }

  if (!to && leadershipFallback) {
    to = leadershipFallback
  }

  return { to, cc }
}
