'use strict';
// Built-in attackers for the live attack room.
// Each one hits this same server over real HTTP, with its own headers and its
// own address, exactly like an outside tool would. They attack the demo rival
// formats in lib/classic.js (local recreations, not vendor products) and the
// CaptchaMe check. Their "vision" is reading the demo SVG, a stand-in for the
// OCR and vision models solver farms use on real images.
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const actors = require('../test/actors');
const live = require('./live');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0';
const RIVALS = ['text', 'math', 'grid', 'slider', 'rotate', 'click', 'checkbox', 'pow'];

function browser(ua, hints) {
  return {
    'user-agent': ua, accept: '*/*', 'accept-language': 'en-US,en;q=0.9', 'accept-encoding': 'gzip, deflate, br',
    'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty',
    ...(hints ? { 'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"' } : {}),
  };
}
const MARKET_MS = { text: 1000, math: 3000, grid: 2000, slider: 9000, rotate: 6000, click: 13000, checkbox: 1000, pow: 0 };

// A scraper that rotates its address and user agent on every request, over one fixed client stack.
const ROT_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
];
let rotN = 0;
const rotHeaders = () => ({ 'accept-encoding': 'gzip', accept: 'application/json', 'user-agent': ROT_UAS[rotN++ % ROT_UAS.length], 'accept-language': 'en-US', 'cache-control': 'no-cache', 'x-requested-with': 'XMLHttpRequest' });
const rotIp = () => ['198.51.100.', '192.0.2.', '100.64.7.', '203.0.113.'][rotN % 4] + (10 + (rotN * 7) % 200);

const BOTS = {
  script: {
    label: 'Sim: Python script',
    blurb: 'python-requests. Reads the puzzle data, answers in milliseconds, fakes the ring path from the published numbers.',
    headers: () => ({ 'user-agent': 'python-requests/2.32.3', accept: '*/*', 'accept-encoding': 'gzip, deflate', connection: 'keep-alive' }),
    think: () => rnd(60, 220), cm: 'script', ip: '203.0.113.21',
  },
  farm: {
    label: 'Sim: solver farm (2Captcha-style)',
    blurb: 'Real Chrome headers. Ships each puzzle to OCR or a worker at market speed, then relays the answer. Tries the same with CaptchaMe.',
    headers: () => browser(CHROME_UA, true),
    think: t => MARKET_MS[t] * rnd(0.5, 0.8), cm: 'relay', ip: '203.0.113.42',
  },
  headless: {
    label: 'Sim: stealth headless browser',
    blurb: 'Puppeteer with a patched user agent. Pulls the live cues and tracks the ring with perfect code.',
    headers: () => browser(CHROME_UA, false),
    think: () => rnd(250, 600), cm: 'headless', ip: '203.0.113.63',
  },
  agent: {
    label: 'Sim: computer-use AI agent',
    blurb: 'Real browser. Screenshot, think, act. Solves every puzzle in a few seconds; re-aims at the ring every couple of seconds.',
    headers: () => browser(CHROME_UA, true),
    think: () => rnd(3500, 6000), cm: 'agent', ip: '203.0.113.84',
  },
  adaptive: {
    label: 'Sim: advanced human-mimic',
    blurb: 'The hardest simulator: real headers, live cues, human-like lag and jitter, waits the full time. Shows what still gets through, and that the ledger caps it.',
    headers: () => browser(CHROME_UA, true),
    think: () => rnd(2500, 4000), cm: 'adaptive', ip: '203.0.113.105',
  },
  scraper: {
    label: 'Sim: scraper (one address)',
    blurb: 'python-requests crawling the catalogue page by page, fast, from one address.',
    headers: () => ({ 'user-agent': 'python-requests/2.32.3', accept: '*/*', 'accept-encoding': 'gzip, deflate' }),
    scrape: { pages: 24, gap: 120 }, ip: '203.0.113.130',
  },
  rotator: {
    label: 'Sim: rotating-proxy scraper',
    blurb: 'A residential-proxy scraper. A new address and a new browser name on every request, one client underneath. Beats per-address limits; layer 2 merges it back into one identity.',
    headers: rotHeaders, scrape: { pages: 24, gap: 650, rotate: true }, ip: null,
  },
};

// ---------- tiny HTTP client with full control of headers ----------
function call(port, method, path, body, headers, ip, label) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const h = { ...headers, 'x-forwarded-for': ip, 'x-cm-attacker': label };
    if (data) { h['content-type'] = 'application/json'; h['content-length'] = data.length; }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        try {
          const enc = res.headers['content-encoding'];
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
        } catch { /* leave as is */ }
        let json = {};
        try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', () => resolve({ status: 0, body: {} }));
    req.setTimeout(20000, () => req.destroy());
    if (data) req.write(data);
    req.end();
  });
}

// ---------- "vision": read the demo SVGs ----------
const svgOf = url => Buffer.from(String(url).split(',')[1] || '', 'base64').toString('utf8');
const tags = svg => [...svg.matchAll(/<(rect|circle|polygon)\b([^>]*)>/g)].map(m => ({ tag: m[1], attrs: m[2] }));
const attr = (a, n) => { const m = new RegExp('\\b' + n + '="([^"]*)"').exec(a); return m ? m[1] : null; };
function kindOf(t) {
  if (t.tag === 'circle') return 'circle';
  if (t.tag === 'rect') return 'square';
  const n = (attr(t.attrs, 'points') || '').trim().split(/\s+/).length;
  return n === 3 ? 'triangle' : 'star';
}
function centerOf(t) {
  if (t.tag === 'circle') return { x: +attr(t.attrs, 'cx'), y: +attr(t.attrs, 'cy') };
  if (t.tag === 'rect') { const w = +attr(t.attrs, 'width'); return { x: +attr(t.attrs, 'x') + w / 2, y: +attr(t.attrs, 'y') + w / 2 }; }
  const [x, y] = (attr(t.attrs, 'points') || '0,0').trim().split(/\s+/)[0].split(',').map(Number);
  return { x, y: y + 19 }; // first point sits one radius above the centre
}
function leadingZeroBits(buf) { let n = 0; for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; }

function solve(P) {
  if (P.input === 'checkbox') return { answer: 'checked', extra: { moves: 6 + Math.floor(Math.random() * 6), webdriver: false }, saw: 'a bare checkbox; faked a few mouse moves' };
  if (P.input === 'pow') {
    const t0 = Date.now();
    for (let n = 0; n < 5e6; n++) {
      if (leadingZeroBits(crypto.createHash('sha256').update(P.salt + ':' + n).digest()) >= P.bits) return { answer: n, saw: 'computed nonce ' + n + ' in ' + (Date.now() - t0) + ' ms (machines have compute)' };
    }
    return { answer: 0, saw: 'gave up' };
  }
  const svg = svgOf(P.image);
  if (P.input === 'text' && /Solve the sum/.test(P.prompt)) {
    const toks = [...svg.matchAll(/>([^<]+)<\/text>/g)].map(m => m[1]);
    const a = +toks[0], op = toks[1], b = +toks[2];
    const ans = op === '+' ? a + b : op === '-' ? a - b : a * b;
    return { answer: String(ans), saw: 'read "' + toks.slice(0, 4).join(' ') + '" -> ' + ans };
  }
  if (P.input === 'text') {
    const s = [...svg.matchAll(/>([^<]+)<\/text>/g)].map(m => m[1]).join('');
    return { answer: s, saw: 'read the warped text as "' + s + '"' };
  }
  if (P.input === 'grid') {
    const want = (/Select every (\w+)/.exec(P.prompt) || [])[1];
    const t = tags(svg), cells = [];
    for (let i = 0; i < t.length; i++) if (t[i].tag === 'rect' && attr(t[i].attrs, 'width') === '96') cells.push(kindOf(t[i + 1]));
    const pick = cells.map((k, i) => (k === want ? i : -1)).filter(i => i >= 0);
    return { answer: pick.join(','), saw: 'labelled 9 tiles [' + cells.join(', ') + ']; picked the ' + want + 's: tiles ' + pick.map(i => i + 1).join(', ') };
  }
  if (P.input === 'slider') {
    const m = /<rect x="(\d+)" y="\d+" width="44" height="44" rx="6"/.exec(svg);
    return { answer: m ? +m[1] : 0, saw: 'found the gap at x=' + (m ? m[1] : '?') + ' px' };
  }
  if (P.input === 'rotate') {
    const tilt = +((/rotate\((\d+) 80 80\)/.exec(svg) || [])[1] || 0);
    return { answer: (360 - tilt) % 360, saw: 'picture is tilted ' + tilt + ' degrees; turning it ' + ((360 - tilt) % 360) };
  }
  if (P.input === 'click') {
    const t = tags(svg).filter(x => attr(x.attrs, 'width') !== '320');
    const pts = [t[3], t[0], t[2]].map(centerOf).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    return { answer: pts, saw: 'detected 5 shapes; clicking star, circle, triangle at ' + pts.map(p => '(' + p.x + ',' + p.y + ')').join(' ') };
  }
  return { answer: '', saw: 'unknown format' };
}

// ---------- the rival side ----------
async function attackRival(bot, b, port, type, i) {
  const H = b.headers(), say = live.attempt('atk', bot + i, type, b.label);
  await sleep(i * 180);
  const s = await call(port, 'POST', '/api/arena/start', { type }, H, b.ip, b.label);
  if (s.status !== 200) { say('A', 'flag', type + ': could not load (' + (s.body.reason || s.status) + ')'); return; }
  const sol = solve(s.body.params);
  say('A', 'info', type + ': ' + sol.saw);
  await sleep(Math.max(type === 'checkbox' ? 650 : 0, b.think(type)));
  await call(port, 'POST', '/api/arena/verify', { session: s.body.session, answer: sol.answer, extra: sol.extra }, H, b.ip, b.label);
}

// ---------- the CaptchaMe side ----------
async function collectCues(port, start, H, ip, label) {
  const P = start.params, want = P.dartCount || P.flashCount || 0, got = new Map(), t0 = Date.now();
  while (got.size < want && Date.now() - t0 < P.durationMs + 2000) {
    const c = await call(port, 'POST', '/api/challenge/cue', { session: start.session }, H, ip, label);
    for (const cue of (c.body && c.body.cues) || []) if (!got.has(cue.i)) got.set(cue.i, { ...cue, appliedAt: cue.srv });
    await sleep(120);
  }
  const cues = [...got.values()].sort((a, b) => a.i - b.i);
  return { cues, live: { ...P, darts: P.dartCount ? cues.map(c => ({ at: c.appliedAt, px: c.px, py: c.py })) : undefined } };
}
const REAL_ENV = { webdriver: false, plugins: 5, hardware: 8, langs: 2, screen: '1920x1080', outer: '1280x800', tz: 'Asia/Kolkata' };
const ADAPTIVE_ENV = { webdriver: false, plugins: 3, hardware: 12, langs: 3, screen: '2560x1440', outer: '1440x900', tz: 'America/New_York' };

async function attackCaptchaMe(bot, b, port) {
  const H = b.headers(), say = live.attempt('atk', bot + 'cm', 'ring', b.label);
  // every client, honest or not, can read the page nonce with a plain GET; it only proves a page was fetched
  const nn = await call(port, 'GET', '/api/page/nonce', null, H, b.ip, b.label);
  const s = await call(port, 'POST', '/api/challenge/start', { type: 'ring', page_nonce: nn.body && nn.body.nonce }, H, b.ip, b.label);
  if (s.status !== 200) { say('A', 'flag', 'CaptchaMe: could not start (' + (s.body.reason || s.status) + ')'); return; }
  const start = s.body, P0 = start.params, t0 = Date.now();
  const noDarts = { ...P0, darts: [] };
  const submit = (payload, headers = H, ip = b.ip) => call(port, 'POST', '/api/challenge/submit', { session: start.session, ...payload }, headers, ip, b.label);
  const waitFull = async () => sleep(Math.max(0, 0.78 * P0.durationMs - (Date.now() - t0)));

  if (b.cm === 'script') {
    say('A', 'info', 'CaptchaMe: no image to read. Faking the ring path from the published numbers and posting it now');
    await submit({ samples: actors.scriptRing(noDarts) });
  } else if (b.cm === 'relay') {
    say('A', 'info', 'CaptchaMe: nothing to screenshot or transcribe. Shipping the session to a worker queue (farms take 10-40 s)');
    await sleep(14000);
    say('A', 'info', 'CaptchaMe: worker in another browser posts a human-looking path');
    await submit({ samples: actors.humanRing(noDarts, 7), env: { ...REAL_ENV, tz: 'Asia/Dhaka' } }, browser(FIREFOX_UA, false), '198.51.100.7');
  } else {
    say('A', 'info', 'CaptchaMe: polling the live cue endpoint while the ring runs');
    const c = await collectCues(port, start, H, b.ip, b.label);
    let samples, env;
    if (b.cm === 'headless') { samples = actors.scriptRing(c.live); env = { webdriver: false, plugins: 0, hardware: 4, langs: 0, screen: '800x600', outer: '0x0', tz: 'UTC' }; say('A', 'info', 'CaptchaMe: got ' + c.cues.length + ' jumps; tracking with code, zero lag'); }
    else if (b.cm === 'agent') { samples = actors.agentRing(c.live); env = REAL_ENV; say('A', 'info', 'CaptchaMe: screenshot -> think -> move, every ~1.8 s'); }
    else { samples = actors.adaptiveRing(c.live, 1 + Math.floor(Math.random() * 1000)); env = ADAPTIVE_ENV; say('A', 'info', 'CaptchaMe: synthesising a human path (random lag, wander, jitter) and waiting the full time'); }
    await waitFull();
    await submit({ samples, cues: c.cues, env });
  }
}

async function scrapeRun(bot, b, port) {
  const say = live.attempt('atk', bot + 'sc', 'catalog', b.label);
  for (let p = 1; p <= b.scrape.pages; p++) {
    const H = b.headers(), ip = b.scrape.rotate ? rotIp() : b.ip;
    const r = await call(port, 'GET', '/api/catalog?page=' + p, null, H, ip, b.label);
    say('A', r.status === 200 ? 'info' : 'flag', 'catalog page ' + p + ' from ' + ip + ' as "' + String(H['user-agent']).slice(0, 38) + '" -> ' + r.status + (r.body && r.body.error ? ' ' + r.body.error : ''));
    await sleep(b.scrape.gap);
  }
}

async function run(bot, port, opts = {}) {
  const b = BOTS[bot];
  if (!b) throw new Error('unknown bot');
  if (b.scrape) { live.attempt('atk', bot, '-', b.label)('A', 'info', b.label + ' started: ' + b.blurb); await scrapeRun(bot, b, port); live.attempt('atk', bot, '-', b.label)('A', 'info', b.label + ' finished'); return; }
  const formats = Array.isArray(opts.formats) && opts.formats.length ? opts.formats.filter(f => RIVALS.includes(f)) : RIVALS;
  live.attempt('atk', bot, '-', b.label)('A', 'info', b.label + ' started: ' + b.blurb);
  await Promise.all([
    ...formats.map((t, i) => attackRival(bot, b, port, t, i).catch(() => {})),
    attackCaptchaMe(bot, b, port).catch(() => {}),
  ]);
  live.attempt('atk', bot, '-', b.label)('A', 'info', b.label + ' finished');
}

module.exports = { BOTS, run, solve };
