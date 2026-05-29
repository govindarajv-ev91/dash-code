import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function testFetch() {
  console.log('Testing fetching fleet_data with select(*)...');
  let from = 0;
  const size = 1000;
  let totalRows = 0;
  
  while (true) {
    try {
      const { data, error } = await supabase
        .from('fleet_data')
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + size - 1);
        
      if (error) {
        console.error(`Error at range ${from}-${from + size - 1}:`, error);
        break;
      }
      
      if (!data || data.length === 0) {
        console.log('No more data returned.');
        break;
      }
      
      totalRows += data.length;
      console.log(`Fetched range ${from}-${from + data.length - 1}. Current total: ${totalRows}`);
      
      if (data.length < size) {
        break;
      }
      from += size;
    } catch (e) {
      console.error(`Catch error at ${from}:`, e);
      break;
    }
  }
  console.log(`Finished test. Total fetched rows: ${totalRows}`);
}

testFetch();
