import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkMetrics() {
  const ids = ['53102_MNOW000107', '53102_MNOW000135', 'BEL01-R0204'];
  for (const id of ids) {
    console.log(`\n--- Searching for ID: ${id} ---`);
    const { data, error } = await supabase.from('rider_metrics').select('*').eq('worker_code', id);
    if (data && data.length > 0) {
      console.log(`[rider_metrics] FOUND:`, JSON.stringify(data[0], null, 2));
    } else {
        // Try partial match
        const { data: partial } = await supabase.from('rider_metrics').select('*').ilike('worker_code', `%${id}%`);
        if (partial && partial.length > 0) {
             console.log(`[rider_metrics] FOUND (partial):`, JSON.stringify(partial[0], null, 2));
        }
    }
  }
}

checkMetrics();
