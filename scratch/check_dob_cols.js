import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
  const tables = ['rider_kyc', 'rider_onboarding', 'fleet_data'];
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.error(`Error fetching ${table}:`, error.message);
    } else if (data && data.length > 0) {
      const cols = Object.keys(data[0]);
      const dobCols = cols.filter(c => c.toLowerCase().includes('dob') || c.toLowerCase().includes('birth') || c.toLowerCase().includes('age') || c.toLowerCase().includes('date_of'));
      console.log(`\n${table} columns (${cols.length} total):`);
      console.log(cols.join(', '));
      console.log(`DOB-related columns: ${dobCols.length > 0 ? dobCols.join(', ') : 'NONE FOUND'}`);
    }
  }
}

check();
