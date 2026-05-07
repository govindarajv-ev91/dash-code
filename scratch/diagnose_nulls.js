import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://arnxvnkednpzyzyfculx.supabase.co',
  'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
)

async function diagnose() {
  // Count null delivered rows
  const { count: nullCount } = await supabase
    .from('rider_metrics')
    .select('*', { count: 'exact', head: true })
    .is('delivered', null)
  console.log('Rows with NULL delivered:', nullCount)

  // Count zero delivered rows
  const { count: zeroCount } = await supabase
    .from('rider_metrics')
    .select('*', { count: 'exact', head: true })
    .eq('delivered', '0')
  console.log('Rows with delivered = "0":', zeroCount)

  // Sample some null delivered rows to see what other fields look like
  const { data: nullRows } = await supabase
    .from('rider_metrics')
    .select('worker_code, date_record, delivered, cumulative_order')
    .is('delivered', null)
    .limit(10)
  console.log('\nSample NULL delivered rows:', JSON.stringify(nullRows, null, 2))

  // Check the cumulative_order column for null rows - it might have the correct count
  const { data: cumRows } = await supabase
    .from('rider_metrics')
    .select('delivered, cumulative_order')
    .is('delivered', null)
    .limit(5)
  console.log('\ncumulative_order on null delivered rows:', cumRows)
}

diagnose()
