'use strict';
// Scraper shield. Scores each visitor of a protected listing from signals that
// need no page code (client identity, headers, rate, order, timing, traps),
// then answers: allow, slow (delay), decoy (plausible fake data carrying a
// traceable canary), or block (429 with a reason and an appeal).
// State is in memory per instance, like the replay set in server.js.
const crypto = require('crypto');

const BAD_UA = [
  [/python-requests|aiohttp|httpx|urllib/i, 'a Python HTTP library'],
  [/\bcurl\//i, 'curl'],
  [/wget/i, 'wget'],
  [/scrapy/i, 'Scrapy'],
  [/go-http-client/i, 'a Go HTTP client'],
  [/okhttp|java\//i, 'a Java HTTP client'],
  [/node-fetch|axios|undici|\bgot\//i, 'a Node HTTP client'],
  [/headlesschrome/i, 'headless Chrome'],
  [/phantomjs|puppeteer|playwright|selenium/i, 'a browser automation tool'],
  [/firecrawl|crawl4ai|scrapingbee|zenrows|scraperapi/i, 'a scraping service'],
  [/bot\b|crawler|spider/i, 'a self-declared crawler'],
];

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const actors = new Map();

function keyFor(m) {
  if (m.vid) return 'v:' + String(m.vid).replace(/[^a-z0-9]/gi, '').slice(0, 16);
  return 'n:' + crypto.createHash('sha256').update((m.ip || '') + '|' + (m.ua || '')).digest('hex').slice(0, 12);
}

// m: { ip, ua, acceptLanguage, js, vid, page, honeypot, human, agent, now }
function assess(m) {
  const now = m.now || Date.now();
  const key = keyFor(m);
  let a = actors.get(key);
  if (!a) {
    a = { key, first: now, last: now, hits: [], pages: [], honeypot: false, ua: String(m.ua || '').slice(0, 90), counts: { allow: 0, slow: 0, decoy: 0, block: 0, agent: 0 }, score: 0, decision: 'allow', reasons: [] };
    actors.set(key, a);
    if (actors.size > 5000) actors.delete(actors.keys().next().value);
  }
  a.last = now;
  a.hits.push(now);
  a.hits = a.hits.filter(t => now - t < 60000);
  if (Number.isFinite(m.page)) { a.pages.push(m.page); if (a.pages.length > 20) a.pages.shift(); }
  if (m.honeypot) a.honeypot = true;

  let score = 0;
  const reasons = [];
  if (m.agent) {
    return settle(a, 'agent', 0, ['declared agent with a signed key: served from its own fair-share lane']);
  }
  const ua = String(m.ua || '');
  const bad = BAD_UA.find(([rx]) => rx.test(ua));
  if (!ua) { score += 30; reasons.push('sent no User-Agent at all'); }
  else if (bad) { score += 45; reasons.push('identifies itself as ' + bad[1]); }
  if (!m.acceptLanguage) { score += 15; reasons.push('no Accept-Language header (every browser sends one)'); }
  if (!m.js) { score += 20; reasons.push("never ran the page's JavaScript"); }
  const in10 = a.hits.filter(t => now - t < 10000).length;
  if (in10 > 20) { score += 40; reasons.push(in10 + ' requests in 10 s'); }
  else if (in10 > 8) { score += 25; reasons.push(in10 + ' requests in 10 s'); }
  const p = a.pages.slice(-5);
  if (p.length === 5 && p.every((x, i) => i === 0 || x === p[i - 1] + 1)) { score += 25; reasons.push('walks the pages in order (' + p.join(', ') + ')'); }
  const h = a.hits.slice(-9);
  if (h.length === 9) {
    const d = [];
    for (let i = 1; i < h.length; i++) d.push(h[i] - h[i - 1]);
    const md = mean(d);
    if (md > 0 && std(d) / md < 0.15) { score += 20; reasons.push('requests arrive on a timer (every ~' + Math.round(md) + ' ms)'); }
  }
  if (a.honeypot) { score += 100; reasons.push('requested a trap item that is hidden from people'); }
  if (m.human) { score -= 30; reasons.push('carries a verified human pass'); }
  score = Math.max(0, Math.min(100, score));
  const decision = score < 30 ? 'allow' : score < 55 ? 'slow' : score < 80 ? 'decoy' : 'block';
  return settle(a, decision, score, reasons);
}

// "slow" never holds a connection open (that would bill the site, not the
// scraper): it answers 429 with Retry-After and the scraper pays the wait.
function settle(a, decision, score, reasons) {
  a.counts[decision] = (a.counts[decision] || 0) + 1;
  a.decision = decision; a.score = score; a.reasons = reasons;
  return { key: a.key, decision, score, reasons, retryAfterMs: decision === 'slow' ? 2000 : 0 };
}

// Network-only risk for one request, without touching any actor's history.
// Used to fold the connection's evidence into the human-check verdict.
function networkRisk(m) {
  let score = 0;
  const reasons = [];
  const ua = String(m.ua || '');
  const bad = BAD_UA.find(([rx]) => rx.test(ua));
  if (!ua) { score += 30; reasons.push('no User-Agent'); }
  else if (bad) { score += 45; reasons.push('client identifies itself as ' + bad[1]); }
  if (!m.acceptLanguage) { score += 15; reasons.push('no Accept-Language header'); }
  if (m.secFetch === false) { score += 10; reasons.push('no Sec-Fetch headers (browsers send them)'); }
  return { score: Math.min(100, score), reasons };
}

function state() {
  return [...actors.values()].sort((x, y) => y.last - x.last).slice(0, 60).map(a => ({
    key: a.key, ua: a.ua, score: a.score, decision: a.decision, reasons: a.reasons, counts: a.counts,
    requestsLastMinute: a.hits.length, lastSeen: a.last,
  }));
}
function reset() { actors.clear(); }

// ---------- the protected listing (a demo catalogue) ----------
const ADJ = ['Silent', 'Copper', 'Northern', 'Hollow', 'Velvet', 'Paper', 'Distant', 'Golden', 'Quiet', 'Broken', 'Electric', 'Salt'];
const NOUN = ['Harbor', 'Orchard', 'Lantern', 'Atlas', 'Meridian', 'Garden', 'Signal', 'River', 'Archive', 'Comet', 'Bridge', 'Season'];
function item(page, k) {
  const n = (page - 1) * 12 + k;
  const h = crypto.createHash('sha256').update('book' + n).digest();
  return {
    sku: 'NW-' + String(10000 + n),
    title: 'The ' + ADJ[h[0] % ADJ.length] + ' ' + NOUN[h[1] % NOUN.length],
    author: ['A. Rivera', 'M. Okafor', 'L. Chen', 'S. Novak', 'R. Iyer', 'J. Moreau'][h[2] % 6],
    price: +(8 + (h[3] % 40) + (h[4] % 100) / 100).toFixed(2),
    stock: h[5] % 30,
  };
}
function catalog(page) {
  const p = Math.max(1, Math.min(50, page | 0 || 1));
  return { page: p, pages: 50, items: Array.from({ length: 12 }, (_, k) => item(p, k)) };
}
// Decoy: plausible data, wrong prices, and one canary record tied to this
// visitor. If it turns up in a competitor's feed, you know who scraped it.
function decoy(page, key) {
  const real = catalog(page);
  const tag = crypto.createHash('sha256').update('canary' + key).digest('hex').slice(0, 8).toUpperCase();
  const items = real.items.map((it, k) => ({ ...it, price: +(it.price * (1.15 + (k % 4) * 0.07)).toFixed(2) }));
  items[(page * 7) % 12] = { sku: 'CM-CANARY-' + tag, title: 'The Harbor Atlas (Collector Edition)', author: 'R. Iyer', price: 41.17, stock: 3 };
  return { page: real.page, pages: real.pages, items, canary: 'CM-CANARY-' + tag };
}

module.exports = { assess, state, reset, catalog, decoy, keyFor, networkRisk };
