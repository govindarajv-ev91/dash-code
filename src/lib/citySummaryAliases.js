/** Lowercase key for city alias lookup. */
export function cityLookupKey(value) {
  return (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * Aliases → canonical city name (Client Summary, IC Deployed, fleet master).
 * Keys are lowercase normalized via cityLookupKey.
 */
const CITY_CANONICAL_BY_KEY = {
  // Bengaluru
  bengaluru: 'Bengaluru',
  bangalore: 'Bengaluru',
  bangaluru: 'Bengaluru',
  bengalore: 'Bengaluru',
  blr: 'Bengaluru',
  'bangalore urban': 'Bengaluru',

  // Chennai
  chennai: 'Chennai',
  chn: 'Chennai',
  madras: 'Chennai',

  // Hyderabad
  hyderabad: 'Hyderabad',
  hyd: 'Hyderabad',

  // Delhi NCR (fleet master uses "Delhi")
  delhi: 'Delhi',
  'new delhi': 'Delhi',
  del: 'Delhi',
  'delhi ncr': 'Delhi',
  ncr: 'Delhi',
  gurgaon: 'Delhi',
  gurugram: 'Delhi',
  'gurgaon ncr': 'Delhi',
  ghaziabad: 'Delhi',
  noida: 'Delhi',
  'greater noida': 'Delhi',

  // Mysuru
  mysuru: 'Mysuru',
  mysore: 'Mysuru',

  // Mumbai
  mumbai: 'Mumbai',
  bombay: 'Mumbai',
  bom: 'Mumbai',

  // Coimbatore
  coimbatore: 'Coimbatore',
  cbe: 'Coimbatore',
  cjb: 'Coimbatore',

  // Belagavi
  belagavi: 'Belagavi',
  belgavi: 'Belagavi',
  belgaum: 'Belagavi',

  // Other cities in rider_metrics
  warangal: 'Warangal',
  kochi: 'Kochi',
  cochin: 'Kochi',
  ernakulam: 'Kochi',
  pune: 'Pune',
  pnq: 'Pune',
  ahmedabad: 'Ahmedabad',
  amd: 'Ahmedabad',
  kolkata: 'Kolkata',
  calcutta: 'Kolkata',
  ccu: 'Kolkata',
  jaipur: 'Jaipur',
  jpr: 'Jaipur',
  lucknow: 'Lucknow',
  lko: 'Lucknow',
  visakhapatnam: 'Visakhapatnam',
  vizag: 'Visakhapatnam',
  vijayawada: 'Vijayawada',
  vga: 'Vijayawada',
  karimnagar: 'Karimnagar',
  khammam: 'Khammam',
  silvassa: 'Silvassa',
  mangaluru: 'Mangaluru',
  mangalore: 'Mangaluru',
  madurai: 'Madurai',
  puducherry: 'Puducherry',
  pondicherry: 'Puducherry',
  nellore: 'Nellore',
  shivamogga: 'Shivamogga',
  shimoga: 'Shivamogga',
  varanasi: 'Varanasi',
  indore: 'Indore',
  jabalpur: 'Jabalpur',
  dibrugarh: 'Dibrugarh',
  gujarat: 'Gujarat',
  kerala: 'Kerala',
}

/** Hub suffix codes (e.g. MogappairHub_CHN) → canonical city when city field is missing/wrong. */
const HUB_SUFFIX_TO_CITY = {
  BLR: 'Bengaluru',
  HYD: 'Hyderabad',
  DEL: 'Delhi',
  GGN: 'Delhi',
  CHN: 'Chennai',
  MUM: 'Mumbai',
  MYS: 'Mysuru',
  CJB: 'Coimbatore',
}

const INVALID_CITY_VALUES = new Set(['', '0', 'unknown', 'null', 'na', 'n/a'])

export function normalizeSummaryCity(value) {
  const trimmed = (value ?? '').toString().trim()
  if (!trimmed || INVALID_CITY_VALUES.has(trimmed.toLowerCase())) return 'Unknown'

  const canonical = CITY_CANONICAL_BY_KEY[cityLookupKey(trimmed)]
  return canonical || trimmed
}

/** Resolve city from rider_metrics row (city field + hub_name suffix fallback). */
export function resolveRiderCity(riderRow) {
  const rawCity = (riderRow?.city ?? '').toString().trim()
  if (rawCity && !INVALID_CITY_VALUES.has(rawCity.toLowerCase())) {
    return normalizeSummaryCity(rawCity)
  }

  const hub = (riderRow?.hub_name ?? '').toString()
  const suffix = hub.match(/_([A-Z]{2,4})$/)?.[1]
  if (suffix && HUB_SUFFIX_TO_CITY[suffix]) {
    return HUB_SUFFIX_TO_CITY[suffix]
  }

  return 'Unknown'
}

/** Match key for filters (canonical city, lowercased). */
export function normalizeCityKey(value) {
  const city = normalizeSummaryCity(value)
  if (city === 'Unknown') return ''
  return cityLookupKey(city)
}

export function citiesMatch(cityA, cityB) {
  return normalizeCityKey(cityA) === normalizeCityKey(cityB)
}

/** Unique canonical city names for dropdowns. */
export function dedupeCanonicalCities(cityNames) {
  const byKey = new Map()

  for (const name of cityNames || []) {
    if (!name || name === 'Unknown') continue
    const canonical = normalizeSummaryCity(name)
    if (canonical === 'Unknown') continue
    const key = normalizeCityKey(canonical)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, canonical)
  }

  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}
