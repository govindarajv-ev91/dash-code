import { normalizeCityKey } from './citySummaryAliases.js'

// Ignore casing and spacing from uploaded sheets, while preserving punctuation.
export function sourceMasterNameKey(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase()
}

export function buildSourceMasterIndex(rows) {
  const index = new Set()
  for (const row of rows || []) {
    if (row.is_active !== true) continue
    const city = normalizeCityKey(row.city)
    const source = sourceMasterNameKey(row.source_name)
    if (city && source) index.add(`${city}\t${source}`)
  }
  return index
}

export function isListedSource(index, city, source) {
  return index.has(`${normalizeCityKey(city)}\t${sourceMasterNameKey(source)}`)
}

/** Include inactive sources to resolve historical audit rows as well. */
export function buildSourceMasterEmailIndex(rows = []) {
  const index = new Map()
  const add = (key, name) => {
    if (!index.has(key)) index.set(key, name)
    else if (sourceMasterNameKey(index.get(key)) !== sourceMasterNameKey(name)) index.set(key, '')
  }
  for (const row of rows || []) {
    const email = String(row.email_id || '').trim().toLowerCase()
    const name = String(row.source_name || '').trim()
    if (!email || !name) continue
    const city = normalizeCityKey(row.city)
    if (city) add(`${city}\t${email}`, name)
    add(`\t${email}`, name)
  }
  return index
}

/** Prefer the row's city; use a global match only when its source is unambiguous. */
export function lookupSourceMasterNameByEmail(index, email, city) {
  if (!index) return ''
  const key = String(email || '').trim().toLowerCase()
  if (!key) return ''
  const cityKey = `${normalizeCityKey(city)}\t${key}`
  if (index.has(cityKey)) return index.get(cityKey)
  return index.get(`\t${key}`) || ''
}
