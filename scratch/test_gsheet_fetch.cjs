const FLEET_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcqousIenx7wOzlCIB6rw0zSXnfiwmWyXPcTzYoDX5E9PryySAoMLMjiWNdlVg8vYWUIX3iqM4VG0D/pub?gid=721267187&single=true&output=csv';

const normalizeHeader = (value) =>
  (value || '').toString().trim().toLowerCase().replace(/\uFEFF/g, '').replace(/[^a-z0-9]/g, '');

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { field += '"'; i++; } else inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) { row.push(field); field = ''; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => (c || '').trim())) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(c => (c || '').trim())) rows.push(row);
  }
  return rows;
}

async function main() {
  const res = await fetch(FLEET_SHEET_CSV_URL);
  console.log('status', res.status, res.headers.get('content-type'));
  const text = await res.text();
  console.log('bytes', text.length, 'starts with', JSON.stringify(text.slice(0, 120)));
  const parsed = parseCSV(text);
  console.log('parsed rows', parsed.length);
  if (parsed[0]) {
    console.log('header count', parsed[0].length);
    console.log('first 10 headers', parsed[0].slice(0, 10));
  }
  if (parsed[1]) console.log('row2 col count', parsed[1].length, 'sample', parsed[1].slice(0, 5));
}

main().catch(e => console.error(e));
