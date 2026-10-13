import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

const env = { ...loadEnv('development', process.cwd(), ''), ...process.env }
const email = 'admin@ev91riderz.com'
const password = env.DASHBOARD_ADMIN_PASSWORD
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

async function setup() {
  if (!url || !key || !password) {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY and DASHBOARD_ADMIN_PASSWORD in this terminal, and configure VITE_SUPABASE_URL. See docs/login-setup.md. Never use a VITE_ prefix for the service key.')
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  // Check the SQL migration first so a missing table does not leave a partial account.
  const { error: setupError } = await client.from('dashboard_settings').select('id').eq('id', true).single()
  if (setupError) throw new Error('Run sql/create_dashboard_auth.sql before setting up the administrator.')
  let existing
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error('Could not inspect Auth users. Check the server-only service key.')
    existing = data.users.find((user) => user.email?.toLowerCase() === email)
    if (existing || data.users.length < 1000) break
  }
  let id = existing?.id
  if (!id) {
    const { data, error } = await client.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { display_name: 'EV91 Administrator' },
    })
    if (error) throw new Error('Admin creation failed. Check the Email provider and project password policy (the supplied password must be permitted).')
    id = data.user.id
  }
  const { error } = await client.from('dashboard_users').upsert({
    id, email, display_name: 'EV91 Administrator', role: 'admin',
  })
  if (error) throw new Error('The Auth account exists, but its admin role could not be saved. Check the migration and rerun this script.')
  console.log(existing
    ? `Administrator role configured for ${email}. Existing password was preserved.`
    : `Administrator account created for ${email}. Sign in at /#admin.`)
}
setup().catch((error) => { console.error(error.message); process.exitCode = 1 })
