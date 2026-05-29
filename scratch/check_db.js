const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co';
const supabaseAnonKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const { count, error } = await supabase
    .from('fleet_data')
    .select('*', { count: 'exact', head: true });
  
  if (error) {
    console.error('Count error:', error);
  } else {
    console.log('Total count from head query:', count);
  }

  // Let's do a paginated count without any order
  let totalRows = 0;
  let from = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('fleet_data')
      .select('id')
      .range(from, from + size - 1);
    
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
  }
  console.log('Total counted rows by paginating without order:', totalRows);

  // Let's check with order('id')
  let totalRowsWithOrder = 0;
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('fleet_data')
      .select('id')
      .order('id', { ascending: true })
      .range(from, from + size - 1);
    
    if (error) {
      console.error(`Error with order at range ${from}:`, error);
      break;
    }
    if (!data || data.length === 0) {
      break;
    }
    totalRowsWithOrder += data.length;
    if (data.length < size) {
      break;
    }
    from += size;
  }
  console.log('Total counted rows by paginating with order(id):', totalRowsWithOrder);
}

main();
