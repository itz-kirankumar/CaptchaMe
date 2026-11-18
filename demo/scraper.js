'use strict';
// A plain scraper for the live demo. Run against a running server:
//   npm run demo:scrape -- http://localhost:3000
// It walks the catalogue like a typical Python crawler and prints what the
// shield decided for each request. Watch /scraper and /analytics meanwhile.
const BASE = process.argv[2] || 'http://localhost:3000';
const HEADERS = { 'User-Agent': 'python-requests/2.32.3', Accept: '*/*', 'X-CM-Attacker': 'demo scraper (python-requests)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('Scraping', BASE + '/api/catalog as python-requests\n');
  for (let p = 1; p <= 20; p++) {
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/catalog?page=${p}`, { headers: HEADERS });
    const b = await r.json().catch(() => ({}));
    const d = r.headers.get('x-captchame-shield');
    console.log(`page ${String(p).padStart(2)} -> ${r.status} ${String(d).toUpperCase().padEnd(6)} risk ${r.headers.get('x-captchame-risk')}  ${Date.now() - t0} ms` + (b.canary ? `  canary ${b.canary}` : '') + (r.status === 429 ? `  ${b.reason}` : ''));
    await sleep(150);
  }
  const t = await fetch(`${BASE}/api/catalog/item/trap-collectors`, { headers: HEADERS });
  console.log(`\nhidden trap link -> ${t.status}`);
})().catch(e => { console.error(e.message); process.exit(1); });
