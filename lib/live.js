'use strict';
// Live attack room bus.
// Every request that touches a challenge (CaptchaMe or a rival format) emits
// raw, human-readable lines here: what each layer saw and what it decided.
// The /live page polls /api/live/feed and draws them as they happen.
// In memory, per instance, last ~1,500 lines. Never stores answers or tokens.
const shield = require('./shield');

// From the 2captcha public price list the user captured on 18 Nov 2026.
// per = dollars for ONE solve at the top of the quoted range.
const MARKET = {
  text: { name: 'Normal / text captcha', price: '$0.50 - $1 per 1,000', per: 0.001, speed: '1 s' },
  math: { name: 'Math captcha', price: '$0.50 - $1 per 1,000', per: 0.001, speed: '3 s' },
  grid: { name: 'Image grid (reCAPTCHA v2 style)', price: '$1 - $2.99 per 1,000', per: 0.00299, speed: '2 s' },
  slider: { name: 'Slider captcha', price: '$1.20 per 1,000', per: 0.0012, speed: '9 s' },
  rotate: { name: 'Rotate captcha', price: '$0.50 per 1,000', per: 0.0005, speed: '6 s' },
  click: { name: 'Click captcha', price: '$1.20 per 1,000', per: 0.0012, speed: '13 s' },
  checkbox: { name: 'Checkbox (Turnstile / reCAPTCHA v2 style)', price: '$1.45 per 1,000', per: 0.00145, speed: '1 s' },
  pow: { name: 'Proof of work (ALTCHA / Friendly style)', price: '$1.45 per 1,000', per: 0.00145, speed: '10 s' },
};

// How fast a person can read and answer each rival format, roughly.
const HUMAN_FLOOR_MS = { text: 2200, math: 1800, grid: 2800, slider: 1200, rotate: 1200, click: 2500, checkbox: 500, pow: 0 };

const buf = [];
let seq = 0;
function emit(e) {
  e.seq = ++seq;
  e.at = Date.now();
  buf.push(e);
  if (buf.length > 1500) buf.splice(0, 500);
  return e;
}
function since(n, limit = 500) {
  n = Number(n) || 0;
  const out = [];
  for (let i = buf.length - 1; i >= 0 && buf[i].seq > n; i--) out.push(buf[i]);
  return out.reverse().slice(-limit);
}
function reset() { buf.length = 0; }
function last() { return seq; }

// A small scoped writer so call sites stay short.
function attempt(side, sid, type, attacker) {
  const base = { side, sid: String(sid).slice(0, 8), type, attacker };
  return (layer, level, text, more) => emit({ ...base, layer, level, text: String(text).slice(0, 300), ...(more || {}) });
}

const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '...' : s; };

// L1: read the raw request headers the way a network layer does.
// Returns { risk, lines: [{level, text}], reasons }.
function readNetwork(req) {
  const h = req.headers || {};
  const lines = [];
  const ua = String(h['user-agent'] || '');
  const net = shield.networkRisk({ ua, acceptLanguage: h['accept-language'] || '', secFetch: h['sec-fetch-mode'] !== undefined });
  let risk = net.score;
  const reasons = [...net.reasons];

  // user agent
  if (!ua) lines.push({ level: 'block', text: 'user-agent: (none) -> real browsers always send one' });
  else {
    const bot = net.reasons.find(r => /identifies itself/.test(r));
    const fam = /Edg\/(\d+)/.exec(ua) ? 'Edge ' + /Edg\/(\d+)/.exec(ua)[1]
      : /HeadlessChrome\/(\d+)/.exec(ua) ? 'HeadlessChrome ' + /HeadlessChrome\/(\d+)/.exec(ua)[1]
      : /Chrome\/(\d+)/.exec(ua) ? 'Chrome ' + /Chrome\/(\d+)/.exec(ua)[1]
      : /Firefox\/(\d+)/.exec(ua) ? 'Firefox ' + /Firefox\/(\d+)/.exec(ua)[1]
      : /Version\/(\d+).*Safari/.exec(ua) ? 'Safari ' + /Version\/(\d+).*Safari/.exec(ua)[1]
      : 'unknown client';
    lines.push({ level: bot ? 'block' : 'ok', text: 'user-agent: "' + trunc(ua, 90) + '" -> ' + (bot ? bot.replace('client identifies itself as', 'tool:') : fam) });
  }
  // language
  lines.push(h['accept-language']
    ? { level: 'ok', text: 'accept-language: ' + trunc(h['accept-language'], 40) }
    : { level: 'flag', text: 'accept-language: (none) -> every browser sends one' });
  // fetch metadata
  if (h['sec-fetch-mode'] !== undefined) lines.push({ level: 'ok', text: 'sec-fetch: mode=' + h['sec-fetch-mode'] + ' site=' + (h['sec-fetch-site'] || '-') + ' dest=' + (h['sec-fetch-dest'] || '-') + ' -> browser fetch' });
  else lines.push({ level: 'flag', text: 'sec-fetch-*: (none) -> not sent by a browser fetch' });
  // client hints: Chromium sends these on secure origins (localhost counts)
  const claimsChromium = /Chrome\//.test(ua) && !/HeadlessChrome/.test(ua);
  if (h['sec-ch-ua']) {
    const brands = String(h['sec-ch-ua']).match(/"([^"]+)";v="(\d+)"/g) || [];
    const real = brands.map(b => b.replace(/"/g, '').replace(';v=', ' ')).filter(b => !/Not.?A.?Brand/i.test(b));
    lines.push({ level: 'ok', text: 'sec-ch-ua: ' + trunc(real.join(', ') || h['sec-ch-ua'], 70) + (h['sec-ch-ua-platform'] ? ' on ' + h['sec-ch-ua-platform'] : '') });
  } else if (claimsChromium) {
    risk += 15; reasons.push('claims Chrome but sends no client hints');
    lines.push({ level: 'flag', text: 'sec-ch-ua: (none) but user-agent claims Chrome -> header set copied, not a real Chrome' });
  }
  // header count: HTTP libraries send a handful
  const n = Object.keys(h).filter(k => !/^x-(forwarded|real|invoke|middleware|nextjs)|^x-cm-|^connection$|^host$|^content-length$/i.test(k)).length;
  if (n < 6) { risk += 20; reasons.push('only ' + n + ' headers'); }
  lines.push({ level: n < 6 ? 'flag' : 'ok', text: 'header count: ' + n + (n < 6 ? ' -> HTTP libraries send 3-5, browsers 10+' : ' -> browser-sized') });
  // address
  const ip = String(h['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  lines.push({ level: 'info', text: 'address: ' + (ip || 'unknown') + (/^(::1|127\.|::ffff:127\.)/.test(ip) ? ' (this machine)' : '') });
  risk = Math.min(100, risk);
  lines.push({ level: risk >= 55 ? 'block' : risk >= 30 ? 'flag' : 'ok', text: 'network risk ' + risk + '/100' + (reasons.length ? ' -> ' + reasons.slice(0, 3).join('; ') : ' -> nothing unusual') });
  return { risk, lines, reasons };
}

// What CaptchaMe would have decided about a request the rival just accepted.
function shadowRival(req, type, elapsedMs, extra) {
  const net = readNetwork(req);
  let risk = net.risk;
  const why = [...net.reasons];
  const floor = HUMAN_FLOOR_MS[type] || 0;
  const lines = [];
  if (floor && elapsedMs < floor) {
    risk += 30; why.push('answered in ' + elapsedMs + ' ms');
    lines.push({ level: 'flag', text: 'timing: answered ' + elapsedMs + ' ms after it loaded; a person needs about ' + floor + ' ms to see, read and answer' });
  } else if (floor) lines.push({ level: 'info', text: 'timing: answered after ' + (elapsedMs / 1000).toFixed(1) + ' s (a solver farm is this fast too)' });
  if (extra && extra.webdriver) { risk += 50; why.push('navigator.webdriver'); lines.push({ level: 'block', text: 'browser: navigator.webdriver = true -> automation control' }); }
  lines.push({ level: 'flag', text: 'presence: the rival never checks that a live person is here; it only checks the answer' });
  risk = Math.min(100, risk);
  const verdict = risk >= 55 ? 'block' : 'step-up';
  return { risk, net, lines, verdict, why };
}

module.exports = { MARKET, HUMAN_FLOOR_MS, emit, since, reset, last, attempt, readNetwork, shadowRival };
