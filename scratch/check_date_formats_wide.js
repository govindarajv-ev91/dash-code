
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkData() {
    console.log('Checking date formats in rider_metrics (random sample)...');
    
    // Check first 50
    const { data: first50 } = await supabase.from('rider_metrics').select('date_record').limit(50);
    // Check middle 50 (approx)
    const { data: mid50 } = await supabase.from('rider_metrics').select('date_record').range(75000, 75050);
    // Check last 50
    const { data: last50 } = await supabase.from('rider_metrics').select('date_record').order('created_at', { ascending: false }).limit(50);
    
    const all = [...(first50||[]), ...(mid50||[]), ...(last50||[])];
    const formats = new Set();
    all.forEach(r => {
        if (!r.date_record) { formats.add('null'); return; }
        if (r.date_record.includes('/')) formats.add('DD/MM/YYYY');
        else if (r.date_record.includes('-')) formats.add('YYYY-MM-DD');
        else formats.add('Other: ' + r.date_record);
    });
    
    console.log('Detected formats:', Array.from(formats));
    console.log('Sample dates:', all.slice(0, 5).map(r => r.date_record));
    if (last50) console.log('Latest dates sample:', last50.slice(0, 5).map(r => r.date_record));
}

checkData();
