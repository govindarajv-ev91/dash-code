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
