
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkData() {
    console.log('Fetching sample from rider_metrics...');
    const { data, error } = await supabase
        .from('rider_metrics')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Sample record:', data[0]);
        console.log('Columns:', Object.keys(data[0]));
    }
}

checkData();
