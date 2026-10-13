import { spawnSync } from 'node:child_process'
import { loadEnv } from 'vite'

const env = { ...loadEnv('development', process.cwd(), ''), ...process.env }
let projectRef = env.SUPABASE_PROJECT_REF
if (!projectRef) {
  try {
    const hostname = new URL(env.VITE_SUPABASE_URL || env.SUPABASE_URL).hostname
    projectRef = hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1]
  } catch { /* Report configuration below without printing environment values. */ }
}
if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
  console.error('Configure VITE_SUPABASE_URL or SUPABASE_PROJECT_REF for the intended Supabase project.')
  process.exitCode = 1
} else {
  console.log(`Deploying dashboard-admin to the app's Supabase project: ${projectRef}`)
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    '--yes', 'supabase', 'functions', 'deploy', 'dashboard-admin', '--project-ref', projectRef, '--use-api',
  ], {
    stdio: 'inherit', env, shell: process.platform === 'win32',
  })
  if (result.error || result.status !== 0) {
    console.error('Deployment did not complete. Run npx.cmd supabase login in your terminal, then npm.cmd run deploy:admin again. See docs/login-setup.md.')
    process.exitCode = result.status || 1
  } else {
    console.log('Admin service deployed. Refresh User management and retry Create user.')
  }
}
