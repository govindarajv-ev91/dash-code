import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

const riderCols = 'id,delivered,date_record,worker_code,worker_name,hub_name,city,client,cumulative_order,source,week,month,state,type1,type2,mob_number';

async function testFetch(orderBy) {
  console.log(`\n--- Testing fetch for rider_metrics with orderBy = ${orderBy} ---`);
  let from = 0;
  const size = 1000;
  let totalRows = 0;
  
  while (true) {
    try {
      let query = supabase.from('rider_metrics').select(riderCols);
      if (orderBy) {
        query = query.order(orderBy, { ascending: true });
      }
      
      const { data, error } = await query.range(from, from + size - 1);
      if (error) {
        console.error(`Error at range ${from}:`, error);
        break;
      }
      if (!data || data.length === 0) {
        break;
      }
      totalRows += data.length;
      if (data.length < size) {
        break;
      }
      from += size;
      if (from % 10000 === 0) {
        console.log(`Fetched ${from} rows...`);
      }
    } catch (e) {
      console.error('Catch error:', e);
      break;
    }
  }
  console.log(`Finished. Total rows fetched: ${totalRows}`);
}

async function run() {
  await testFetch(null);
  await testFetch('id');
}

run();
