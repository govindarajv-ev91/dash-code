import { loadEnv } from 'vite'
import { pathToFileURL } from 'node:url'
import { corsHeaders } from '@supabase/supabase-js/cors'

function missingFunction(url) {
  const projectRef = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1]
  const dashboard = projectRef ? ` Open https://supabase.com/dashboard/project/${projectRef}/functions.` : ''
  return new Error(`dashboard-admin is not deployed at ${url.origin}. This also causes the browser connection error because its OPTIONS preflight returns 404.${dashboard} Deploy a function named exactly dashboard-admin using supabase/dashboard-admin-editor.ts, or run npm.cmd run deploy:admin after Supabase CLI login.`)
}

function checkCors(response, origin, preflight = false) {
  const allowedOrigin = response.headers.get('access-control-allow-origin')
  if (allowedOrigin !== '*' && allowedOrigin !== origin) {
    throw new Error('The admin service does not allow this browser origin. Redeploy the complete dashboard-admin-editor.ts file, including its CORS headers.')
  }
  if (!preflight) return
  const allowList = (name) => (response.headers.get(name) || '').toLowerCase().split(',').map((value) => value.trim())
  const headers = allowList('access-control-allow-headers')
  const requiredHeaders = corsHeaders['Access-Control-Allow-Headers'].split(',').map((value) => value.trim())
  if (!requiredHeaders.every((header) => headers.includes(header)) || !allowList('access-control-allow-methods').includes('post')) {
    throw new Error('Browser preflight is missing required request headers or POST permission. Redeploy the complete dashboard-admin-editor.ts file.')
  }
}

export async function checkAdminService({ base, key, origin = 'http://localhost:5173', fetchImpl = fetch }) {
  if (!base || !key) throw new Error('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.')
  const url = new URL('/functions/v1/dashboard-admin', base)
  const preflight = await fetchImpl(url, {
    method: 'OPTIONS', headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': corsHeaders['Access-Control-Allow-Headers'],
    }, signal: AbortSignal.timeout(20000),
  })
  if (preflight.status === 404) throw missingFunction(url)
  if (!preflight.ok) throw new Error(`Browser preflight returned HTTP ${preflight.status}. Set Verify JWT OFF for dashboard-admin and redeploy the complete handler, which verifies administrator sessions itself.`)
  checkCors(preflight, origin, true)
  // No user credentials and no mutations: a deployed handler must reject this.
  const response = await fetchImpl(url, {
    method: 'POST', headers: { Origin: origin, apikey: key, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(20000),
  })
  let payload
  try { payload = await response.json() } catch { /* Classify by status. */ }
  if (response.status === 404) throw missingFunction(url)
  if (response.status === 401 && payload?.error === 'Sign in as an administrator.') {
    checkCors(response, origin)
    return
  }
  if (response.status === 401) throw new Error('The gateway rejected the request before the admin handler. Redeploy using the project config, then check again.')
  throw new Error(`Admin service returned HTTP ${response.status}. Check its deployment and Edge Function logs.`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...loadEnv('development', process.cwd(), ''), ...process.env }
  console.log('Checking dashboard-admin deployment, browser preflight, and authentication.')
  checkAdminService({ base: env.VITE_SUPABASE_URL || env.SUPABASE_URL,
    key: env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY,
    origin: env.DASHBOARD_BROWSER_ORIGIN || 'http://localhost:5173',
  }).then(() => {
    console.log('Admin handler is deployed, browser requests are allowed, and unsigned requests are rejected. Refresh User management and sign in as an admin.')
  }).catch((error) => {
    console.error(error.name === 'TimeoutError' || error instanceof TypeError
      ? 'The admin service could not be reached. Check network access and the Supabase URL.' : error.message)
    process.exitCode = 1
  })
}
