import { clientLookupKey, normalizeSummaryClient } from './clientSummaryClients'
import { normalizeSummaryCity, cityLookupKey } from './citySummaryAliases'

/** Client-wise per-order rate (₹). */
const PER_ORDER_RATE_BY_KEY = {
  amazon: 40,
  'bb now': 47,
  bb: 47,
  bigbasket: 47,
  'big basket': 47,
  blinkit: 53,
  docpharma: 140,
  'doc pharma': 140,
  'flipkart minutes': 49,
  'flipkart-minutes': 49,
  fkm: 49,
  'flipkart-lma': 18,
  'fkm-lma': 18,
  inamo: 65,
  instamart: 49,
  swiggy: 49,
  'swiggy instamart': 49,
  kpn: 63,
  'kwik myntra': 82,
  'kwik nykaa': 80,
  'kwik purple': 47,
  licious: 56,
  'rapido ownly': 90,
  rsm: 64,
  zepto: 43,
}

/** Default MF margin as fraction (e.g. 0.08 = 8%). */
const MF_MARGIN_BY_KEY = {
  amazon: 0.08,
  bb: 0.05,
  'bb now': 0.05,
  bigbasket: 0.05,
  'big basket': 0.05,
  blinkit: 0.05,
  'flipkart-lma': 0.033,
  'fkm-lma': 0.033,
  'flipkart minutes': 0.06,
  'flipkart-minutes': 0.06,
  fkm: 0.06,
  kpn: 0.05,
  kwik: 0.055,
  'kwik myntra': 0.055,
  'kwik nykaa': 0.055,
  'kwik purple': 0.055,
  licious: 0.06,
  rsm: 0.06,
  zepto: 0.04,
  'rapido ownly': 0.05,
  inamo: 0.06,
  swiggy: 0.08,
  'swiggy instamart': 0.08,
  instamart: 0.08,
}

/** BB cities that use 6% MF instead of 5%. */
const BB_MF_6PCT_CITY_KEYS = new Set([
  'bengaluru',
  'bangalore',
  'blr',
  'chennai',
  'chn',
  'che',
  'madras',
  'hyderabad',
  'hyd',
  'mumbai',
  'mum',
  'bombay',
])

/** EV on-road rent ₹ per vehicle per day. */
export const EV_DAILY_RENT = 230

/** Display rows for the rates info panel (deduped canonical names). */
export const FULL_DATA_RATE_INFO = {
  rentPerDay: EV_DAILY_RENT,
  bbMfNote: 'BB / BB Now: 5% default; 6% for Bengaluru, Chennai, Hyderabad, Mumbai',
  perOrderRates: [
    { client: 'Amazon', rate: 40 },
    { client: 'BB Now', rate: 47 },
    { client: 'Blinkit', rate: 53 },
    { client: 'DocPharma', rate: 140 },
    { client: 'Flipkart Minutes', rate: 49 },
    { client: 'Flipkart-LMA', rate: 18 },
    { client: 'Inamo', rate: 65 },
    { client: 'Instamart / Swiggy', rate: 49 },
    { client: 'KPN', rate: 63 },
    { client: 'KWIK Myntra', rate: 82 },
    { client: 'KWIK Nykaa', rate: 80 },
    { client: 'KWIK Purple', rate: 47 },
    { client: 'Licious', rate: 56 },
    { client: 'Rapido Ownly', rate: 90 },
    { client: 'RSM', rate: 64 },
    { client: 'Zepto', rate: 43 },
  ],
  mfMargins: [
    { client: 'Amazon', marginPct: 8 },
    { client: 'BB / BB Now', marginPct: 5, note: '6% in BLR, CHN, HYD, MUM' },
    { client: 'Blinkit', marginPct: 5 },
    { client: 'Flipkart-LMA', marginPct: 3.3 },
    { client: 'Flipkart Minutes', marginPct: 6 },
    { client: 'KPN', marginPct: 5 },
    { client: 'KWIK', marginPct: 5.5 },
    { client: 'KWIK Myntra', marginPct: 5.5 },
    { client: 'KWIK Purple', marginPct: 5.5 },
    { client: 'Licious', marginPct: 6 },
    { client: 'RSM', marginPct: 6 },
    { client: 'Zepto', marginPct: 4 },
    { client: 'Rapido Ownly', marginPct: 5 },
    { client: 'Inamo', marginPct: 6 },
    { client: 'Swiggy / Instamart', marginPct: 8 },
  ],
}

function clientKey(client) {
  return clientLookupKey(normalizeSummaryClient(client))
}

function isBbClient(key) {
  return key === 'bb' || key === 'bb now' || key === 'bigbasket' || key === 'big basket'
}

export function getClientPerOrderRate(clientName) {
  const key = clientKey(clientName)
  if (PER_ORDER_RATE_BY_KEY[key] != null) return PER_ORDER_RATE_BY_KEY[key]
  // Prefix fallbacks (e.g. "KWIK Something")
  if (key.startsWith('kwik')) return PER_ORDER_RATE_BY_KEY[key] ?? null
  return null
}

/**
 * MF margin fraction for client (+ city override for BB).
 * Returns 0 when client has no configured margin.
 */
export function getClientMfMargin(clientName, cityName) {
  const key = clientKey(clientName)
  if (isBbClient(key)) {
    const cityKey = cityLookupKey(normalizeSummaryCity(cityName) || cityName)
    if (BB_MF_6PCT_CITY_KEYS.has(cityKey)) return 0.06
    return 0.05
  }
  if (MF_MARGIN_BY_KEY[key] != null) return MF_MARGIN_BY_KEY[key]
  if (key.startsWith('kwik')) return MF_MARGIN_BY_KEY.kwik
  return 0
}

/**
 * Earnings + MF for one order line.
 * @returns {{ earning: number, mf: number, rate: number, margin: number }}
 */
export function calcOrderEarningAndMf(clientName, cityName, delivered) {
  const qty = Number(delivered) || 0
  if (qty <= 0) return { earning: 0, mf: 0, rate: 0, margin: 0 }
  const rate = getClientPerOrderRate(clientName)
  if (rate == null) return { earning: 0, mf: 0, rate: 0, margin: 0 }
  const earning = qty * rate
  const margin = getClientMfMargin(clientName, cityName)
  const mf = earning * margin
  return { earning, mf, rate, margin }
}
