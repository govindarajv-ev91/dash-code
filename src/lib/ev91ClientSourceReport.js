function grossPayoutNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value || '').replace(/[₹,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Monthly identities must not include the payment week or client. */
export function clientPeriodRiderKey(row, mode = 'weekly') {
  if (mode !== 'monthly') {
    return row.rider_key || `${row.client_name}|${row.period_label}|${row.rider_id || row.rider_name || row.id}`
  }
  const riderId = String(row.rider_id ?? '').trim()
  if (riderId) return `id:${riderId.toUpperCase()}`

  // Older payment rows can retain the ID only inside client|week|rider.
  const storedKey = String(row.rider_key ?? '').trim()
  const parts = storedKey.split('|')
  const storedId = parts.length >= 3 ? parts.slice(2).join('|').trim() : ''
  if (storedId) return `id:${storedId.toUpperCase()}`

  const name = String(row.rider_name ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (name) return `name:${String(row.client_name ?? '').trim().toUpperCase()}|${name}`
  return storedKey ? `key:${storedKey}` : `row:${row.id}`
}

/** Group payments once for both source revenue and unique rider counts. */
export function buildClientSourceReport(rows, { periods, matches, sourceForRow, periodForRow, mode = 'weekly' }) {
  const bySource = new Map()
  for (const row of rows) {
    if (!matches(row)) continue
    const period = periodForRow(row)
    const source = sourceForRow(row)
    if (!bySource.has(source)) bySource.set(source, new Map())
    const sourcePeriods = bySource.get(source)
    if (!sourcePeriods.has(period)) sourcePeriods.set(period, { riders: new Set(), revenue: 0 })
    const bucket = sourcePeriods.get(period)
    bucket.riders.add(clientPeriodRiderKey(row, mode))
    // Multiple payments to one rider contribute revenue while the rider is counted once.
    bucket.revenue += grossPayoutNumber(row.gross_payout)
  }

  const lastPeriod = periods.at(-1)
  const reportRows = (metric) => [...bySource.entries()].map(([source, values]) => ({
    source,
    values: Object.fromEntries([...values.entries()].map(([period, bucket]) =>
      [period, metric === 'riders' ? bucket.riders.size : bucket.revenue]
    )),
  })).sort((a, b) =>
    (b.values[lastPeriod] || 0) - (a.values[lastPeriod] || 0) || a.source.localeCompare(b.source)
  )
  const riderRows = reportRows('riders')
  const revenueRows = reportRows('revenue')
  const revenueTotals = Object.fromEntries(periods.map((period) =>
    [period, revenueRows.reduce((sum, row) => sum + (row.values[period] || 0), 0)]
  ))
  return { riderRows, revenueRows, revenueTotals }
}
