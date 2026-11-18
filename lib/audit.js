'use strict';
// Zero-install bot cost audit. Takes raw access-log text (Apache/Nginx
// combined format, or JSON lines), classifies every request by who sent it,
// groups requests into actors (IP + user agent), and prices the automated
// share with the site's own unit costs. Nothing is stored.

const AI = /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|CCBot|Bytespider|Amazonbot|meta-externalagent|meta-externalfetcher|Diffbot|cohere-ai|YouBot|Google-CloudVertexBot|Applebot-Extended|Timpibot|ImagesiftBot/i;
const SEARCH = /Googlebot|bingbot|DuckDuckBot|YandexBot|Baiduspider|Applebot|Slurp|SeznamBot/i;
const SCRIPT = /python-requests|aiohttp|httpx|urllib|curl\/|wget|scrapy|go-http-client|okhttp|java\/|node-fetch|axios|undici|got\/|libwww|httpclient|firecrawl|crawl4ai|scrapingbee|zenrows|scraperapi/i;
const HEADLESS = /HeadlessChrome|PhantomJS|puppeteer|playwright|selenium/i;
const BROWSER = /Mozilla\/5\.0 .*(Chrome|Firefox|Safari|Edg)\//;
const ASSET = /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|map)(\?|$)/i;
const CLF = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseTime(s) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (m) return Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function parseLine(line) {
  const m = CLF.exec(line);
  if (m) return { ip: m[1], t: parseTime(m[2]), method: m[3], path: m[4], status: +m[5], bytes: m[6] === '-' ? 0 : +m[6], ua: m[8] || '' };
  if (line[0] === '{') {
    try {
      const j = JSON.parse(line);
      const req = j.request || j.req || '';
      return {
        ip: j.ip || j.remote_addr || j.client_ip || j.clientIP || '',
        t: parseTime(j.time || j.timestamp || j.time_local || j['@timestamp']),
        method: j.method || String(req).split(' ')[0] || 'GET',
        path: j.path || j.uri || j.url || String(req).split(' ')[1] || '/',
        status: +(j.status || j.status_code || 0), bytes: +(j.bytes || j.body_bytes_sent || j.size || 0),
        ua: j.ua || j.user_agent || j.http_user_agent || j.userAgent || '',
      };
    } catch { return null; }
  }
  return null;
}

const CLASSES = {
  person: 'People in browsers',
  search: 'Search engines (claimed)',
  ai: 'AI crawlers and agents (claimed)',
  script: 'Scripts and HTTP libraries',
  headless: 'Headless browsers',
  scraper: 'Browser-looking scrapers',
};

function analyze(text, opts = {}) {
  const costPer1k = Number(opts.costPer1k) >= 0 ? Number(opts.costPer1k) : 0.40;
  const costPerGB = Number(opts.costPerGB) >= 0 ? Number(opts.costPerGB) : 0.09;
  const lines = String(text || '').split(/\r?\n/).slice(0, 200000);
  const rows = [];
  let skipped = 0;
  for (const l of lines) { if (!l.trim()) continue; const r = parseLine(l.trim()); if (r && r.ip) rows.push(r); else skipped++; }

  // actors: ip + user agent
  const actors = new Map();
  for (const r of rows) {
    const k = r.ip + '|' + r.ua;
    let a = actors.get(k);
    if (!a) { a = { ip: r.ip, ua: r.ua, n: 0, bytes: 0, assets: 0, pages: [], times: [], errors: 0, robots: 0 }; actors.set(k, a); }
    a.n++; a.bytes += r.bytes || 0;
    if (ASSET.test(r.path)) a.assets++;
    if (r.status >= 400) a.errors++;
    if (/^\/robots\.txt/.test(r.path)) a.robots++;
    if (r.t !== null) a.times.push(r.t);
    const pm = /[?&]page=(\d+)/.exec(r.path);
    if (pm) a.pages.push(+pm[1]);
  }

  for (const a of actors.values()) {
    const reasons = [];
    let cls;
    if (!a.ua) { cls = 'script'; reasons.push('no user agent'); }
    else if (AI.test(a.ua)) { cls = 'ai'; reasons.push('declares itself ' + a.ua.match(AI)[0]); }
    else if (SEARCH.test(a.ua)) { cls = 'search'; reasons.push('declares itself ' + a.ua.match(SEARCH)[0]); }
    else if (HEADLESS.test(a.ua)) { cls = 'headless'; reasons.push('headless browser user agent'); }
    else if (SCRIPT.test(a.ua)) { cls = 'script'; reasons.push('HTTP library user agent (' + a.ua.match(SCRIPT)[0].replace(/\/$/, '') + ')'); }
    else if (BROWSER.test(a.ua)) cls = 'person';
    else { cls = 'script'; reasons.push('unusual user agent'); }

    if (cls === 'person') {
      a.times.sort((x, y) => x - y);
      let peak = 0;
      for (let i = 0, j = 0; i < a.times.length; i++) { while (a.times[i] - a.times[j] > 60000) j++; peak = Math.max(peak, i - j + 1); }
      a.peakPerMin = peak;
      let seq = 0;
      for (let i = 1; i < a.pages.length; i++) if (a.pages[i] === a.pages[i - 1] + 1) seq++;
      const pageReqs = a.n - a.assets;
      if (peak > 60) reasons.push(peak + ' requests in one minute');
      if (seq >= 5) reasons.push('walked ' + (seq + 1) + ' pages in order');
      if (pageReqs >= 30 && a.assets === 0) reasons.push(pageReqs + ' page requests and no images, styles or scripts');
      if (reasons.length) cls = 'scraper';
    }
    a.cls = cls; a.reasons = reasons;
  }

  const by = {};
  for (const c of Object.keys(CLASSES)) by[c] = { key: c, label: CLASSES[c], requests: 0, bytes: 0, actors: 0, errors: 0, robots: 0 };
  for (const a of actors.values()) { const b = by[a.cls]; b.requests += a.n; b.bytes += a.bytes; b.actors++; b.errors += a.errors; b.robots += a.robots; }

  const times = rows.map(r => r.t).filter(t => t !== null).sort((x, y) => x - y);
  const spanMs = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  const automated = ['ai', 'script', 'headless', 'scraper'];
  const autoReq = automated.reduce((s, c) => s + by[c].requests, 0);
  const autoBytes = automated.reduce((s, c) => s + by[c].bytes, 0);
  const cost = (req, bytes) => req / 1000 * costPer1k + bytes / 1e9 * costPerGB;
  const monthFactor = spanMs >= 3600000 ? (30 * 86400000) / spanMs : null;

  const top = [...actors.values()].filter(a => a.cls !== 'person').sort((x, y) => y.n - x.n).slice(0, 12).map(a => ({
    ip: a.ip, ua: a.ua.slice(0, 120), class: a.cls, label: CLASSES[a.cls], requests: a.n, bytes: a.bytes, reasons: a.reasons,
  }));

  const recs = [];
  if (by.scraper.requests + by.script.requests + by.headless.requests > 0) recs.push('Turn on the Scraper blocking pack: ' + (by.scraper.requests + by.script.requests + by.headless.requests).toLocaleString() + ' requests came from scripts, headless browsers or browser-looking scrapers.');
  if (by.ai.requests > 0) recs.push('Set a rule per AI crawler (allow, limit or charge): ' + by.ai.requests.toLocaleString() + ' requests from crawlers that name an AI company. Their claimed identity should be verified before you trust it.');
  if (by.search.requests > 0) recs.push('Keep search engines allowed, but verify them: ' + by.search.requests.toLocaleString() + ' requests claim to be search engines.');
  if (!recs.length) recs.push('Very little automation in this sample. Run watch-only mode on live traffic before turning anything on.');

  return {
    lines: rows.length, skipped, actors: actors.size, spanMs,
    classes: Object.values(by),
    automated: { requests: autoReq, share: rows.length ? autoReq / rows.length : 0, bytes: autoBytes, costUsd: +cost(autoReq, autoBytes).toFixed(2), monthlyCostUsd: monthFactor ? +(cost(autoReq, autoBytes) * monthFactor).toFixed(2) : null },
    assumptions: { costPer1k, costPerGB },
    top, recommendations: recs,
  };
}

module.exports = { analyze, parseLine };
