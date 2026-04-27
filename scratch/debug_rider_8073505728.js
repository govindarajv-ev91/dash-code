import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseAnonKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkRider() {
  const mobile = '8073505728'
  
  console.log(`Checking data for mobile: ${mobile}`)
  
  const { data: kyc } = await supabase.from('rider_kyc').select('*').or(`rider_mobile_number.eq.${mobile},rider_id.eq.${mobile}`)
  console.log('--- rider_kyc ---')
  console.log(JSON.stringify(kyc, null, 2))
  
  const { data: onboarding } = await supabase.from('rider_onboarding').select('*').or(`rider_mobile_number.eq.${mobile},rider_id.eq.${mobile}`)
  console.log('--- rider_onboarding ---')
  console.log(JSON.stringify(onboarding, null, 2))
  
  const { data: metrics } = await supabase.from('rider_metrics').select('*').or(`mob_number.eq.${mobile},worker_code.eq.${mobile}`)
  console.log('--- rider_metrics ---')
  console.log(JSON.stringify(metrics, null, 2))
}

checkRider()
