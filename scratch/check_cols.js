import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkOnboarding() {
  const { data, error } = await supabase.from('rider_onboarding').select('*').limit(1);
  console.log('Columns in rider_onboarding:', Object.keys(data[0]));
}

checkOnboarding();
