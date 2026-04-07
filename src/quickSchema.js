import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseAnonKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function test() {
  const { data: r } = await supabase.from('rider_metrics').select('*').limit(1)
  console.log('--- RIDER_METRICS COLS ---')
  if (r?.[0]) console.log(Object.keys(r[0]).join('\n'))
  
  const { data: f } = await supabase.from('fleet_data').select('*').limit(1)
  console.log('--- FLEET_DATA COLS ---')
  if (f?.[0]) console.log(Object.keys(f[0]).join('\n'))
  console.log('--- FLEET_DATA SAMPLE ---')
  console.log(JSON.stringify(f?.[0], null, 2))
}
test()
