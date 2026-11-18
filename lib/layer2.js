'use strict';
// Layer 2: post-verification capture and analysis.
//
//   Layer 1  (CaptchaMe checks)   decides pass or fail on one challenge.
//   Layer 2  (this file)          takes every packet layer 1 produces, plus every later request that uses
//                                 the pass, and answers four questions:
//     1. WHO     one identity per real client, merged across IP, network signature (header order and
//                shapes), TLS handshake hash when a proxy supplies one, browser fingerprint, cookies,
//                tokens and actor ids. Rotating IPs or user agents does not make a new person.
//     2. WHAT    which bypass family it belongs to: scripted HTTP client, automation browser, solver
//                service (token or answer relay), screenshot-think-act LLM agent, human-mimic, scraper,
//                declared agent, or an ordinary human.
//     3. WHERE   which layer flagged it (L1 network ... L7 decision), with the raw evidence line.
//     4. COST    what each identity consumed, what it scraped, and what the bypass cost the attacker.
//
// The bypass families come from reading the public 2captcha client libraries and demos (see docs/LAYER2.md):
// answer-only solving by workers or vision models, token relay with the caller's user agent and proxy,
// Puppeteer/Selenium drivers with fixed-step pointer paths, retry loops, and MCP tools that hand a browser
// to an agent.
//
// Honest limits (also in docs/LAYER2.md): this process sees HTTP, not the TLS ClientHello. A handshake hash
// is used only when a trusted proxy or CDN in front of it adds one. Everything is in memory, per instance.
const crypto = require('crypto');
const live = require('./live');

const MODE = process.env.LAYER2_MODE === 'shadow' ? 'shadow' : 'enforce';
const SALT = process.env.LAYER2_SALT || crypto.randomBytes(16).toString('hex');
const MAX_SUBJECTS = 4000;
const MERGE_AT = 1.0;
const BURST_MS = 20000; // same exact address within this window counts as one burst of activity

// Unit costs in dollars, assumptions an operator should replace with their own (README of docs/LAYER2.md).
const UNIT_USD = { 'challenge.start': 0.0002, 'challenge.cue': 0.00002, 'challenge.submit': 0.0004, 'rival.start': 0.0001, 'rival.verify': 0.0001, scrape: 0.002, trap: 0.002, 'agent.declare': 0.0002, 'pass.verify': 0.0001 };
const TLS_HEADERS = ['x-ja4', 'ja4', 'x-ja3-hash', 'ja3', 'cf-ja3-hash', 'cf-ja4', 'x-tls-fp', 'x-tls-fingerprint'];
const NOISE_HEADERS = /^(x-forwarded-|x-real-ip|x-cm-|x-invoke-|x-middleware-|x-nextjs|x-vercel|content-length|host$|connection$|cookie$|content-type$|origin$|referer$|if-none-match|if-modified-since|cache-control|pragma|priority|x-ja|ja[34]|cf-)/i;
const BAD_UA = /python-requests|aiohttp|httpx|urllib|curl\/|wget|scrapy|go-http-client|okhttp|java\/|node-fetch|axios|undici|\bgot\/|headlesschrome|phantomjs|puppeteer|playwright|selenium|firecrawl|crawl4ai|scrapingbee|zenrows|scraperapi/i;
// Published solve speeds from the 2captcha price list (seconds), for the market-pace tell.
const MARKET_S = { text: 1, math: 3, grid: 2, slider: 9, rotate: 6, click: 13, checkbox: 1, pow: 10 };
const HUMAN_FLOOR_MS = live.HUMAN_FLOOR_MS || {};

const CLASSES = ['human', 'declared_agent', 'llm_agent', 'solver_service', 'scripted_bot', 'automation_browser', 'human_mimic', 'scraper', 'unknown'];
const FAMILY_CLASS = { script: 'scripted_bot', automation: 'automation_browser', solver: 'solver_service', llm: 'llm_agent', mimic: 'human_mimic', scraper: 'scraper' };
const FAMILY_BLURB = {
  script: 'Programmatic client or script: no real hand, no real browser',
  automation: 'Driven browser (Puppeteer, Playwright, Selenium, headless)',
  solver: 'Solver service: the answer or the token was produced somewhere else and relayed',
  llm: 'Screenshot-think-act agent (LLM or vision model driving a browser)',
  mimic: 'Human-mimic: synthetic human-shaped input that passed the shape check',
  scraper: 'Scraper: drains content or data, not a verification problem',
};

const subjects = new Map();       // id -> subject
const alias = new Map();          // absorbed id -> surviving id
const linkIndex = new Map();      // "type|value" -> Set(subjectId)
const startSigs = new Map();      // challenge sid -> {ns, ipp, uah, at} (to catch a relay between start and submit)
const ipUas = new Map();          // address hash -> distinct user agents seen there (many = a shared network, not one client)
const lastPage = new Map();       // catalog page number -> {sid, at}
const totals = { packets: 0, merges: 0, since: Date.now(), byKind: {}, usd: 0 };
let counter = 0;

const hash = (s) => crypto.createHmac('sha256', SALT).update(String(s)).digest('base64url').slice(0, 12);
const maskIp = (ip) => { const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(ip); return v4 ? v4[1] + '.x' : String(ip).split(':').slice(0, 3).join(':') + ':x'; };
const prefixOf = (ip) => { const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(ip); return v4 ? v4[1] : String(ip).split(':').slice(0, 3).join(':'); };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const cvOf = (xs) => { const m = mean(xs); return m ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m : 0; };

// ------------------------------------------------------------------ capture: what one request tells us
function cookiesOf(req) {
  const out = {};
  String((req.headers && req.headers.cookie) || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function netSignature(req) {
  const raw = req.rawHeaders || [];
  const names = [];
  for (let i = 0; i < raw.length; i += 2) { const n = String(raw[i]).toLowerCase(); if (!NOISE_HEADERS.test(n)) names.push(n); }
  const h = req.headers || {};
  const shape = [h.accept || '', h['accept-encoding'] || '', h['sec-ch-ua-platform'] || '', h['sec-fetch-mode'] || '', h['upgrade-insecure-requests'] || ''].join('|');
  return { ns: hash(names.join(',') + '#' + shape), order: names.length };
}
function tlsOf(req) { for (const k of TLS_HEADERS) { const v = req.headers && req.headers[k]; if (v) return String(v).slice(0, 80); } return null; }
function envPrint(env) {
  if (!env || typeof env !== 'object') return null;
  return hash([env.plugins, env.hardware, env.langs, env.screen, env.outer, env.tz].join('|'));
}
function consistency(req, env) {
  const h = req.headers || {}, ua = String(h['user-agent'] || ''), out = [];
  const claimsChrome = /Chrome\//.test(ua) && !/HeadlessChrome/.test(ua);
  if (/HeadlessChrome/.test(ua)) out.push(['HEADLESS_UA', 'L1', 'script', 0, 'automation', 0.85, 'user agent says HeadlessChrome']);
  if (claimsChrome && !h['sec-ch-ua']) out.push(['UA_NO_CLIENT_HINTS', 'L1', 'automation', 0.5, 'automation', 0.5, 'user agent claims Chrome but sends no client hints: copied header set, not a real Chrome']);
  const plat = String(h['sec-ch-ua-platform'] || '').replace(/"/g, '');
  if (plat && ua) {
    const uaPlat = /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux|X11/.test(ua) ? 'Linux' : '';
    if (uaPlat && uaPlat !== plat) out.push(['UA_PLATFORM_MISMATCH', 'L1', 'automation', 0.6, 'automation', 0.6, 'user agent says ' + uaPlat + ' but client hint says ' + plat]);
  }
  const vUa = /Chrome\/(\d+)/.exec(ua), vCh = /"(?:Google Chrome|Chromium)";v="(\d+)"/.exec(String(h['sec-ch-ua'] || ''));
  if (vUa && vCh && vUa[1] !== vCh[1]) out.push(['UA_HINT_VERSION_MISMATCH', 'L1', 'automation', 0.6, 'automation', 0.6, 'user agent says Chrome ' + vUa[1] + ', client hint says ' + vCh[1]]);
  if (env && typeof env === 'object') {
    if (env.webdriver === true) out.push(['WEBDRIVER_FLAG', 'L3', 'automation', 0.95, 'automation', 0.95, 'navigator.webdriver = true']);
    if (claimsChrome && (env.outer === '0x0' || env.langs === 0)) out.push(['HEADLESS_WINDOW', 'L3', 'automation', 0.8, 'automation', 0.8, 'window ' + env.outer + ' and ' + env.langs + ' languages: a headless browser']);
    if (claimsChrome && env.plugins === 0 && env.hardware && env.hardware <= 4 && env.screen === '800x600') out.push(['DEFAULT_HEADLESS_SCREEN', 'L3', 'automation', 0.6, 'automation', 0.6, 'default headless screen size with no plugins']);
  }
  return out.map(([code, layer, , , family, w, text]) => ({ code, layer, family, w, text }));
}
function capture(req, kind, d) {
  const h = req.headers || {}, ip = String(h['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'na').split(',')[0].trim();
  const jar = cookiesOf(req), ua = String(h['user-agent'] || '');
  const sig = netSignature(req);
  return {
    ts: Date.now(), kind, ip, ipp: prefixOf(ip), ipHash: hash(ip), uah: hash(ua), ua: ua.slice(0, 140), ns: sig.ns, tls: tlsOf(req),
    vid: jar.cm_vid || null, actor: d.actor || (jar.pop_actor ? decodeURIComponent(jar.pop_actor) : null), attacker: d.attacker || 'unlabelled',
    headers: Object.keys(h).filter((k) => !NOISE_HEADERS.test(k)).length, hasLang: !!h['accept-language'], hasFetch: h['sec-fetch-mode'] !== undefined,
    envfp: envPrint(d.env), httpv: req.httpVersion || '1.1', d,
  };
}

// ------------------------------------------------------------------ identity: merge by independent links
function linksOf(o, extra) {
  const L = [];
  const add = (t, v) => { if (v) L.push([t, String(v)]); };
  add('vid', o.vid); add('actor', o.actor); add('jti', extra && extra.jti); add('sid', extra && extra.sid); // a signed challenge id ties the client that started it to whoever answered it
  add('envfp', o.envfp); add('ns', o.ns); add('tls', o.tls);
  add('ipx', o.ipHash); add('ipp', hash(o.ipp)); add('uah', o.uah);
  return L;
}
function weight(type, holders) {
  switch (type) {
    case 'vid': case 'actor': case 'jti': case 'sid': return 1.0;
    case 'envfp': return holders > 3 ? 0.3 : 0.7;
    case 'ns': return holders <= 2 ? 0.6 : 0.15;
    case 'tls': return holders <= 2 ? 0.6 : 0.2;
    case 'ipx': return holders > 4 ? 0.1 : 0.4; // holders = distinct browsers seen at this address
    case 'ipp': return 0.15;
    case 'uah': return 0.2;
    default: return 0;
  }
}
const resolveId = (id) => { let x = id; for (let i = 0; i < 20 && alias.has(x); i++) x = alias.get(x); return x; };
function newSubject(ts) {
  const id = 'S-' + hash('s' + (++counter) + ts).slice(0, 7).toLowerCase();
  const s = {
    id, created: ts, last: ts, obs: 0, links: new Map(), ips: new Map(), ipSet: new Set(), uas: new Map(), nss: new Map(), attackers: new Map(), actors: new Set(), merged: 0, mergeLog: [],
    ev: new Map(), ch: { starts: 0, passes: 0, fails: 0, recent: [], lags: [], startsAt: [] }, rival: { n: 0, solved: 0, byType: {}, times: [] },
    scrape: { hits: 0, pages: new Set(), decoys: 0, blocked: 0, slowed: 0, canaries: new Set(), ts: [] }, use: { calls: 0, usd: 0, denied: 0 }, trap: 0,
    agent: null, usd: 0, kinds: {}, timeline: [], layerHits: {}, cls: 'unknown', conf: 0, decision: 'allow', famScore: {}, human: 0,
  };
  subjects.set(id, s);
  if (subjects.size > MAX_SUBJECTS) { const old = subjects.keys().next().value; dropSubject(old); }
  return s;
}
function dropSubject(id) {
  const s = subjects.get(id); if (!s) return;
  for (const [t, set] of s.links) for (const v of set) { const k = t + '|' + v, ix = linkIndex.get(k); if (ix) { ix.delete(id); if (!ix.size) linkIndex.delete(k); } }
  subjects.delete(id);
}
function attach(s, links) {
  for (const [t, v] of links) {
    if (!s.links.has(t)) s.links.set(t, new Set());
    const set = s.links.get(t);
    if (set.size < 12) set.add(v);
    const k = t + '|' + v;
    if (!linkIndex.has(k)) linkIndex.set(k, new Set());
    linkIndex.get(k).add(s.id);
  }
}
function absorb(keep, gone, why) {
  if (keep.id === gone.id) return keep;
  for (const [t, set] of gone.links) { if (!keep.links.has(t)) keep.links.set(t, new Set()); for (const v of set) { if (keep.links.get(t).size < 12) keep.links.get(t).add(v); const ix = linkIndex.get(t + '|' + v); if (ix) { ix.delete(gone.id); ix.add(keep.id); } } }
  const addMap = (a, b) => { for (const [k, v] of b) a.set(k, (a.get(k) || 0) + v); };
  gone.ipSet.forEach((x) => { if (keep.ipSet.size < 400) keep.ipSet.add(x); }); addMap(keep.ips, gone.ips); addMap(keep.uas, gone.uas); addMap(keep.nss, gone.nss); addMap(keep.attackers, gone.attackers);
  gone.actors.forEach((a) => keep.actors.add(a));
  for (const [code, e] of gone.ev) { const k = keep.ev.get(code); if (k) { k.count += e.count; k.w = Math.max(k.w, e.w); } else keep.ev.set(code, e); }
  keep.obs += gone.obs; keep.usd += gone.usd; keep.trap += gone.trap;
  for (const f of ['starts', 'passes', 'fails']) keep.ch[f] += gone.ch[f];
  keep.ch.recent = keep.ch.recent.concat(gone.ch.recent).slice(-20); keep.ch.lags = keep.ch.lags.concat(gone.ch.lags).slice(-40); keep.ch.startsAt = keep.ch.startsAt.concat(gone.ch.startsAt).slice(-60);
  keep.rival.n += gone.rival.n; keep.rival.solved += gone.rival.solved; keep.rival.times = keep.rival.times.concat(gone.rival.times).slice(-40);
  for (const [t, v] of Object.entries(gone.rival.byType)) keep.rival.byType[t] = (keep.rival.byType[t] || 0) + v;
  keep.scrape.hits += gone.scrape.hits; gone.scrape.pages.forEach((p) => keep.scrape.pages.add(p)); gone.scrape.canaries.forEach((c) => keep.scrape.canaries.add(c));
  keep.scrape.decoys += gone.scrape.decoys; keep.scrape.blocked += gone.scrape.blocked; keep.scrape.slowed += gone.scrape.slowed; keep.scrape.ts = keep.scrape.ts.concat(gone.scrape.ts).slice(-80);
  keep.use.calls += gone.use.calls; keep.use.usd += gone.use.usd; keep.use.denied += gone.use.denied;
  if (gone.agent && !keep.agent) keep.agent = gone.agent;
  for (const [k, v] of Object.entries(gone.kinds)) keep.kinds[k] = (keep.kinds[k] || 0) + v;
  for (const [k, v] of Object.entries(gone.layerHits)) keep.layerHits[k] = (keep.layerHits[k] || 0) + v;
  keep.timeline = keep.timeline.concat(gone.timeline).sort((a, b) => a.t - b.t).slice(-60);
  keep.created = Math.min(keep.created, gone.created); keep.last = Math.max(keep.last, gone.last);
  keep.merged += 1 + gone.merged; keep.mergeLog.push(why); keep.mergeLog = keep.mergeLog.slice(-6);
  alias.set(gone.id, keep.id); subjects.delete(gone.id); totals.merges++;
  return keep;
}
function resolve(o, extra) {
  const links = linksOf(o, extra);
  let st = ipUas.get(o.ipHash); if (!st) { st = new Set(); ipUas.set(o.ipHash, st); if (ipUas.size > 20000) ipUas.delete(ipUas.keys().next().value); } if (st.size < 50) st.add(o.uah);
  const score = new Map(), why = new Map();
  for (const [t, v] of links) {
    const ix = linkIndex.get(t + '|' + v); if (!ix) continue;
    const w = weight(t, t === 'ipx' ? (ipUas.get(v) ? ipUas.get(v).size : 1) : ix.size);
    for (const id of ix) {
      if (!subjects.has(id)) continue;
      const key = id + '|' + t;
      if (!why.has(key)) { why.set(key, 1); score.set(id, (score.get(id) || 0) + w); why.set(id, (why.get(id) || []).concat(t)); }
      // burst: the same exact address, seen again within seconds, is almost surely the same client
      if (t === 'ipx' && o.ts - subjects.get(id).last < BURST_MS && !why.has(id + '|burst')) { why.set(id + '|burst', 1); score.set(id, (score.get(id) || 0) + 0.15); why.set(id, (why.get(id) || []).concat('burst')); }
    }
  }
  if (extra && extra.walkFrom && subjects.has(resolveId(extra.walkFrom))) { const id = resolveId(extra.walkFrom); score.set(id, (score.get(id) || 0) + 0.4); why.set(id, (why.get(id) || []).concat('walk')); }
  const hits = [...score.entries()].filter(([, sc]) => sc >= MERGE_AT).sort((a, b) => b[1] - a[1]);
  let s;
  if (hits.length) {
    s = subjects.get(hits[0][0]);
    for (const [id] of hits.slice(1)) { const g = subjects.get(id); if (g) s = absorb(s, g, 'merged with ' + id + ' on ' + (why.get(id) || []).join('+')); }
    const first = why.get(hits[0][0]) || [];
    if (first.length > 1 || (first[0] && !['vid', 'actor', 'jti'].includes(first[0]))) s.mergeLog = s.mergeLog.concat(['linked on ' + first.join('+')]).slice(-6);
  } else s = newSubject(o.ts);
  attach(s, links);
  return s;
}

// ------------------------------------------------------------------ evidence and classification
// agg = true: the evidence is recomputed from a running total on every packet, so it counts once however often it is re-raised.
function ev(s, family, code, layer, w, text, agg) {
  const k = s.ev.get(code);
  if (k) { if (!agg) k.count++; k.w = Math.max(k.w, w); k.last = Date.now(); if (text) k.text = text; }
  else s.ev.set(code, { family, code, layer, w, count: 1, text, first: Date.now(), last: Date.now() });
  s.layerHits[layer] = (s.layerHits[layer] || 0) + 1;
}
const FLAG_MAP = [
  [/missing \d+ of \d+ live/i, 'script', 'NO_LIVE_CUES', 'L5', 0.85],
  [/another browser|relayed challenge/i, 'solver', 'BROWSER_SWITCH', 'L6', 0.9],
  [/after the challenge started|queued or relayed|queued solve/i, 'solver', 'LATE_ANSWER', 'L5', 0.8],
  [/webdriver|automation control/i, 'automation', 'AUTOMATION_FLAG', 'L3', 0.9],
  [/computed, not performed/i, 'script', 'COMPUTED_NOT_PERFORMED', 'L5', 0.85],
  [/zero-lag|perfect tracking|script replaying|zero reaction time|before a human|before a flash|identical reaction|uniform/i, 'script', 'SCRIPTED_RESPONSE', 'L4', 0.85],
  [/synthetic sample clock/i, 'script', 'SYNTHETIC_CLOCK', 'L4', 0.5],
  [/look-think-act|never re-acquired|re-aim|took \d+ ms to re-acquire|one task at a time/i, 'llm', 'SLOW_REAIM', 'L4', 0.7],
  [/connection looks automated|http library|python|unusual connection/i, 'script', 'AUTOMATED_NETWORK', 'L1', 0.6],
  [/micro-correction|too few|steady stream/i, 'llm', 'NO_HAND_CORRECTIONS', 'L4', 0.35],
];
function famScores(s) {
  const f = {};
  for (const e of s.ev.values()) {
    if (!e.family || e.family === 'info') continue;
    const w = 1 - Math.pow(1 - e.w, Math.min(3, e.count));
    f[e.family] = 1 - (1 - (f[e.family] || 0)) * (1 - w);
  }
  return f;
}
function classify(s) {
  const f = famScores(s);
  s.famScore = f;
  // human-mimic means: passed the shape check, then failed the clock. An identity that already failed layer 1 is judged by how it failed.
  const cand = Object.entries(f).filter(([k]) => k !== 'mimic' || s.ch.passes > 0 || Object.keys(f).length === 1);
  const top = cand.sort((a, b) => b[1] - a[1])[0];
  const clean = s.ch.passes > 0 && s.ch.fails === 0;
  if (s.agent && s.agent.verified && (!top || top[1] < 0.7)) { s.cls = 'declared_agent'; s.conf = 0.95; }
  else if (s.scrape.hits >= 10 && s.ch.starts === 0 && (f.scraper || 0) >= 0.5) { s.cls = 'scraper'; s.conf = Math.min(0.99, +f.scraper.toFixed(2)); }
  else if (top && top[1] >= 0.5) { s.cls = FAMILY_CLASS[top[0]]; s.conf = Math.min(0.99, +top[1].toFixed(2)); }
  else if (clean) { s.cls = 'human'; s.conf = Math.min(0.9, 0.5 + 0.1 * s.ch.passes); }
  else if (top && top[1] >= 0.3) { s.cls = FAMILY_CLASS[top[0]]; s.conf = +top[1].toFixed(2); s.suspect = true; }
  else { s.cls = 'unknown'; s.conf = 0.2; }
  if (s.cls !== 'human' && s.cls !== 'unknown' && s.cls !== 'declared_agent') s.suspect = s.conf < 0.5;
  else s.suspect = false;
  // decision
  let d = 'allow', why = 'no bypass evidence';
  if (s.cls === 'declared_agent') { d = 'allow'; why = 'declared agent, served from its own lane'; }
  else if (['scripted_bot', 'automation_browser', 'solver_service'].includes(s.cls) && s.conf >= 0.8) { d = 'block'; why = FAMILY_BLURB[top[0]]; }
  else if (s.cls === 'llm_agent' && s.conf >= 0.6) { d = 'block'; why = FAMILY_BLURB.llm + '; declare it at /agent for its own lane'; }
  else if (s.cls === 'human_mimic' && s.conf >= 0.5) { d = 'step_up'; why = FAMILY_BLURB.mimic + '; ask for a fresh live check'; }
  else if (s.cls === 'scraper' && s.conf >= 0.5) { d = 'slow'; why = FAMILY_BLURB.scraper; }
  else if (s.conf >= 0.3 && s.cls !== 'human' && s.cls !== 'unknown') { d = 'step_up'; why = 'weak evidence of ' + s.cls.replace('_', ' ') + '; ask for a live check'; }
  const rate = s.ch.startsAt.filter((t) => Date.now() - t < 60000).length;
  if (rate >= 6) { ev(s, 'solver', 'ATTEMPT_VELOCITY', 'L7', 0.5, rate + ' challenge starts in the last minute: a retry loop', true); }
  s.decision = d; s.why = why;
  return s;
}

// ------------------------------------------------------------------ the per-kind analysis
function onStart(s, o) { s.ch.starts++; s.ch.startsAt.push(o.ts); if (s.ch.startsAt.length > 60) s.ch.startsAt.shift(); if (o.d.sid) { startSigs.set(o.d.sid, { ns: o.ns, ipp: o.ipp, uah: o.uah, at: o.ts }); if (startSigs.size > 6000) startSigs.delete(startSigs.keys().next().value); } }
function onSubmit(s, o) {
  const d = o.d;
  if (d.passed) s.ch.passes++; else s.ch.fails++;
  if (d.detail && Number.isFinite(d.detail.lagMs)) { s.ch.lags.push(d.detail.lagMs); if (s.ch.lags.length > 40) s.ch.lags.shift(); }
  s.ch.recent.push({ t: o.ts, type: d.type, ok: !!d.passed, score: d.score, elapsed: d.elapsedMs }); if (s.ch.recent.length > 20) s.ch.recent.shift();
  // relay: started from one network signature, answered from another
  const st = d.sid && startSigs.get(d.sid);
  if (st) {
    if (st.ns !== o.ns) ev(s, 'solver', 'SIGNATURE_SWITCH', 'L6', 0.85, 'started with network signature ' + st.ns + ' and answered with ' + o.ns + ': the challenge was handed to another client');
    if (st.ipp !== o.ipp) ev(s, 'solver', 'NETWORK_SWITCH', 'L6', 0.7, 'started from ' + st.ipp + '.x and answered from ' + o.ipp + '.x');
  }
  // layer-1 flags, mapped to bypass families
  for (const f of d.flags || []) { for (const [rx, fam, code, layer, w] of FLAG_MAP) { if (rx.test(f)) { ev(s, fam, code, layer, w, f); break; } } }
  // raw measurements, so the verdict does not hinge on which flags layer 1 happened to raise this run
  const lag = d.detail && d.detail.lagMs, cor = d.detail && d.detail.corrections;
  if (Number.isFinite(lag) && lag >= 500 && lag <= 3000) ev(s, 'llm', 'LAG_TOO_SLOW', 'L4', 0.5, 'cursor ran ' + lag + ' ms behind the ring; people run 80-350 ms behind');
  if (Number.isFinite(cor) && cor <= 3 && d.detail.samples >= 30) ev(s, 'llm', 'FEW_CORRECTIONS', 'L4', 0.4, cor + ' corrections in a full run; a hand makes dozens');
  // human-mimic tell: the samples cover more time than the wall clock allowed
  if (Number.isFinite(d.samplesMaxT) && Number.isFinite(d.elapsedMs) && d.samplesMaxT > d.elapsedMs + 250) {
    ev(s, 'mimic', 'CLOCK_SKEW', 'L5', 0.85, 'pointer samples span ' + Math.round(d.samplesMaxT) + ' ms but only ' + Math.round(d.elapsedMs) + ' ms passed on the server: the path was generated, not performed');
  }
  // too-steady lag across several runs of the same identity
  if (s.ch.lags.length >= 4) { const m = mean(s.ch.lags), sd = Math.sqrt(mean(s.ch.lags.map((x) => (x - m) ** 2))); if (sd < 4) ev(s, 'mimic', 'SAME_LAG_EVERY_RUN', 'L4', 0.6, 'tracking lag ' + Math.round(m) + ' ms with a spread of only ' + sd.toFixed(1) + ' ms over ' + s.ch.lags.length + ' runs', true); }
  if (d.passed && !(d.flags || []).length) s.human += 1;
}
function onRival(s, o) {
  const d = o.d;
  s.rival.n++;
  if (d.ok) { s.rival.solved++; s.rival.byType[d.type] = (s.rival.byType[d.type] || 0) + 1; s.rival.times.push({ type: d.type, ms: d.elapsedMs }); if (s.rival.times.length > 40) s.rival.times.shift(); }
  const solved = s.rival.times;
  const types = new Set(solved.map((x) => x.type));
  const floors = solved.filter((x) => (HUMAN_FLOOR_MS[x.type] || 0) > 0);
  const instant = floors.filter((x) => x.ms < 0.35 * HUMAN_FLOOR_MS[x.type]);
  if (instant.length >= 2) ev(s, 'script', 'INSTANT_SOLVES', 'L5', 0.8, instant.length + ' puzzles solved in under 35% of the time a person needs to read them', true);
  const marketHits = solved.filter((x) => MARKET_S[x.type] && x.ms / 1000 > 0.4 * MARKET_S[x.type] && x.ms / 1000 < 1.5 * MARKET_S[x.type] && x.type !== 'checkbox' && x.type !== 'pow');
  const mTypes = new Set(marketHits.map((x) => x.type));
  if (mTypes.size >= 3 && marketHits.length >= 0.7 * solved.filter((x) => x.type !== 'checkbox' && x.type !== 'pow').length) ev(s, 'solver', 'MARKET_SOLVE_PACE', 'L5', 0.7, 'answers arrive at the published solver-farm speed for ' + mTypes.size + ' different formats', true);
  const slow = solved.filter((x) => x.ms >= 2000 && x.ms <= 9000 && x.type !== 'pow');
  if (types.size >= 4 && slow.length >= 4 && cvOf(slow.map((x) => x.ms)) < 0.35 && s.rival.solved === s.rival.n) ev(s, 'llm', 'UNIFORM_AI_PACE', 'L5', 0.5, 'every format solved correctly in 2-9 s at a steady pace: a vision model, not a person', true);
  if (d.webdriver) ev(s, 'automation', 'WEBDRIVER_FLAG', 'L3', 0.95, 'navigator.webdriver = true on a rival captcha');
}
function onScrape(s, o) {
  const d = o.d;
  s.scrape.hits++; s.scrape.ts.push(o.ts); if (s.scrape.ts.length > 80) s.scrape.ts.shift();
  if (Number.isFinite(d.page)) s.scrape.pages.add(d.page);
  if (d.decision === 'decoy') s.scrape.decoys++;
  if (d.decision === 'block') s.scrape.blocked++;
  if (d.decision === 'slow') s.scrape.slowed++;
  if (d.canary) s.scrape.canaries.add(d.canary);
  const ts = s.scrape.ts.filter((t) => o.ts - t < 60000);
  if (ts.length >= 15) ev(s, 'scraper', 'SCRAPE_RATE', 'L1', ts.length >= 40 ? 0.85 : 0.6, ts.length + ' catalog requests in the last minute', true);
  const pages = [...s.scrape.pages].sort((a, b) => a - b);
  let run = 1, best = 1; for (let i = 1; i < pages.length; i++) { run = pages[i] === pages[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
  if (best >= 4) ev(s, 'scraper', 'PATH_ENUMERATION', 'L1', 0.7, 'walked ' + best + ' catalog pages in order', true);
  if (d.decision === 'decoy' || d.decision === 'block') ev(s, 'scraper', 'SHIELD_' + String(d.decision).toUpperCase(), 'L1', d.decision === 'decoy' ? 0.7 : 0.6, 'scraper shield answered ' + d.decision + (d.reasons && d.reasons[0] ? ': ' + d.reasons[0] : ''));
  if (BAD_UA.test(o.ua)) ev(s, 'scraper', 'TOOL_USER_AGENT', 'L1', 0.5, 'user agent is a known HTTP or scraping tool');
}
function onUse(s, o) { s.use.calls++; if (o.d.ok) s.use.usd += o.d.usd || 0; else s.use.denied++; }

// ------------------------------------------------------------------ public: observe one packet
function observe(req, kind, d = {}) {
  try {
    const o = capture(req, kind, d);
    const extra = { jti: d.jti, sid: d.sid };
    // walk continuity: catalog page n right after page n-1 from a different address
    if (kind === 'scrape' && Number.isFinite(d.page)) { const prev = lastPage.get(d.page - 1); if (prev && o.ts - prev.at < 15000) extra.walkFrom = prev.sid; }
    const s = resolve(o, extra);
    if (kind === 'scrape' && Number.isFinite(d.page)) { lastPage.set(d.page, { sid: s.id, at: o.ts }); if (lastPage.size > 400) lastPage.delete(lastPage.keys().next().value); }
    s.obs++; s.last = o.ts; s.kinds[kind] = (s.kinds[kind] || 0) + 1;
    if (s.ipSet.size < 400) s.ipSet.add(o.ipHash);
    s.ips.set(maskIp(o.ip), (s.ips.get(maskIp(o.ip)) || 0) + 1); s.uas.set(o.ua || '(none)', (s.uas.get(o.ua || '(none)') || 0) + 1); s.nss.set(o.ns, (s.nss.get(o.ns) || 0) + 1);
    s.attackers.set(o.attacker, (s.attackers.get(o.attacker) || 0) + 1);
    if (o.actor) s.actors.add(String(o.actor).slice(0, 40));
    if (d.agent && d.agent.verified) s.agent = { verified: true, id: String(d.agent.id || 'declared').slice(0, 60), at: o.ts };
    const unit = UNIT_USD[kind] || 0; s.usd += unit; totals.usd += unit; totals.packets++; totals.byKind[kind] = (totals.byKind[kind] || 0) + 1;
    // network-level evidence on every packet
    for (const c of consistency(req, d.env)) ev(s, c.family, c.code, c.layer, c.w, c.text);
    if (BAD_UA.test(o.ua) && !/headless/i.test(o.ua)) ev(s, 'script', 'TOOL_USER_AGENT', 'L1', 0.6, 'user agent is ' + o.ua.slice(0, 50));
    if (!o.hasLang) ev(s, 'script', 'NO_ACCEPT_LANGUAGE', 'L1', 0.3, 'no Accept-Language header');
    if (!o.hasFetch && kind !== 'scrape') ev(s, 'script', 'NO_FETCH_METADATA', 'L1', 0.25, 'no Sec-Fetch headers: not a browser fetch');
    if (o.headers < 6) ev(s, 'script', 'FEW_HEADERS', 'L1', 0.35, o.headers + ' headers: HTTP libraries send 3-5, browsers 10+');
    // identity-level evidence
    if (s.nss.size === 1 && s.uas.size >= 3) ev(s, 'solver', 'ONE_STACK_MANY_USER_AGENTS', 'L1', 0.5, s.uas.size + ' different user agents from one network signature: rotated labels on one client', true);
    if (s.ipSet.size >= 4 && s.nss.size <= 2) ev(s, 'solver', 'IP_ROTATION', 'L1', 0.5, s.ipSet.size + ' different addresses from one client signature: a proxy pool', true);
    if (kind === 'challenge.start') onStart(s, o);
    else if (kind === 'challenge.submit') onSubmit(s, o);
    else if (kind === 'rival.verify') onRival(s, o);
    else if (kind === 'scrape') onScrape(s, o);
    else if (kind === 'protected') onUse(s, o);
    else if (kind === 'trap') { s.trap++; ev(s, 'scraper', 'TRAP_LINK', 'L1', 0.85, 'followed the invisible trap link: reads the raw page'); }
    else if (kind === 'agent.declare') { s.agent = { verified: !!d.verified, id: String(d.agentId || 'declared').slice(0, 60), at: o.ts }; }
    s.timeline.push({ t: o.ts, kind, note: String(d.note || '').slice(0, 140), ok: d.passed === undefined ? d.ok : d.passed });
    if (s.timeline.length > 60) s.timeline.shift();
    classify(s);
    const verdict = { subject: s.id, cls: s.cls, conf: s.conf, decision: s.decision, why: s.why, identities: { ips: s.ipSet.size, uas: s.uas.size, signatures: s.nss.size, actors: s.actors.size, merged: s.merged } };
    // hand the packet to the live room
    if (!d.quiet) {
      const L = live.attempt('l2', d.sid || s.id, kind, o.attacker);
      L('P2', s.decision === 'block' ? 'block' : s.decision === 'allow' ? 'ok' : 'flag', 'packet ' + kind + (d.type ? ' (' + d.type + ')' : '') + ' -> identity ' + s.id + ' (' + s.ipSet.size + ' address' + (s.ipSet.size === 1 ? '' : 'es') + ', ' + s.uas.size + ' user agent' + (s.uas.size === 1 ? '' : 's') + ', ' + s.merged + ' merged) -> ' + s.cls + ' ' + Math.round(s.conf * 100) + '% -> ' + s.decision.toUpperCase(), { final: kind === 'challenge.submit' || kind === 'rival.verify', l2: verdict });
    }
    return verdict;
  } catch (e) {
    return { subject: null, cls: 'unknown', conf: 0, decision: 'allow', why: 'layer 2 error: ' + e.message, identities: {} };
  }
}

// What the protected API asks before it serves a call. Shadow mode records and allows.
function gate(actor) {
  const id = actor ? findByActor(actor) : null;
  const s = id ? subjects.get(id) : null;
  if (!s) return { allow: true, decision: 'allow', mode: MODE, reason: 'no layer 2 record' };
  classify(s);
  const blocked = s.decision === 'block' || s.decision === 'step_up';
  return { allow: MODE === 'shadow' || !blocked, decision: s.decision, subject: s.id, cls: s.cls, conf: s.conf, mode: MODE, reason: s.why, would: blocked && MODE === 'shadow' };
}
function findByActor(actor) {
  const ix = linkIndex.get('actor|' + String(actor));
  if (!ix) return null;
  for (const id of ix) if (subjects.has(id)) return id;
  return null;
}

// ------------------------------------------------------------------ read side: the analysis
const topEv = (s, n = 8) => [...s.ev.values()].sort((a, b) => b.w * Math.min(3, b.count) - a.w * Math.min(3, a.count)).slice(0, n).map((e) => ({ code: e.code, layer: e.layer, family: e.family, weight: +e.w.toFixed(2), count: e.count, text: e.text }));
function brief(s) {
  classify(s);
  return {
    id: s.id, cls: s.cls, conf: s.conf, decision: s.decision, why: s.why, suspect: !!s.suspect, first: s.created, last: s.last, obs: s.obs, usd: +s.usd.toFixed(5),
    identities: { ips: s.ipSet.size, uas: s.uas.size, signatures: s.nss.size, actors: s.actors.size, merged: s.merged }, attackers: [...s.attackers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
    challenges: { starts: s.ch.starts, passes: s.ch.passes, fails: s.ch.fails }, rival: { attempts: s.rival.n, solved: s.rival.solved }, scrape: { hits: s.scrape.hits, pages: s.scrape.pages.size, decoys: s.scrape.decoys },
    protectedCalls: s.use.calls, protectedUsd: +s.use.usd.toFixed(3), families: Object.fromEntries(Object.entries(s.famScore).map(([k, v]) => [k, +v.toFixed(2)])), top: topEv(s, 3),
  };
}
function detail(id) {
  const s = subjects.get(resolveId(id)); if (!s) return null;
  const b = brief(s);
  return { ...b, evidence: topEv(s, 20), ips: [...s.ips.entries()].map(([ip, n]) => ({ ip, n })), userAgents: [...s.uas.entries()].map(([ua, n]) => ({ ua, n })), signatures: [...s.nss.entries()].map(([ns, n]) => ({ ns, n })),
    links: Object.fromEntries([...s.links.entries()].map(([t, set]) => [t, set.size])), mergeLog: s.mergeLog, kinds: s.kinds, layerHits: s.layerHits, timeline: s.timeline.slice(-40), recentChallenges: s.ch.recent, rivalTimes: s.rival.times.slice(-12),
    scraped: { pages: [...s.scrape.pages].sort((a, b) => a - b).slice(0, 60), canaries: [...s.scrape.canaries].slice(0, 5), decoys: s.scrape.decoys, blocked: s.scrape.blocked, slowed: s.scrape.slowed } };
}
function overview() {
  const list = [...subjects.values()].map((s) => { classify(s); return s; });
  const byClass = {};
  for (const c of CLASSES) byClass[c] = { count: 0, usd: 0, obs: 0 };
  for (const s of list) { const b = byClass[s.cls] || (byClass[s.cls] = { count: 0, usd: 0, obs: 0 }); b.count++; b.usd += s.usd + s.use.usd; b.obs += s.obs; }
  const layers = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'], fams = Object.keys(FAMILY_CLASS);
  const matrix = {}; for (const l of layers) { matrix[l] = {}; for (const f of fams) matrix[l][f] = 0; }
  for (const s of list) for (const e of s.ev.values()) { if (matrix[e.layer] && matrix[e.layer][e.family] !== undefined) matrix[e.layer][e.family] += e.count; }
  const pages = new Set(); let decoys = 0, scrapeHits = 0, canaries = 0; const scrapeBy = {};
  for (const s of list) { s.scrape.pages.forEach((p) => pages.add(p)); decoys += s.scrape.decoys; scrapeHits += s.scrape.hits; canaries += s.scrape.canaries.size; if (s.scrape.hits) { const b = scrapeBy[s.cls] || (scrapeBy[s.cls] = { identities: 0, hits: 0, pages: 0 }); b.identities++; b.hits += s.scrape.hits; b.pages += s.scrape.pages.size; } }
  const rivalBeaten = {}; let rivalSolved = 0, attackerSpend = 0;
  for (const s of list) for (const [t, n] of Object.entries(s.rival.byType)) { rivalBeaten[t] = (rivalBeaten[t] || 0) + n; rivalSolved += n; attackerSpend += n * ((live.MARKET[t] && live.MARKET[t].per) || 0); }
  const merged = list.filter((s) => s.merged > 0).sort((a, b) => b.merged - a.merged).slice(0, 8).map((s) => ({ id: s.id, cls: s.cls, merged: s.merged, ips: s.ipSet.size, uas: s.uas.size, signatures: s.nss.size, log: s.mergeLog.slice(-3) }));
  const protectedUsd = list.reduce((a, s) => a + s.use.usd, 0), botUsd = list.filter((s) => !['human', 'declared_agent', 'unknown'].includes(s.cls)).reduce((a, s) => a + s.usd + s.use.usd, 0);
  return {
    mode: MODE, since: totals.since, packets: totals.packets, byKind: totals.byKind, identities: list.length, merges: totals.merges, unitCosts: UNIT_USD,
    usd: { total: +(totals.usd + protectedUsd).toFixed(4), onBots: +botUsd.toFixed(4), protectedApi: +protectedUsd.toFixed(3) },
    classes: Object.entries(byClass).map(([cls, v]) => ({ cls, count: v.count, usd: +v.usd.toFixed(4), obs: v.obs })), matrix, families: FAMILY_BLURB,
    scraping: { catalogPagesTouched: pages.size, hits: scrapeHits, decoysServed: decoys, canariesPlanted: canaries, byClass: scrapeBy },
    bypass: { rivalSolved, rivalBeaten, attackerSpendUsd: +attackerSpend.toFixed(5), layer1Blocked: list.reduce((a, s) => a + s.ch.fails, 0), layer1Passed: list.reduce((a, s) => a + s.ch.passes, 0) },
    merged, top: list.sort((a, b) => (b.usd + b.use.usd) - (a.usd + a.use.usd)).slice(0, 14).map(brief),
  };
}
// Evidence that arrives without the visitor's own request (a customer backend reports a relayed pass).
function noteActor(actor, code, family, layer, w, text) {
  const id = findByActor(actor); const s = id && subjects.get(id); if (!s) return false;
  ev(s, family, code, layer, w, text); s.timeline.push({ t: Date.now(), kind: 'note', note: code, ok: false }); classify(s); return true;
}
// The protected API refused a call that observe() had counted as served.
function denied(id, usd) { const s = subjects.get(resolveId(id)); if (!s) return; s.use.usd = Math.max(0, s.use.usd - (usd || 0)); s.use.denied++; }
function reset() { subjects.clear(); alias.clear(); linkIndex.clear(); ipUas.clear(); startSigs.clear(); lastPage.clear(); totals.packets = 0; totals.merges = 0; totals.usd = 0; totals.byKind = {}; totals.since = Date.now(); counter = 0; }

module.exports = { observe, gate, noteActor, denied, overview, detail, reset, CLASSES, FAMILY_BLURB, MODE };
