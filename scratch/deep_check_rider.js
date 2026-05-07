import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseAnonKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkRiderDeeply() {
  const mobile = '8744834848'
  
  console.log(`Deep check for: ${mobile}`)
  
  const fetchAllData = async (table, columns = '*', orderBy = 'id') => {
    let allData = [];
    let from = 0;
    const size = 1000;
    const batchSize = 10;
    while (true) {
      const promises = [];
      for (let i = 0; i < batchSize; i++) {
        const start = from + (i * size);
        promises.push(supabase.from(table).select(columns).order(orderBy, { ascending: true }).range(start, start + size - 1));
      }
      const results = await Promise.all(promises);
      let hitEnd = false;
      for (const res of results) {
        if (res.error) {
          console.error(`Error at ${from}:`, res.error);
          hitEnd = true; break;
        }
        if (res.data && res.data.length > 0) {
          allData.push(...res.data);
          if (res.data.length < size) { hitEnd = true; break; }
        } else { hitEnd = true; break; }
      }
      if (hitEnd) break;
      from += (batchSize * size);
      console.log(`Fetched so far: ${allData.length}`);
    }
    return allData;
  };

  console.log("Starting full fetch of rider_metrics...");
  const { data: tables, error } = await supabase.from('pg_tables').select('tablename').eq('schemaname', 'public')
  if (error) {
     // If pg_tables is not available via PostgREST, try to just guess or list known tables
     console.error("Tables Fetch Error:", error)
  }
  console.log("Available tables:", tables)






  
  // Check for duplicates for a specific rider/date
  if (metrics && metrics.length > 0) {
      const { data: dups } = await supabase.from('rider_metrics').select('*').eq('worker_code', metrics[0].worker_code).eq('date_record', metrics[0].date_record)
      console.log(`Dups for ${metrics[0].worker_code} on ${metrics[0].date_record}:`, dups.length)
  }




}

checkRiderDeeply()
