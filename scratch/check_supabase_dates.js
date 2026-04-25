
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkData() {
    console.log('Counting rider_metrics...');
    const { count, error } = await supabase
        .from('rider_metrics')
        .select('*', { count: 'exact', head: true });
    
    if (error) {
        console.error('Error counting rider_metrics:', error);
    } else {
        console.log('Total rows in rider_metrics:', count);
    }

    const { data: latest, error: latestError } = await supabase
        .from('rider_metrics')
        .select('date_record, city, client')
        .order('date_record', { ascending: false })
        .limit(20);
    
    if (latestError) {
        console.error('Error fetching latest:', latestError);
    } else {
        console.log('Latest records:', latest);
    }
}

checkData();
