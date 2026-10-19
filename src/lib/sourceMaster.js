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
