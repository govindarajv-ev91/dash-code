const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co';
const supabaseAnonKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const tables = ['rider_metrics', 'fleet_data', 'weekly_rent', 'rider_kyc', 'rider_onboarding', 'vehicle_inventory'];
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error(`Error counting ${table}:`, error);
    } else {
      console.log(`Table ${table} total rows:`, count);
    }
  }
}

main();
