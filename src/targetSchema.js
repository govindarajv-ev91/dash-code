import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseAnonKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseAnonKey)
import fs from 'fs'
async function test() {
  const { data: f } = await supabase.from('fleet_data').select('*').limit(1)
  if (f?.[0]) fs.writeFileSync('temp_keys.txt', 'FLEET_KEYS:\n' + Object.keys(f[0]).join('\n') + '\n')
  const { data: r } = await supabase.from('rider_metrics').select('*').limit(1)
  if (r?.[0]) fs.appendFileSync('temp_keys.txt', 'RIDER_KEYS:\n' + Object.keys(r[0]).join('\n') + '\n')
}
test()
