import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseAnonKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkRiderDeeply() {
  const mobile = '8073505728'
  
  console.log(`Deep check for: ${mobile}`)
  
  // Try finding in onboarding with different column names
  const { data: onboarding } = await supabase.from('rider_onboarding').select('*')
  const foundOnboarding = onboarding?.filter(row => 
    Object.values(row).some(val => val && val.toString().includes(mobile))
  )
  console.log('--- rider_onboarding matches ---')
  console.log(JSON.stringify(foundOnboarding, null, 2))

  const { data: kyc } = await supabase.from('rider_kyc').select('*')
  const foundKyc = kyc?.filter(row => 
    Object.values(row).some(val => val && val.toString().includes(mobile))
  )
  console.log('--- rider_kyc matches ---')
  console.log(JSON.stringify(foundKyc, null, 2))
}

checkRiderDeeply()
