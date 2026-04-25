
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkData() {
    console.log('Checking for April 2026 data in rider_metrics...');
    const { data, error } = await supabase
        .from('rider_metrics')
        .select('date_record')
        .ilike('date_record', '%/04/2026%')
        .limit(10);
    
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('April 2026 records found:', data.length);
        if (data.length > 0) {
            console.log('Sample April dates:', data.map(r => r.date_record));
        }
    }

    console.log('\nChecking for specifically 21/04/2026 or 22/04/2026...');
    const { data: recent, error: recentError } = await supabase
        .from('rider_metrics')
        .select('date_record')
        .in('date_record', ['21/04/2026', '22/04/2026', '21-04-2026', '22-04-2026', '2026-04-21', '2026-04-22'])
        .limit(10);
    
    if (recentError) {
        console.error('Error:', recentError);
    } else {
        console.log('Recent records found:', recent.length);
        if (recent.length > 0) {
            console.log('Sample recent dates:', recent.map(r => r.date_record));
        }
    }
}

checkData();
