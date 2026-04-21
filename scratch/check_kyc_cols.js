import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkKyc() {
  const { data } = await supabase.from('rider_kyc').select('*').limit(1);
  console.log('Columns in rider_kyc:', Object.keys(data[0]));
}

checkKyc();
