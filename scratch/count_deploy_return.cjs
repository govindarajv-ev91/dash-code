const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://arnxvnkednpzyzyfculx.supabase.co',
  'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
);

function parseFleetDate(dateStr) {
  if (dateStr == null || dateStr === '') return null;
  const s = dateStr.toString().trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date((parseFloat(s) - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    let year = parseInt(slash[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, parseInt(slash[2], 10) - 1, parseInt(slash[1], 10)).getTime();
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10)).getTime();
  const p = new Date(s);
  return isNaN(p.getTime()) ? null : p.getTime();
}

function normalizeStatus(value) {
  const t = (value || '').toString().trim().toLowerCase();
  if (t === 'deployee' || t.includes('deploy')) return 'Deployee';
  if (t === 'return' || t.includes('return')) return 'Return';
  return t;
}

async function fetchAll() {
  let cursor = null;
  const all = [];
  while (true) {
    let q = supabase.from('fleet_data').select('vehicle_number,vehicle_status,date_record').order('id', { ascending: true }).limit(250);
    if (cursor != null) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    cursor = data[data.length - 1].id;
    if (data.length < 250) break;
  }
  return all;
}

async function main() {
  const rows = await fetchAll();
  console.log('Total fleet rows:', rows.length);

  const txs = [];
  const statusCounts = {};
  let noDate = 0;
  let noVehicle = 0;

  for (const row of rows) {
    const st = (row.vehicle_status || '').toString().trim();
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    const date = parseFleetDate(row.date_record);
    const vehicle = (row.vehicle_number || '').toString().trim();
    if (!date) { noDate++; continue; }
    if (!vehicle) { noVehicle++; continue; }
    txs.push({ vehicle, date, status: normalizeStatus(st), rawStatus: st });
  }

  console.log('Unique raw statuses (top 15):', Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).slice(0,15));
  console.log('Skipped no date:', noDate, 'no vehicle:', noVehicle);
  console.log('Valid transactions:', txs.length);

  const allDeploy = txs.filter(t => t.status === 'Deployee');
  const allReturn = txs.filter(t => t.status === 'Return');
  console.log('All Deployee (loose):', allDeploy.length);
  console.log('All Return (loose):', allReturn.length);

  const strictDeploy = txs.filter(t => t.rawStatus === 'Deployee');
  console.log('Strict Deployee only:', strictDeploy.length);

  const byVehicle = new Map();
  for (const tx of txs) {
    const key = tx.vehicle;
    if (!byVehicle.has(key)) byVehicle.set(key, []);
    byVehicle.get(key).push(tx);
  }
  const filtered = [];
  for (const list of byVehicle.values()) {
    list.sort((a, b) => b.date - a.date);
    filtered.push(...list.slice(0, 6));
  }
  const deployRn6 = filtered.filter(t => t.status === 'Deployee');
  const strictDeployRn6 = filtered.filter(t => t.rawStatus === 'Deployee');
  console.log('Deployee after rn<=6 (loose):', deployRn6.length);
  console.log('Deployee after rn<=6 (strict):', strictDeployRn6.length);
}

main().catch(console.error);
