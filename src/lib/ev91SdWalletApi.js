export const EV91_SD_WALLET_COLUMNS = [
  { key: 'public_rider_id', label: 'PublicRiderId' },
  { key: 'city', label: 'City' },
  { key: 'client_name', label: 'ClientName' },
  { key: 'client_rider_id', label: 'ClientRiderId' },
  { key: 'total_sd', label: 'TotalSd', amount: true },
  { key: 'pending_sd', label: 'PendingSd', amount: true },
  { key: 'fixed_deposit', label: 'FixedDeposit', amount: true },
]

const CACHE_MS = 5 * 60 * 1000
let cachedWallet = null
let inflight = null

export function getCachedEv91SdWallet() {
  return cachedWallet
}

export async function parseEv91SdWallet(buffer) {
  const [XLSX, { parseEv91SdFile }] = await Promise.all([
    import('xlsx'), import('./paymentUploadParse.js'),
  ])
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('EV91 SD wallet contains no worksheet.')
  const cells = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  const normalize = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '')
  const headers = new Set((cells[0] || []).map(normalize))
  const missing = EV91_SD_WALLET_COLUMNS.filter(({ label }) => !headers.has(normalize(label)))
  if (missing.length) throw new Error(`EV91 SD wallet is missing columns: ${missing.map(({ label }) => label).join(', ')}.`)
  const { rows } = parseEv91SdFile(buffer)
  const rawCount = XLSX.utils.sheet_to_json(sheet, { defval: '' }).length
  if (rows.length !== rawCount || rows.some((row) =>
    (!row.public_rider_id && !row.client_rider_id) ||
    EV91_SD_WALLET_COLUMNS.some(({ key, amount }) => amount && !Number.isFinite(row[key]))
  )) throw new Error('EV91 SD wallet contains invalid rider IDs or SD amounts. Please retry or check the export.')
  return rows
}

export async function fetchEv91SdWallet({ force = false } = {}) {
  if (inflight) return inflight
  if (!force && cachedWallet && Date.now() - cachedWallet.loadedAt < CACHE_MS) return cachedWallet
  inflight = (async () => {
    const response = await fetch('/api/ev91-sd-wallet', {
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      cache: 'no-store', signal: AbortSignal.timeout(35000),
    })
    const type = (response.headers.get('content-type') || '').toLowerCase()
    if (!response.ok) {
      const body = type.includes('json') ? await response.json().catch(() => null) : null
      throw new Error(body?.message || `Unable to load EV91 SD wallet (HTTP ${response.status}).`)
    }
    if (!type.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
      throw new Error('EV91 SD data is unavailable. Check that the /api/ev91-sd-wallet hosting route is configured before the dashboard fallback.')
    }
    const rows = await parseEv91SdWallet(await response.arrayBuffer())
    cachedWallet = { rows, loadedAt: Date.now() }
    return cachedWallet
  })().finally(() => { inflight = null })
  return inflight
}

export async function buildEv91SdWalletWorkbook(rows) {
  const XLSX = await import('xlsx')
  const data = rows.map((row) => Object.fromEntries(EV91_SD_WALLET_COLUMNS.map(({ key, label }) => [label, row[key]])))
  const sheet = XLSX.utils.json_to_sheet(data, { header: EV91_SD_WALLET_COLUMNS.map(({ label }) => label) })
  sheet['!cols'] = EV91_SD_WALLET_COLUMNS.map(({ amount }) => ({ wch: amount ? 18 : 24 }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'EV91 SD')
  return workbook
}

export async function downloadEv91SdWallet(rows) {
  const XLSX = await import('xlsx')
  const workbook = await buildEv91SdWalletWorkbook(rows)
  XLSX.writeFile(workbook, 'ev91-sd-wallet.xlsx')
}
