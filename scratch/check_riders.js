import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkSpecificRiders() {
  const ids = ['53102_MNOW000107', '53102_MNOW000135', 'BEL01-R0204'];
  const tables = ['fleet_data', 'rider_kyc', 'rider_onboarding'];
  
  for (const id of ids) {
    console.log(`\n--- Searching for ID: ${id} ---`);
    for (const table of tables) {
      // We'll search in common columns
      const { data, error } = await supabase.from(table).select('*')
        .or(`rider_id.eq.${id},worker_code.eq.${id},rider_id_details.eq.${id},pan_number.eq.${id}`);
      
      if (error) {
        // Fallback for tables that might not have those columns
        const { data: allData, error: allErr } = await supabase.from(table).select('*').limit(100);
        if (allData && allData.length > 0) {
          const keys = Object.keys(allData[0]);
          // console.log(`Table ${table} has columns: ${keys.join(', ')}`);
          // Try to find manually in first 1000
          const { data: searchData } = await supabase.from(table).select('*').limit(1000);
          const found = searchData?.filter(row => Object.values(row).some(v => v?.toString().includes(id)));
          if (found && found.length > 0) {
             console.log(`[${table}] FOUND (manual search):`, JSON.stringify(found[0], null, 2));
          }
        }
      } else if (data && data.length > 0) {
        console.log(`[${table}] FOUND:`, JSON.stringify(data[0], null, 2));
      } else {
        // console.log(`[${table}] Not found.`);
      }
    }
  }
}

checkSpecificRiders();
