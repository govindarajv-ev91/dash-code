/** Case-insensitive lookup key for client names. */
export function clientLookupKey(value) {
  return (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/\s+/g, ' ')
}

/** Aliases → canonical client name for Client Summary pivot. */
const CLIENT_CANONICAL_BY_KEY = {
  'fkm-lma': 'Flipkart-LMA',
  'flipkart-lma': 'Flipkart-LMA',
  'fkm': 'Flipkart-Minutes',
  'flipkart-minutes': 'Flipkart-Minutes',
  'doc pharma': 'Doc Pharma',
  'inamo': 'INAMO',
  swiggy: 'Swiggy Instamart',
  'swiggy instamart': 'Swiggy Instamart',
}

/** Hidden by default on Client Summary — click + to show columns. */
export const HIDDEN_SUMMARY_CLIENT_KEYS = new Set([
  'in-house ev91',
  'kwik',
  'kuik',
  'rapido-gmv',
  'rental model',
  'rental_model',
  'rd',
  'rapido',
])

export function normalizeSummaryClient(value) {
  const trimmed = (value ?? '').toString().trim()
  if (!trimmed) return 'Unknown'

  const canonical = CLIENT_CANONICAL_BY_KEY[clientLookupKey(trimmed)]
  return canonical || trimmed
}

/** Prefer Title/mixed case over all-lowercase when merging duplicates. */
function preferClientLabel(candidate, existing) {
  const score = (s) => {
    if (!s) return -1
    if (s === s.toLowerCase()) return 0
    if (s === s.toUpperCase()) return 1
    return 2
  }
  return score(candidate) > score(existing)
}

/** Unique client names for dropdowns (case-insensitive; e.g. Blinkit + blinkit → one). */
export function dedupeCanonicalClients(clientNames) {
  const byKey = new Map()

  for (const name of clientNames || []) {
    const trimmed = (name ?? '').toString().trim()
    if (!trimmed) continue
    const display = normalizeSummaryClient(trimmed)
    if (!display || display === 'Unknown') continue
    const key = clientLookupKey(display)
    if (!key) continue
    const existing = byKey.get(key)
    if (!existing || preferClientLabel(display, existing)) {
      byKey.set(key, display)
    }
  }

  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

export function isHiddenSummaryClient(clientName) {
  const key = clientLookupKey(normalizeSummaryClient(clientName))
  return HIDDEN_SUMMARY_CLIENT_KEYS.has(key)
}

export function splitSummaryClients(clients) {
  const visible = []
  const hidden = []

  for (const row of clients || []) {
    if (isHiddenSummaryClient(row.client)) hidden.push(row)
    else visible.push(row)
  }

  return { visibleClients: visible, hiddenClients: hidden }
}
