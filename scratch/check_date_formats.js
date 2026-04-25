
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://arnxvnkednpzyzyfculx.supabase.co'
const supabaseKey = 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkData() {
    console.log('Checking date formats in rider_metrics...');
    const { data, error } = await supabase
        .from('rider_metrics')
        .select('date_record')
        .limit(100);
    
    if (error) {
        console.error('Error:', error);
    } else {
        const formats = new Set();
        data.forEach(r => {
            if (r.date_record) {
                if (r.date_record.includes('/')) formats.add('DD/MM/YYYY');
                else if (r.date_record.includes('-')) formats.add('YYYY-MM-DD or other');
                else formats.add('Unknown: ' + r.date_record);
            } else {
                formats.add('null');
            }
        });
        console.log('Detected formats:', Array.from(formats));
        console.log('Sample dates:', data.slice(0, 10).map(r => r.date_record));
    }
}

checkData();
