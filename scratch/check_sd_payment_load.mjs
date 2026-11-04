import { createClient } from '@supabase/supabase-js'
import { createServer, loadEnv } from 'vite'

const env = loadEnv('development', process.cwd(), '')
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const columns = 'id,client_name,type,week,month,rider_id,rider_name,city,sd,ev_rent,vehicle_number,period_start,payment_date'
for (const [label, build] of [
  ['estimated rows', () => client.from('rider_payment_data').select('id', { count: 'planned', head: true })],
  ['first 1000 slim rows', () => client.from('rider_payment_data').select(columns).order('id').limit(1000)],
  ['latest 1000 slim rows', () => client.from('rider_payment_data').select(columns).order('id', { ascending: false }).limit(1000)],
]) {
  const started = performance.now()
  const result = await build().abortSignal(AbortSignal.timeout(20000))
  console.log(JSON.stringify({ label, milliseconds: Math.round(performance.now() - started),
    status: result.status, error: result.error?.message, count: result.count,
    returnedRows: result.data?.length, bytes: result.data ? Buffer.byteLength(JSON.stringify(result.data)) : undefined }))
}

// Exercise the actual application loader without printing or saving rider data.
globalThis.__sdLiveCheckClient = client
const server = await createServer({
  configFile: false, cacheDir: 'node_modules/.vite-tests/sd-rent-live-check',
  server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'live-check-client', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) return 'export const supabase = globalThis.__sdLiveCheckClient'
  } }],
})
try {
  const api = await server.ssrLoadModule('/src/lib/riderPaymentDb.js')
  const count = await client.from('rider_payment_data').select('id', { count: 'exact', head: true })
    .abortSignal(AbortSignal.timeout(20000))
  if (count.error) throw new Error(count.error.message)
  const started = performance.now()
  let checkpoint = 0
  const rows = await api.fetchRiderPaymentsForSdRent({ onProgress: ({ loadedRows }) => {
    if (loadedRows - checkpoint >= 25000) {
      checkpoint = loadedRows
      console.log(JSON.stringify({ label: 'payment progress', loadedRows, seconds: Math.round((performance.now() - started) / 1000) }))
    }
  } })
  console.log(JSON.stringify({ label: 'complete application payment scan',
    milliseconds: Math.round(performance.now() - started), loadedRows: rows.length,
    databaseRows: count.count, uniqueIds: new Set(rows.map((row) => String(row.id))).size }))
  const cachedAt = performance.now()
  const cached = await api.fetchRiderPaymentsForSdRent()
  console.log(JSON.stringify({ label: 'repeat visit', milliseconds: Math.round(performance.now() - cachedAt),
    sameCompleteResult: cached === rows }))
} finally {
  await server.close()
  delete globalThis.__sdLiveCheckClient
}
