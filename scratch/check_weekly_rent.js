import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
  const { data, error } = await supabase.from('weekly_rent').select('*').limit(1);
  if (error) {
    console.error('Error fetching weekly_rent:', error);
  } else {
    console.log('Successfully fetched weekly_rent sample:', data);
  }
}

check();
