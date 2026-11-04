import { createClient } from '@supabase/supabase-js'
import { createServer, loadEnv } from 'vite'

// Read-only diagnostics: print only month coverage, counts, and timings.
const env = loadEnv('development', process.cwd(), '')
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })
const old = await client.rpc('rider_payment_revenue_overview').abortSignal(AbortSignal.timeout(15000))
console.log(JSON.stringify({ label: 'previous single response', error: old.error?.message,
  rows: old.data?.length, months: [...new Set((old.data || []).map((row) => row.month))] }))
const months = await client.rpc('distinct_rider_payment_months').abortSignal(AbortSignal.timeout(15000))
if (months.error) throw new Error(months.error.message)
const expected = months.data.map((row) => typeof row === 'string' ? row : row.month).filter(Boolean).sort()
globalThis.__overviewLiveClient = client
const server = await createServer({
  configFile: false, cacheDir: 'node_modules/.vite-tests/overview-payment-live',
  server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'overview-live-client', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__overviewLiveClient'
  } }],
})
try {
  const api = await server.ssrLoadModule('/src/lib/riderPaymentDb.js')
  const report = await server.ssrLoadModule('/src/lib/paymentHistoryReport.js')
  const start = performance.now()
  const rows = await api.fetchRiderPaymentsForRevenue()
  const actual = [...new Set(rows.map((row) => row.month).filter(Boolean))].sort()
  console.log(JSON.stringify({ label: 'complete overview payment load', milliseconds: Math.round(performance.now() - start),
    rows: rows.length, months: actual, expectedMonths: expected,
    allMonthsIncluded: expected.every((month) => actual.includes(month)),
    chartMonths: report.buildMonthlyRevenueSeries(rows).series.map((row) => row.month) }))
  if (!expected.every((month) => actual.includes(month))) throw new Error('Payment month coverage is incomplete')
  const cachedAt = performance.now()
  const cached = await api.fetchRiderPaymentsForRevenue()
  console.log(JSON.stringify({ label: 'cached visit', milliseconds: Math.round(performance.now() - cachedAt), sameResult: rows === cached }))
} finally {
  await server.close()
  delete globalThis.__overviewLiveClient
}
