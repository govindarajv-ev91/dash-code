import { loadEnv } from 'vite'

const env = { ...loadEnv('development', process.cwd(), ''), ...process.env }
const key = env.RIDER_PAYMENT_API_KEY?.trim()
if (!key) throw new Error('Set RIDER_PAYMENT_API_KEY in .env.local before checking the API.')
const url = new URL(process.argv[2] || 'https://main.d2y6lleakorn3s.amplifyapp.com/api/rider-payments?ev91_id=CHE-26-R001711')
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
  throw new Error('Use HTTPS or a local development URL.')
}
try {
  const response = await fetch(url, {
    headers: { 'x-api-key': key, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(60000),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`HTTP ${response.status}: expected JSON. Check the Amplify payment rewrite above the SPA fallback.`)
  }
  const body = await response.json()
  if (!response.ok || body.success !== true || !Array.isArray(body.data) || body.count !== body.data.length) {
    throw new Error(`HTTP ${response.status}: ${body.message || 'Invalid payment API response.'}`)
  }
  console.log(`Payment API OK: HTTP ${response.status}, ${body.count} rows, months ${(body.months || []).join(', ')}.`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
