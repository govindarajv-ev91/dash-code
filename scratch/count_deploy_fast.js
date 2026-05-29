import { createClient } from '@supabase/supabase-js';
import { buildDeployReturnReport, parseFleetDate } from '../src/lib/fleetDeployReturnExport.js';

const supabase = createClient(
  'https://arnxvnkednpzyzyfculx.supabase.co',
  'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
);

async function fetchCols() {
  const all = [];
  let cursor = null;
  while (true) {
    let q = supabase
      .from('fleet_data')
      .select('id,vehicle_number,vehicle_status,date_record,city_locations,city,rider_id,rider_name,rider_contact_number,client_name,hub_location,category')
      .order('id', { ascending: true })
      .limit(500);
    if (cursor != null) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    cursor = data[data.length - 1].id;
    process.stdout.write(`\r${all.length}`);
    if (data.length < 500) break;
  }
  console.log('\nloaded', all.length);
  return all;
}

const rows = await fetchCols();
const report = buildDeployReturnReport(rows);
console.log('Current export rows:', report.length);

let deployAll = 0;
let noDate = 0;
for (const r of rows) {
  if (!parseFleetDate(r.date_record)) noDate++;
  if ((r.vehicle_status || '').trim() === 'Deployee' && parseFleetDate(r.date_record) && (r.vehicle_number || '').trim()) deployAll++;
}
console.log('Strict Deployee + date + vehicle:', deployAll, 'noDate:', noDate);
