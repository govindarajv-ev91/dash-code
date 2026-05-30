const FLEET_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcqousIenx7wOzlCIB6rw0zSXnfiwmWyXPcTzYoDX5E9PryySAoMLMjiWNdlVg8vYWUIX3iqM4VG0D/pub?gid=721267187&single=true&output=csv';

const proxies = [
  { name: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(FLEET_SHEET_CSV_URL)}` },
  { name: 'corsproxy.io', url: `https://corsproxy.io/?${encodeURIComponent(FLEET_SHEET_CSV_URL)}` },
  { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(FLEET_SHEET_CSV_URL)}` },
  { name: 'thingproxy', url: `https://thingproxy.freeboard.io/fetch/${FLEET_SHEET_CSV_URL}` },
];

async function test() {
  for (const proxy of proxies) {
    try {
      console.log(`Testing ${proxy.name}...`);
      const start = Date.now();
      const res = await fetch(proxy.url);
      console.log(`${proxy.name} status:`, res.status, `in ${Date.now() - start}ms`);
      const text = await res.text();
      console.log(`${proxy.name} body length:`, text.length);
      console.log(`${proxy.name} starts with:`, JSON.stringify(text.slice(0, 50)));
    } catch (e) {
      console.error(`${proxy.name} failed:`, e.message);
    }
    console.log('-----------------------------------');
  }
}

test();
