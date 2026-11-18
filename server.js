'use strict';
/*
 * CaptchaMe - hackathon build.
 * Zero dependencies. Run: node server.js  (default port 3000)
 *
 * Three lanes through one door:
 *   1. Human, pointer path  - moving-ring follow, scored on response shape.
 *   2. Human, voice path    - speak-back at a random cadence, for people who
 *                             cannot do pointer or timed-visual tasks.
 *   3. Declared AI agent    - signs in with a key, skips challenges, gets its
 *                             own budget. Honest agents are welcome.
 * Behind the door sits the fair-share ledger: every actor gets a dollar cap,
 * a plain reason when it bites, and an appeal a human can overturn.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tokens = require('./lib/tokens');
const scoring = require('./lib/scoring');
const ledger = require('./lib/ledger');
const store = require('./lib/store');
const classic = require('./lib/classic');
const shield = require('./lib/shield');
const passive = require('./lib/passive');
const webbotauth = require('./lib/webbotauth');
const audit = require('./lib/audit');
const traffic = require('./lib/traffic');
const live = require('./lib/live');
const layer2 = require('./lib/layer2'); // post-verification capture and analysis
const ag = require('./lib/abuseguard'); // second layer; a no-op unless ABUSEGUARD_URL/KEY/SALT are set

const PORT = process.env.PORT || 3000;
// No built-in admin key. Without POP_ADMIN_KEY each run makes its own and
// prints it once, so live visitor data is never behind a guessable default.
const ADMIN_KEY = process.env.POP_ADMIN_KEY || (() => {
  const k = crypto.randomBytes(12).toString('base64url');
  console.log('[captchame] POP_ADMIN_KEY is not set. Admin key for this run: ' + k + '  (set POP_ADMIN_KEY to keep one key across restarts and instances)');
  return k;
})();
const PUBLIC = path.join(__dirname, 'public');

// ---------- tiny framework ----------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler });
}
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json' : (headers['Content-Type'] || 'text/plain'), 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

// ---------- event feed for the dashboard (store-backed) ----------
async function logEvent(type, message, extra = {}) {
  try {
    const seq = await store.nextEventSeq();
    await store.addEvent({ seq, at: Date.now(), type, message, ...extra });
  } catch (e) { /* feed is best-effort; never break a request over it */ }
}
async function bump(name, by) { try { await store.bump(name, by); } catch { /* best effort */ } }
async function arena(format, attacker, passed) { try { await store.arenaRecord(format, attacker, passed); } catch { /* best effort */ } }

// Who is attacking right now? The arena page sets a label ("Buster",
// "CapSolver", "Comet agent", "Human"...) so the scoreboard can say which tool
// beat which check. Tools that cannot set headers inherit the page cookie.
function attackerOf(req) {
  const raw = req.headers['x-cm-attacker'] || cookies(req).cm_attacker || '';
  const clean = String(raw).replace(/[^\w .()+:-]/g, '').trim().slice(0, 40);
  return clean || 'unlabelled';
}
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'na').split(',')[0].trim();
const reqBind = req => tokens.bindingOf(req.headers['user-agent'], req.headers['accept-language'], clientIp(req));
const uaHash = req => crypto.createHash('sha256').update(String(req.headers['user-agent'] || '')).digest('base64url').slice(0, 10);
const netMeta = req => ({ ua: req.headers['user-agent'] || '', acceptLanguage: req.headers['accept-language'] || '', secFetch: req.headers['sec-fetch-mode'] !== undefined });
function netPrefix(ip) {
  const v4 = /(\d+\.\d+\.\d+)\.\d+$/.exec(String(ip));
  return v4 ? v4[1] : String(ip).split(':').slice(0, 3).join(':');
}
// A person just passed a check. Tell the second layer who they are linked to (same network, same
// browser id if there is one), that the live check passed, and that a new session exists.
async function agPassed(req, actorId) {
  if (!ag.enabled) return;
  try {
    const vid = cookies(req).cm_vid;
    await Promise.all([ag.signup(actorId), ag.link(actorId, 'ip', netPrefix(clientIp(req))), vid ? ag.link(actorId, 'device', vid) : null, ag.verify(actorId, 'human_check', 'pass')]);
  } catch { /* the second layer never breaks the first */ }
}
// How long after it starts a challenge can still be answered: its own length
// plus a short grace. Solver queues that relay a task take 10-40 s.
const ACTIVE_GRACE_MS = Number(process.env.POP_ACTIVE_GRACE_MS) || 6000;
function maxAnswerMs(type, P) {
  if (type === 'ring' || type === 'pulse') return P.durationMs + ACTIVE_GRACE_MS;
  if (type === 'reflex' || type === 'clash') return P.totalMs + ACTIVE_GRACE_MS;
  if (type === 'beat') return P.beats[P.beats.length - 1] + 800 + ACTIVE_GRACE_MS;
  if (type === 'targets') return P.timeoutMs + 2000;
  if (type === 'trace' || type === 'oddone') return P.timeoutMs + 2000;
  if (type === 'buddy') return P.timeoutMs + 5000;
  if (type === 'voice') return P.cadence.reduce((a, b) => a + b, 0) + 15000;
  return 60000;
}
function cors(req, res) {
  const o = req.headers.origin;
  if (!o) return;
  res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

// ---------- challenge sessions ----------
// Sessions are stateless: a signed payload carries the params, so a submit
// works even when a serverless platform routes it to a fresh instance.
// Replay tracking is in-memory (best effort on serverless, exact on one box).
const SESSION_TTL = 90 * 1000;
const SESSION_SECRET = process.env.POP_SECRET || crypto.randomBytes(32).toString('hex');
const doneSessions = new Set();
setInterval(() => { if (doneSessions.size > 20000) { const it = doneSessions.values(); for (let i = 0; i < 10000; i++) doneSessions.delete(it.next().value); } }, 30000).unref();
function signSession(obj) {
  const b64 = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return b64 + '.' + sig;
}
function readSession(token) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const b64 = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!s.id || Date.now() - s.iat > (s.ttl || SESSION_TTL)) return null;
    return s;
  } catch { return null; }
}

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || '';
const sttUsedSessions = new Set();
const sttDaily = { day: '', n: 0 };
const STT_DAILY_CAP = 300;

const VOICE_WORDS = ['mango', 'river', 'lantern', 'copper', 'window', 'falcon', 'harbor', 'pencil', 'thunder', 'garden', 'silver', 'bridge', 'marble', 'cloud', 'tiger', 'velvet', 'anchor', 'meadow', 'rocket', 'willow'];

const rateBuckets = new Map();
function rateLimit(ip, perMin = 120) {
  perMin = Number(process.env.POP_RATE_PER_MIN) || perMin; // raised by the test suite
  const now = Date.now(); const b = rateBuckets.get(ip) || { n: 0, reset: now + 60000 };
  if (now > b.reset) { b.n = 0; b.reset = now + 60000; }
  b.n++; rateBuckets.set(ip, b);
  return b.n <= perMin;
}

// ---------- API: challenges ----------
// "auto" lets the server pick the format, so an attacker cannot train a
// solver on one check and point it at every site.
const AUTO_TYPES = ['ring', 'pulse', 'reflex', 'clash', 'targets', 'trace', 'oddone'];

// Surprise me adapts. Formats that bots have recently been getting through are
// picked less often (never never: a format must stay in play to be measured).
// As bypass tools improve on one format, traffic moves to the ones they fail.
let autoCache = { at: 0, weights: null };
async function autoWeights() {
  if (autoCache.weights && Date.now() - autoCache.at < 15000) return autoCache.weights;
  const w = {}, why = {};
  let rows = [];
  try { rows = await store.arenaTable(); } catch { rows = []; }
  for (const t of AUTO_TYPES) {
    let pass = 0, tries = 0;
    for (const r of rows) {
      if (r.format !== 'captchame:' + t || /human|person|unlabelled/i.test(r.attacker || '')) continue;
      pass += r.pass || 0; tries += (r.pass || 0) + (r.fail || 0);
    }
    const rate = (pass + 0.5) / (tries + 5);  // smoothed bot pass rate
    w[t] = Math.max(0.2, 1 - 2.2 * rate);
    why[t] = { botPasses: pass, botTries: tries, weight: +w[t].toFixed(2) };
  }
  autoCache = { at: Date.now(), weights: w, why };
  return w;
}
async function pickAuto() {
  const w = await autoWeights();
  const total = AUTO_TYPES.reduce((a, t) => a + w[t], 0);
  let x = Math.random() * total;
  for (const t of AUTO_TYPES) { x -= w[t]; if (x <= 0) return t; }
  return AUTO_TYPES[AUTO_TYPES.length - 1];
}
route('GET', '/api/formats/health', async (req, res) => { await autoWeights(); send(res, 200, { formats: autoCache.why, note: 'Weight is how often Surprise me picks a format. It drops as labelled bots get through that format, so traffic shifts to the formats they fail.' }); });

// Trace: a winding path, sampled once so browser and server agree exactly.
function tracePath() {
  const W = 800, H = 450, way = [];
  const n = 5;
  for (let i = 0; i < n; i++) way.push([Math.round(70 + (i / (n - 1)) * (W - 140)), Math.round(80 + Math.random() * (H - 160))]);
  if (Math.random() < 0.5) way.reverse();
  const pts = [];
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
  for (let i = 0; i < way.length - 1; i++) {
    const p0 = way[Math.max(0, i - 1)], p1 = way[i], p2 = way[i + 1], p3 = way[Math.min(way.length - 1, i + 2)];
    for (let k = 0; k < 30; k++) { const t = k / 30; pts.push([Math.round(cr(p0[0], p1[0], p2[0], p3[0], t)), Math.round(cr(p0[1], p1[1], p2[1], p3[1], t))]); }
  }
  pts.push(way[way.length - 1]);
  return { field: { w: W, h: H }, pts, timeoutMs: 15000 };
}
// Odd one out: per round six dots; five share one motion, one breaks it.
function oddRounds() {
  const W = 800, H = 420, rounds = [], odds = [];
  let at = 300;
  for (let r = 0; r < 3; r++) {
    const dir = Math.random() < 0.5 ? 1 : -1, speed = 1.6 + Math.random() * 1.2, odd = Math.floor(Math.random() * 6);
    const mode = ['reverse', 'faster', 'wobble'][Math.floor(Math.random() * 3)];
    const dots = [];
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3);
      const base = { cx: Math.round(150 + col * 250 + (Math.random() - 0.5) * 50), cy: Math.round(120 + row * 190 + (Math.random() - 0.5) * 40), rad: 28 + Math.round(Math.random() * 14), w: +(dir * speed).toFixed(3), ph: +(Math.random() * 6.283).toFixed(3), wob: 0 };
      if (i === odd) {
        if (mode === 'reverse') base.w = +(-dir * speed).toFixed(3);
        else if (mode === 'faster') base.w = +(dir * speed * 1.9).toFixed(3);
        else { base.wob = 1; }
      }
      dots.push(base);
    }
    rounds.push({ at, dots });
    odds.push(odd);
    at += 1; // rounds advance on each pick; 'at' is set by the browser's round start
  }
  return { field: { w: W, h: H }, rounds, timeoutMs: 20000, odds };
}
// Voice buddy: friendly questions with pictures; spoken and shown.
const BUDDY_BANK = [
  { q: 'Which animal says moo?', a: 'cow', opts: [['cow', '🐄'], ['cat', '🐈'], ['duck', '🦆'], ['dog', '🐕']] },
  { q: 'Which animal says quack?', a: 'duck', opts: [['duck', '🦆'], ['cow', '🐄'], ['lion', '🦁'], ['frog', '🐸']] },
  { q: 'Which animal says woof?', a: 'dog', opts: [['dog', '🐕'], ['cat', '🐈'], ['bird', '🐦'], ['fish', '🐟']] },
  { q: 'Which one can fly?', a: 'bird', opts: [['bird', '🐦'], ['fish', '🐟'], ['turtle', '🐢'], ['snail', '🐌']] },
  { q: 'Which one is a fruit?', a: 'apple', opts: [['apple', '🍎'], ['car', '🚗'], ['ball', '⚽'], ['shoe', '👟']] },
  { q: 'Which one is cold?', a: 'ice', opts: [['ice', '🧊'], ['fire', '🔥'], ['sun', '☀️'], ['cake', '🎂']] },
  { q: 'Which one do we sleep in?', a: 'bed', opts: [['bed', '🛏️'], ['tree', '🌳'], ['boat', '⛵'], ['pizza', '🍕']] },
  { q: 'Which one lives in water?', a: 'fish', opts: [['fish', '🐟'], ['dog', '🐕'], ['horse', '🐎'], ['bee', '🐝']] },
  { q: 'Which one is a moon?', a: 'moon', opts: [['moon', '🌙'], ['star', '⭐'], ['flower', '🌸'], ['house', '🏠']] },
  { q: 'Which one says meow?', a: 'cat', opts: [['cat', '🐈'], ['cow', '🐄'], ['frog', '🐸'], ['owl', '🦉']] },
];
function buddyRounds() {
  const pick = [...BUDDY_BANK].sort(() => Math.random() - 0.5).slice(0, 3);
  const rounds = [], answers = [];
  for (const b of pick) {
    const opts = [...b.opts].sort(() => Math.random() - 0.5);
    rounds.push({ q: b.q, opts: opts.map(([w, e]) => ({ word: w, emoji: e })) });
    answers.push(b.a);
  }
  return { rounds, timeoutMs: 240000, answers };
}
const CLASH_COLORS = ['RED', 'BLUE'];
function makeParams(type) {
  let params;
  if (type === 'clash') {
    const kinds = [true, true, true, false, false, false].sort(() => Math.random() - 0.5);
    let t = 900;
    const trials = kinds.map(cong => {
      const ink = CLASH_COLORS[Math.random() < 0.5 ? 0 : 1];
      const word = cong ? ink : CLASH_COLORS.find(c => c !== ink);
      const tr = { at: Math.round(t), word, ink };
      t += 1150 + Math.random() * 300;
      return tr;
    });
    return { colors: CLASH_COLORS, trials, windowMs: 1300, totalMs: Math.round(trials[trials.length - 1].at + 1400) };
  }
  if (type === 'targets') {
    const W = 800, H = 450, radii = [16, 24, 34, 48];
    const targets = [];
    let prev = { x: W / 2, y: H / 2 };
    for (let i = 0; i < 7; i++) {
      const r = radii[Math.floor(Math.random() * radii.length)];
      let p, tries = 0;
      do {
        p = { x: Math.round(r + 12 + Math.random() * (W - 2 * r - 24)), y: Math.round(r + 12 + Math.random() * (H - 2 * r - 24)) };
        tries++;
      } while (tries < 60 && (Math.hypot(p.x - prev.x, p.y - prev.y) < 140 || Math.hypot(p.x - prev.x, p.y - prev.y) > 560));
      targets.push({ x: p.x, y: p.y, r });
      prev = p;
    }
    return { field: { w: W, h: H }, targets, timeoutMs: 25000 };
  }
  return params;
}

// ---------- API: the unified gateway ----------
// One front door. Every request is sorted into a lane by the same layers the
// site demonstrates one by one. /api/decide routes; it does not mint passes.
route('POST', '/api/decide', async (req, res) => {
  cors(req, res);
  if (!rateLimit('decide:' + clientIp(req), 240)) return send(res, 429, { error: 'rate_limited', reason: 'Too many decisions. Wait a minute.' });
  const body = await readBody(req, 300000) || {};
  const layers = [];
  // 1. agent lane: a Web Bot Auth signature sorts a request before anything else
  const wba = await webbotauth.verifyRequest(req);
  layers.push({ layer: 'agent_lane', result: wba ? (wba.ok ? 'verified' : 'bad_signature') : 'no_signature' });
  if (wba && !wba.ok) return send(res, 401, { lane: 'agent', action: 'block', reason: 'Web Bot Auth signature did not verify: ' + wba.reason, layers });
  if (wba && wba.ok) {
    const actorId = 'agent:wba:' + wba.agent;
    const a = await ledger.ensureActor(actorId, 'verified');
    return send(res, 200, { lane: 'agent', action: 'meter', operator: wba.agent, budget: ledger.remaining(a), layers });
  }
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const v = tokens.verify(auth.slice(7), { consume: false });
    layers.push({ layer: 'bearer_pass', result: v.ok ? 'valid' : 'invalid' });
    if (v.ok && v.kind === 'agent') { const a = await ledger.ensureActor(v.actor, 'agent'); return send(res, 200, { lane: 'agent', action: 'meter', actor: v.actor, budget: ledger.remaining(a), layers }); }
    if (v.ok) return send(res, 200, { lane: 'human', action: 'allow', via: v.via || 'pass', layers });
  }
  // 2. scraper shield: how the request itself behaves
  const sv = shield.assess(shieldMeta(req, { page: Number(body.page) || 1 }));
  layers.push({ layer: 'scraper_shield', decision: sv.decision, risk: sv.score, reasons: sv.reasons });
  if (sv.decision !== 'allow') return send(res, 200, { lane: 'scraper', action: sv.decision, reasons: sv.reasons, retry_after_ms: sv.retryAfterMs, layers });
  // 3. live page context
  const pn = pageNonceCheck(req, body.page_nonce);
  layers.push({ layer: 'page_context', result: pn.ok ? 'live_page' : 'no_page_nonce' });
  if (!pn.ok) return send(res, 200, { lane: 'unverified', action: 'challenge', reasons: ['no live page context: serve a step-up check'], challenge_url: '/check?embed=1&format=auto', layers });
  // 4. passive signals, when the page has them to send
  if (body.telemetry) {
    const r = passive.scorePassive(body.telemetry, shield.networkRisk(netMeta(req)));
    layers.push({ layer: 'passive_signals', tier: r.tier, evidence: r.evidence });
    if (r.tier === 'pass') return send(res, 200, { lane: 'human', action: 'silent_pass', evidence: r.evidence, layers });
    if (r.tier === 'nudge') return send(res, 200, { lane: 'human', action: 'nudge', reasons: r.reasons, layers });
    return send(res, 200, { lane: 'unverified', action: 'challenge', reasons: r.reasons, challenge_url: '/check?embed=1&format=auto', layers });
  }
  return send(res, 200, { lane: 'unverified', action: 'interact', reasons: ['live page confirmed; waiting for interaction signals'], layers });
});


route('POST', '/api/challenge/start', async (req, res) => {
  const ip = clientIp(req);
  if (!rateLimit(ip)) return send(res, 429, { error: 'rate_limited', reason: 'Too many challenge starts. Wait a minute.' });
  const body = await readBody(req);
  const pn = pageNonceCheck(req, body && body.page_nonce);
  if (!pn.ok) return send(res, 403, { error: 'no_page_nonce', reason: 'Challenges start from a live page view. A page running the CaptchaMe script holds a fresh page nonce from /api/page/nonce; a bare API call does not.' });
  const id = crypto.randomBytes(12).toString('hex');
  const type = body.type === 'auto' ? await pickAuto() : body.type;
  let params = makeParams(type);
  let answersSealed = null;
  if (params) { /* clash or targets */ }
  else if (type === 'trace') params = tracePath();
  else if (type === 'oddone') { const o = oddRounds(); answersSealed = o.odds; delete o.odds; params = o; }
  else if (type === 'buddy') { const b = buddyRounds(); answersSealed = b.answers; delete b.answers; params = b; }
  else if (type === 'ring') {
    params = {
      ax: 0.22 + Math.random() * 0.12, ay: 0.22 + Math.random() * 0.12,
      fx: 0.12 + Math.random() * 0.10, fy: 0.12 + Math.random() * 0.10,
      px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
      durationMs: 4600,
      reacquireMs: 1200,
      darts: [1300 + Math.random() * 500, 2700 + Math.random() * 500].map(at => ({
        at: Math.round(at),
        px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
      })),
    };
  } else if (type === 'beat') {
    const beats = []; let t = 1000;
    for (let i = 0; i < 9; i++) { beats.push(Math.round(t)); t += 550 + Math.random() * 200; }
    params = { beats };
  } else if (type === 'pulse') {
    const flashes = [];
    let ft = 1000 + Math.random() * 500;
    while (ft < 4300) { flashes.push(Math.round(ft)); ft += 1100 + Math.random() * 700; }
    params = {
      ax: 0.26 + Math.random() * 0.12, ay: 0.22 + Math.random() * 0.12,
      fx: 0.07 + Math.random() * 0.08, fy: 0.05 + Math.random() * 0.06,
      px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
      durationMs: 5000, flashes, flashWindowMs: 800,
    };
  } else if (type === 'reflex') {
    const rounds = []; let t = 900;
    for (let i = 0; i < 5; i++) { rounds.push({ at: Math.round(t), windowMs: 900 }); t += 1000 + Math.random() * 900; }
    params = { rounds, totalMs: Math.round(t + 500) };
  } else if (type === 'voice') {
    const words = [...VOICE_WORDS].sort(() => Math.random() - 0.5).slice(0, 4);
    const cadence = words.map(() => 1400 + Math.round(Math.random() * 900)); // ms between word prompts
    params = { words, cadence };
  } else {
    return send(res, 400, { error: 'bad_type', reason: 'type must be one of ring, beat, reflex, pulse, clash, targets, trace, oddone, buddy, voice or auto' });
  }
  // Hidden schedule: the ring's jumps and the pulse's flashes are not
  // published up front. The browser learns each one only when it happens,
  // through /api/challenge/cue, so nothing can be computed or recorded ahead.
  let publicParams = params, sealed = null;
  if (type === 'ring') { sealed = { kind: 'dart', items: params.darts }; publicParams = { ...params, cues: true, dartCount: params.darts.length }; delete publicParams.darts; }
  if (type === 'pulse') { sealed = { kind: 'flash', items: params.flashes.map(at => ({ at })) }; publicParams = { ...params, cues: true, flashCount: params.flashes.length }; delete publicParams.flashes; }
  const net = shield.networkRisk(netMeta(req));
  const sess = { id, type, params: publicParams, iat: Date.now(), net: net.score, nr: net.reasons.slice(0, 2), uah: uaHash(req) };
  if (sealed) sess.enc = seal(sealed);
  if (answersSealed) sess.ans = seal(answersSealed); // answers travel encrypted inside the signed session
  if (type === 'buddy') sess.ttl = params.timeoutMs + 10000;
  if (typeof body.form_hash === 'string' && /^[a-f0-9]{64}$/i.test(body.form_hash)) sess.form = body.form_hash.toLowerCase();
  {
    const who = attackerOf(req), L = live.attempt('cm', id, type, who);
    L('L0', 'info', 'challenge requested by "' + who + '"' + (body.type === 'auto' ? '; server picked "' + type + '" at random so no solver can train on one format' : '; format "' + type + '"'));
    live.readNetwork(req).lines.forEach(x => L('L1', x.level, x.text));
    if (sealed) L('L2', 'info', 'hidden schedule: ' + sealed.items.length + ' ' + (sealed.kind === 'dart' ? 'ring jumps' : 'flashes') + ' sealed (AES-GCM); each is released only at its moment, so nothing can be pre-computed');
    L('L2', 'info', 'session signed (HMAC), single use, expires in 90 s; answer window ' + (maxAnswerMs(type, publicParams) / 1000).toFixed(1) + ' s');
  }
  layer2.observe(req, 'challenge.start', { sid: id, type, attacker: attackerOf(req), quiet: true });
  send(res, 200, { session: signSession(sess), type, params: publicParams, active_window_ms: maxAnswerMs(type, publicParams), auto: body.type === 'auto' });
});

// ---------- live cues for the hidden schedule ----------
const CUE_WINDOW_MS = 1500;
const cueSeen = new Set(); // live room: report each cue the first time it is fetched
setInterval(() => { if (cueSeen.size > 20000) cueSeen.clear(); }, 60000).unref();
const cueSig = (sid, kind, i, srv) => crypto.createHmac('sha256', SESSION_SECRET).update(`cue:${sid}:${kind}:${i}:${srv}`).digest('base64url').slice(0, 22);
route('POST', '/api/challenge/cue', async (req, res) => {
  if (!rateLimit('cue:' + clientIp(req), 3000)) return send(res, 429, { error: 'rate_limited' });
  const body = await readBody(req);
  const sess = readSession(body.session);
  const sealed = sess && sess.enc ? unseal(sess.enc) : null;
  if (!sealed) return send(res, 410, { error: 'session_gone', reason: 'Start a fresh challenge.' });
  const srv = Date.now() - sess.iat;
  const cues = sealed.items.map((it, i) => ({ it, i }))
    .filter(({ it }) => srv >= it.at && srv <= it.at + CUE_WINDOW_MS)
    .map(({ it, i }) => ({ kind: sealed.kind, i, srv, r: cueSig(sess.id, sealed.kind, i, srv), ...(sealed.kind === 'dart' ? { px: it.px, py: it.py } : {}) }));
  for (const c of cues) {
    const k = sess.id + ':' + c.i;
    if (cueSeen.has(k)) continue;
    cueSeen.add(k);
    live.attempt('cm', sess.id, sess.type, attackerOf(req))('L5', 'ok', (c.kind === 'dart' ? 'ring jump' : 'flash') + ' #' + (c.i + 1) + ' released at ' + (c.srv / 1000).toFixed(2) + ' s; the client pulled it live (' + (c.srv - sealed.items[c.i].at) + ' ms after it fired)');
  }
  send(res, 200, { cues, srv, done: srv > Math.max(...sealed.items.map(x => x.at)) + CUE_WINDOW_MS });
});

// ---------- live attack room: explain every submit, layer by layer ----------
const HARD_RX = /perfect|zero-lag|uniform|before a human|no micro-corrections|synthetic|before a flash|identical reaction|look-think-act|zero reaction time|never re-acquired|computed, not performed|automation control|one task at a time/;
function flagLayer(f) {
  if (/webdriver|automation control/.test(f)) return 'L3';
  if (/after the challenge started|for a challenge that runs|live (jump|flash) signals/.test(f)) return 'L5';
  if (/another browser|relayed/.test(f)) return 'L6';
  if (/connection/.test(f)) return 'L1';
  return 'L4';
}
function fmtVal(v) {
  if (Array.isArray(v)) return '[' + v.slice(0, 8).map(x => (x === null ? 'miss' : typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') + (v.length > 8 ? ', ...' : '') + ']';
  if (v && typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v);
}
function buildViz(type, P, body, result) {
  const out = {};
  const d = (result && result.detail) || {};
  if ((type === 'ring' || type === 'pulse') && Array.isArray(body.samples) && body.samples.length) {
    const s = body.samples.filter(p => p && [p.t, p.x, p.y].every(Number.isFinite)).slice(0, 2000);
    const step = Math.max(1, Math.ceil(s.length / 180));
    const pts = s.filter((_, i) => i % step === 0);
    out.path = {
      cursor: pts.map(p => [Math.round(p.t), +p.x.toFixed(3), +p.y.toFixed(3)]),
      target: pts.map(p => { const g = scoring.ringTarget(P, p.t / 1000); return [+g.x.toFixed(3), +g.y.toFixed(3)]; }),
      darts: (P.darts || []).map(x => x.at), lagMs: d.lagMs,
    };
  }
  if (Array.isArray(d.reactionsMs)) out.rts = d.reactionsMs.slice(0, 20);
  if (type === 'beat' && Array.isArray(body.taps) && Array.isArray(P.beats)) {
    out.offsets = body.taps.slice(0, 30).filter(Number.isFinite).map(t => { let best = Infinity; for (const b of P.beats) if (Math.abs(t - b) < Math.abs(best)) best = t - b; return Math.round(best); });
  }
  return Object.keys(out).length ? out : undefined;
}
function traceSubmit(req, sess, c) {
  try {
    const L = live.attempt('cm', sess.id, sess.type, c.attacker);
    // L3: what the browser says about itself
    const e = c.body.env;
    if (!e || typeof e !== 'object') L('L3', 'flag', 'browser probe: nothing sent -> this answer did not come from the CaptchaMe widget');
    else {
      const bits = ['webdriver=' + (e.webdriver === true), 'plugins=' + (e.plugins ?? '?'), 'cores=' + (e.hardware ?? '?')];
      if (e.langs !== undefined) bits.push('languages=' + e.langs);
      if (e.screen) bits.push('screen=' + e.screen);
      if (e.outer) bits.push('window=' + e.outer);
      if (e.tz) bits.push('tz=' + e.tz);
      const headless = e.outer === '0x0' || e.langs === 0;
      L('L3', c.webdriver ? 'block' : headless ? 'flag' : 'ok', 'browser probe: ' + bits.join(' ') + (c.webdriver ? ' -> under automation control' : headless ? ' -> looks like a headless window' : ' -> ordinary browser'));
    }
    // L4: the raw measurements of the response shape
    const d = c.result.detail || {};
    const pairs = Object.keys(d).map(k => k + '=' + fmtVal(d[k]));
    for (let i = 0; i < pairs.length; i += 4) L('L4', 'info', 'measured: ' + pairs.slice(i, i + 4).join('  '));
    if (Number.isFinite(d.lagMs)) L('L4', d.lagMs >= 80 && d.lagMs <= 350 ? 'ok' : 'flag', 'reaction lag ' + d.lagMs + ' ms behind the ring' + (d.lagMs >= 80 && d.lagMs <= 350 ? ' (people run 80-350 ms behind)' : ' (outside the human 80-350 ms band)'));
    if (Number.isFinite(d.corrections)) L('L4', d.corrections <= 10 ? 'flag' : (d.lagMs >= 80 && d.lagMs <= 350) ? 'ok' : 'info', d.corrections + ' micro-corrections' + (d.corrections > 10 ? ' (a hand keeps correcting)' : ' (a hand makes dozens)'));
    for (const f of c.result.flags) L(flagLayer(f), HARD_RX.test(f) || c.extraHard.includes(f) ? 'block' : 'flag', f);
    // L5: wall clock and live cue receipts
    const late = c.elapsedMs > c.maxMs;
    L('L5', c.tooFast || late ? 'block' : 'ok', 'wall clock: answered after ' + (c.elapsedMs / 1000).toFixed(2) + ' s; live window is ' + (c.minMs / 1000).toFixed(1) + '-' + (c.maxMs / 1000).toFixed(1) + ' s' + (c.tooFast ? ' -> computed, not performed' : late ? ' -> queued or relayed' : ''));
    if (c.cueStat) L('L5', c.cueStat.got === c.cueStat.of ? 'ok' : 'block', 'signed live receipts: ' + c.cueStat.got + '/' + c.cueStat.of + ' ' + (c.cueStat.kind === 'dart' ? 'jumps' : 'flashes') + ' fetched while the challenge ran');
    // L6: is it the same browser?
    if (sess.uah && sess.uah === uaHash(req)) L('L6', 'ok', 'same browser that started it (ua hash ' + sess.uah + '); a pass would be bound to user-agent + language + network prefix');
    // L7: the decision
    const viz = buildViz(sess.type, c.P, c.body, c.result);
    if (c.passed) L('L7', 'pass', 'PASS ' + c.result.score + '/100 -> single-use pass token, 5 min, bound to this browser; ledger grants +$' + ledger.DEFAULTS.human.toFixed(2) + ' and still caps what this actor can take', { final: true, verdict: 'pass', score: c.result.score, viz });
    else L('L7', 'block', 'BLOCK ' + c.result.score + '/100 -> ' + (c.result.flags[0] || 'did not look like a live person'), { final: true, verdict: 'block', score: c.result.score, viz, reasons: c.result.flags.slice(0, 4) });
  } catch { /* the live room never breaks a verdict */ }
}

route('POST', '/api/challenge/submit', async (req, res) => {
  const body = await readBody(req);
  const sess = readSession(body.session);
  if (!sess) return send(res, 410, { error: 'session_gone', reason: 'Challenge expired or was tampered with. Start a fresh one.' });
  const attacker = attackerOf(req);
  if (doneSessions.has(sess.id)) {
    await logEvent('replay', `Replay blocked: session ${sess.id.slice(0, 6)} submitted twice`, { lane: sess.type, attacker });
    await bump('botsCaught');
    await arena('captchame:' + sess.type, attacker, false);
    {
      const L = live.attempt('cm', sess.id, sess.type, attacker);
      L('L6', 'block', 'session ' + sess.id.slice(0, 8) + ' was already answered once: replayed or shared answer refused');
      L('L7', 'block', 'BLOCK: replay', { final: true, verdict: 'block', score: 0 });
    }
    return send(res, 409, { error: 'replay', reason: 'This challenge was already answered. Challenges work once.' });
  }
  doneSessions.add(sess.id);

  // Wall-clock check: the answer must take at least most of the challenge's
  // real duration. A script can fake every signal and still submit instantly.
  const elapsedMs = Date.now() - sess.iat;
  let minMs = 0;
  if (sess.type === 'ring' || sess.type === 'pulse') minMs = 0.7 * sess.params.durationMs;
  else if (sess.type === 'reflex') minMs = 0.7 * sess.params.totalMs;
  else if (sess.type === 'beat') minMs = 0.7 * (sess.params.beats[sess.params.beats.length - 1] + 800);
  else if (sess.type === 'voice') minMs = 3000;
  else if (sess.type === 'clash') minMs = 0.7 * sess.params.totalMs;
  else if (sess.type === 'targets') minMs = 2000;
  else if (sess.type === 'trace') minMs = 900;
  else if (sess.type === 'oddone') minMs = 1500;
  else if (sess.type === 'buddy') minMs = 1500;
  const tooFast = elapsedMs < minMs;
  const extraHard = [];

  // Out-of-band solver queues take 10-40 s; a live session answers in its own length.
  const maxMs = maxAnswerMs(sess.type, sess.params);
  if (elapsedMs > maxMs) extraHard.push('answered ' + (elapsedMs / 1000).toFixed(1) + ' s after the challenge started; it runs ' + Math.round((maxMs - ACTIVE_GRACE_MS) / 1000) + ' s: a relayed or queued solve, not a live session');

  // Rebuild the hidden schedule on the browser's own timeline from the signed
  // cue receipts. A run that never fetched its cues was scripted in advance.
  let P = sess.params, cueStat = null;
  if (sess.enc) {
    const sealed = unseal(sess.enc);
    const got = Array.isArray(body.cues) ? body.cues.slice(0, 20) : [];
    const applied = sealed.items.map((it, i) => {
      const c = got.find(x => x && x.kind === sealed.kind && x.i === i);
      if (!c) return null;
      const srv = Number(c.srv), at = Number(c.appliedAt);
      if (!Number.isFinite(srv) || !Number.isFinite(at) || cueSig(sess.id, sealed.kind, i, srv) !== c.r) return null;
      if (srv < it.at || srv > it.at + CUE_WINDOW_MS) return null;
      if (Math.abs(at - srv) > 700) return null; // the browser's clock must agree with the server's receipt
      return Math.round(at);
    });
    const missing = applied.filter(x => x === null).length;
    cueStat = { kind: sealed.kind, got: applied.length - missing, of: applied.length };
    if (missing) extraHard.push('missing ' + missing + ' of ' + applied.length + ' live ' + (sealed.kind === 'dart' ? 'jump' : 'flash') + ' signals: the run was scripted or replayed, not reacting live');
    if (sealed.kind === 'dart') P = { ...P, darts: sealed.items.map((it, i) => ({ at: applied[i] ?? it.at, px: it.px, py: it.py })) };
    else P = { ...P, flashes: sealed.items.map((it, i) => applied[i] ?? it.at) };
  }

  // The connection's own evidence counts toward the verdict.
  const netNow = shield.networkRisk(netMeta(req));
  const netScore = Math.max(sess.net || 0, netNow.score);
  if (sess.uah && sess.uah !== uaHash(req)) extraHard.push('started in one browser and answered from another: a relayed challenge');
  if (netScore >= 55) extraHard.push('the connection looks automated: ' + (netNow.reasons[0] || (sess.nr || [])[0] || 'network signals'));

  // Automation probes from the client environment (navigator.webdriver etc).
  const env = body.env || {};
  const webdriver = env.webdriver === true;

  let result;
  if (sess.type === 'pulse') result = scoring.scorePulse(P, body.samples, body.clicks);
  else if (sess.type === 'ring') result = scoring.scoreRingDarts(P, body.samples);
  else if (sess.type === 'beat') result = scoring.scoreBeat(sess.params.beats, body.taps);
  else if (sess.type === 'reflex') result = scoring.scoreReflex(sess.params.rounds, body.clicks);
  else if (sess.type === 'clash') result = scoring.scoreClash(sess.params, body.responses);
  else if (sess.type === 'targets') result = scoring.scoreTargets(sess.params, body.clicks, body.samples, body.pointerType);
  else if (sess.type === 'trace') result = scoring.scoreTrace(sess.params, body.samples);
  else if (sess.type === 'oddone') result = scoring.scoreOddOne(sess.params, sess.ans ? unseal(sess.ans) : [], body.clicks, body.samples, body.pointerType);
  else if (sess.type === 'buddy') result = scoring.scoreBuddy(sess.ans ? unseal(sess.ans) : [], body.responses);
  else result = scoring.scoreVoice(sess.params.words, body.wordTimings, body.transcript);

  if (tooFast) { result.score = Math.min(result.score, 10); result.flags.push('answered in ' + Math.round(elapsedMs) + ' ms for a challenge that runs ' + Math.round(minMs / 0.7) + ' ms: computed, not performed'); }
  if (webdriver) { result.score = Math.min(result.score, 10); result.flags.push('browser reports it is under automation control (navigator.webdriver)'); }
  if (extraHard.length) { result.score = Math.min(result.score, 10); result.flags.unshift(...extraHard); }
  if (!extraHard.length && netScore >= 30) { result.score -= 15; result.flags.push('unusual connection: ' + (netNow.reasons[0] || 'network signals')); }

  const hardFlag = extraHard.length || (result.hard && result.hard.length) || result.flags.some(f => /perfect|zero-lag|uniform|before a human|no micro-corrections|synthetic|before a flash|identical reaction|look-think-act|zero reaction time|never re-acquired|computed, not performed|automation control|one task at a time/.test(f));
  const passed = result.score >= 60 && !tooFast && !webdriver && !hardFlag;
  const actorId = 'human:' + (cookies(req).pop_actor || crypto.randomBytes(6).toString('hex'));
  traceSubmit(req, sess, { attacker, elapsedMs, minMs, maxMs, extraHard, result, passed, env, P, body, netScore, cueStat, webdriver, tooFast });
  {
    const ts = Array.isArray(body.samples) ? body.samples.reduce((m, p) => (p && Number.isFinite(p.t) && p.t > m ? p.t : m), 0) : null;
    layer2.observe(req, 'challenge.submit', {
      sid: sess.id, type: sess.type, passed, score: result.score, flags: result.flags, detail: result.detail, env, elapsedMs, samplesMaxT: ts, attacker,
      actor: passed || cookies(req).pop_actor ? actorId : undefined, note: sess.type + ' ' + (passed ? 'pass ' : 'fail ') + result.score,
    });
  }
  await arena('captchame:' + sess.type, attacker, passed);
  await bump('checks');

  if (passed) {
    const rec = await ledger.ensureActor(actorId, 'anonymous');
    rec.kind = 'human';
    await ledger.grant(actorId, ledger.DEFAULTS.human, 'presence verified (+' + '$2.00)');
    const pass = tokens.mint(actorId, 'human', reqBind(req), { form: sess.form || body.form_hash, via: sess.type });
    res.setHeader('Set-Cookie', ['pop_actor=' + encodeURIComponent(actorId) + '; Path=/; SameSite=Lax', 'cm_pass=1; Path=/; SameSite=Lax; Max-Age=3600']);
    await bump('humans');
    await agPassed(req, actorId);
    await logEvent('pass', `Human verified via ${sess.type} (score ${result.score})`, { lane: sess.type, score: result.score, attacker });
    send(res, 200, { result: 'pass', type: sess.type, score: result.score, flags: result.flags, detail: result.detail, pass_token: pass, actor: actorId, budget_added: ledger.DEFAULTS.human });
  } else {
    await bump('botsCaught');
    await logEvent('fail', `${sess.type} check failed (score ${result.score}): ${result.flags[0] || 'low score'}`, { lane: sess.type, score: result.score, flags: result.flags.slice(0, 6), attacker });
    send(res, 200, { result: 'fail', type: sess.type, score: result.score, flags: result.flags, detail: result.detail, reason: result.flags[0] || 'The response did not look like a live person. Try again, or use another path.' });
  }
});

// ---------- API: arena (classic captchas and real third-party widgets) ----------
const classicHash = v => crypto.createHmac('sha256', SESSION_SECRET).update('classic:' + v).digest('base64url');
// Answers that need a tolerance (positions, angles) ride in the session
// encrypted, so the browser carries them without being able to read them.
const ENC_KEY = crypto.createHash('sha256').update(SESSION_SECRET + ':enc').digest();
function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url');
}
function unseal(s) {
  try {
    const b = Buffer.from(String(s), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}

route('POST', '/api/arena/start', async (req, res) => {
  if (!rateLimit(clientIp(req), 80)) return send(res, 429, { error: 'rate_limited', reason: 'Too many starts. Wait a minute.' });
  const body = await readBody(req);
  const made = classic.make(body.type);
  if (!made) return send(res, 400, { error: 'bad_type', reason: 'type must be one of ' + classic.TYPES.join(', ') });
  const sess = { id: crypto.randomBytes(12).toString('hex'), kind: 'classic', type: body.type, ah: classicHash(classic.normalize(body.type, made.answer)), iat: Date.now() };
  if (made.secret) sess.enc = seal(made.secret);
  { const mk = live.MARKET[body.type]; live.attempt('rival', sess.id, body.type, attackerOf(req))('R', 'info', 'served a ' + (mk ? mk.name : body.type) + ' to "' + attackerOf(req) + '"; it will only check the answer'); }
  if (body.type === 'pow') { sess.salt = made.params.salt; sess.bits = made.params.bits; }
  send(res, 200, { session: signSession(sess), type: body.type, params: made.params });
});

route('POST', '/api/arena/verify', async (req, res) => {
  const body = await readBody(req);
  const sess = readSession(body.session);
  if (!sess || sess.kind !== 'classic') return send(res, 410, { error: 'session_gone', reason: 'Challenge expired. Load a fresh one.' });
  if (doneSessions.has(sess.id)) {
    live.attempt('rival', sess.id, sess.type, attackerOf(req))('R', 'ok', 'replayed answer refused (this demo rival is single-use; many real deployments are too)', { final: true, verdict: 'fail', bypass: false, shadow: 'block', risk: 100, cost: 0 });
    return send(res, 409, { error: 'replay', reason: 'Already answered.' });
  }
  doneSessions.add(sess.id);
  const attacker = attackerOf(req);
  const extra = { ...(body.extra || {}), elapsedMs: Date.now() - sess.iat, salt: sess.salt, bits: sess.bits };
  const r = classic.check(sess.type, sess.ah, body.answer, extra, classicHash, sess.enc ? unseal(sess.enc) : null);
  await arena('classic:' + sess.type, attacker, r.ok);
  await logEvent('arena', `Classic ${sess.type} captcha ${r.ok ? 'solved' : 'failed'} by ${attacker}: ${r.reason}`, { lane: 'classic:' + sess.type, attacker, result: r.ok ? 'pass' : 'fail' });
  try {
    const L = live.attempt('rival', sess.id, sess.type, attacker), mk = live.MARKET[sess.type];
    const human = /^\s*(human|person)\b/i.test(attacker);
    L('R', r.ok ? (human ? 'ok' : 'bypass') : 'ok', 'rival checked the answer only -> ' + (r.ok ? 'PASS' : 'REJECT') + ': ' + r.reason + ' (' + (extra.elapsedMs / 1000).toFixed(2) + ' s)');
    if (mk) L('R', 'info', 'market rate to bypass this format: ' + mk.price + ', solved in about ' + mk.speed + ' (2captcha list)');
    const sh = live.shadowRival(req, sess.type, extra.elapsedMs, body.extra);
    sh.net.lines.forEach(x => L('CM', x.level, x.text));
    sh.lines.forEach(x => L('CM', x.level, x.text));
    L('CM', sh.verdict === 'block' ? 'block' : 'flag', 'CaptchaMe on the same request: ' + (sh.verdict === 'block' ? 'BLOCK (risk ' + sh.risk + ')' : 'NOT ENOUGH - a solved puzzle proves nothing; it would ask for a live check (risk ' + sh.risk + ')'),
      { final: true, verdict: r.ok ? 'pass' : 'fail', bypass: r.ok && !human, shadow: sh.verdict, risk: sh.risk, cost: mk ? mk.per : 0 });
  } catch { /* the live room never breaks a verdict */ }
  layer2.observe(req, 'rival.verify', { sid: sess.id, type: sess.type, ok: r.ok, elapsedMs: extra.elapsedMs, attacker, webdriver: !!(body.extra && body.extra.webdriver), note: sess.type + (r.ok ? ' solved in ' : ' rejected after ') + Math.round(extra.elapsedMs) + ' ms', quiet: false });
  send(res, 200, { ok: r.ok, reason: r.reason, elapsedMs: Date.now() - sess.iat });
});

// Real vendor widgets, with the site owner's own keys only. A vendor with no
// keys is shown as not configured: there is no always-pass test fallback.
const THIRD = {
  turnstile: { site: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY, env: 'TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY', verify: 'https://challenges.cloudflare.com/turnstile/v0/siteverify' },
  hcaptcha: { site: process.env.HCAPTCHA_SITE_KEY, secret: process.env.HCAPTCHA_SECRET_KEY, env: 'HCAPTCHA_SITE_KEY / HCAPTCHA_SECRET_KEY', verify: 'https://api.hcaptcha.com/siteverify' },
  recaptcha: { site: process.env.RECAPTCHA_SITE_KEY, secret: process.env.RECAPTCHA_SECRET_KEY, env: 'RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET_KEY', verify: 'https://www.google.com/recaptcha/api/siteverify' },
};
route('GET', '/api/arena/config', async (req, res) => {
  const out = {};
  for (const [k, v] of Object.entries(THIRD)) out[k] = (v.site && v.secret) ? { configured: true, siteKey: v.site } : { configured: false, env: v.env };
  send(res, 200, out);
});
route('POST', '/api/arena/thirdparty', async (req, res) => {
  const body = await readBody(req);
  const p = THIRD[body.provider];
  if (!p || typeof body.token !== 'string' || !body.token) return send(res, 400, { error: 'bad_request', reason: 'provider and token are required' });
  if (!(p.site && p.secret)) return send(res, 400, { error: 'not_configured', reason: body.provider + ' has no keys on this server. Set ' + p.env + '.' });
  const attacker = attackerOf(req);
  let ok = false, reason = '';
  try {
    const form = new URLSearchParams({ secret: p.secret, response: body.token });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(p.verify, { method: 'POST', body: form, signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    ok = !!j.success;
    reason = ok ? 'vendor verified the token' : 'vendor rejected the token' + (j['error-codes'] ? ' (' + j['error-codes'].join(', ') + ')' : '');
  } catch { reason = 'could not reach the vendor to verify'; }
  await arena(body.provider, attacker, ok);
  await logEvent('arena', `${body.provider} ${ok ? 'passed' : 'failed'} for ${attacker}: ${reason}`, { lane: body.provider, attacker, result: ok ? 'pass' : 'fail' });
  send(res, 200, { ok, reason });
});
route('GET', '/api/arena/results', async (req, res) => {
  send(res, 200, { results: await store.arenaTable() });
});

// ---------- API: scraper shield (a protected listing) ----------
// The protected listing is this server's own public verdict feed: every check,
// agent declaration, audit and arena attempt it judged, newest first, with
// actor ids and addresses removed. Real data that changes as people use the
// site, and exactly the kind of listing a competitor would scrape.
const FEED_PAGE = 12, FEED_MAX_PAGES = 50;
const scrub = s => String(s || '')
  .replace(/\b(?:human|agent|agentpool|anon|v):[\w.:-]+/g, '[actor]')
  .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[address]')
  .replace(/\b[0-9a-f]{12,}\b/gi, '[id]')
  .slice(0, 160);
function publicRow(e) {
  return {
    id: 'ev-' + e.seq, at: e.at, type: e.type, lane: e.lane || null,
    result: e.result || e.decision || ({ pass: 'pass', fail: 'fail', replay: 'fail', trap: 'fail', blocked: 'block', agent: 'pass' }[e.type] || null),
    tool: e.attacker && e.attacker !== 'unlabelled' ? e.attacker : null,
    summary: scrub(e.message),
  };
}
async function verdictFeed(page) {
  const p = Math.max(1, Math.min(FEED_MAX_PAGES, page | 0 || 1));
  // the listing's own access log (scrape events) is left out, or every page
  // view would rewrite the page being viewed
  const rows = (await store.recentEvents(FEED_PAGE * FEED_MAX_PAGES + 200)).filter(e => e.type !== 'scrape').slice(0, FEED_PAGE * FEED_MAX_PAGES).map(publicRow);
  return { page: p, pages: Math.max(1, Math.ceil(rows.length / FEED_PAGE)), total: rows.length, items: rows.slice((p - 1) * FEED_PAGE, p * FEED_PAGE) };
}
function shieldMeta(req, extra = {}) {
  const jar = cookies(req);
  const auth = req.headers.authorization || '';
  let agent = false;
  if (auth.startsWith('Bearer ')) { const v = tokens.verify(auth.slice(7), { consume: false }); agent = v.ok && v.kind === 'agent'; }
  return {
    ip: clientIp(req), ua: req.headers['user-agent'] || '', acceptLanguage: req.headers['accept-language'] || '',
    js: jar.cm_js === '1', vid: jar.cm_vid || '', human: /^human:/.test(jar.pop_actor || '') && jar.cm_pass === '1', agent, ...extra,
  };
}
async function shieldRespond(req, res, verdictObj, page, attacker) {
  await arena('shield:scrape', attacker, verdictObj.decision === 'allow' || verdictObj.decision === 'slow' || verdictObj.decision === 'agent');
  // A decoy is built first so its canary id lands in the operator's log
  // (scrape events never appear in the public feed), never in the response.
  const decoyed = verdictObj.decision === 'decoy' ? shield.decoy(await verdictFeed(page), verdictObj.key) : null;
  layer2.observe(req, 'scrape', { page, decision: verdictObj.decision, score: verdictObj.score, reasons: verdictObj.reasons, attacker, canary: decoyed ? decoyed.canary : null, quiet: true, note: 'catalog page ' + page + ' ' + verdictObj.decision });
  await logEvent('scrape', `Shield ${verdictObj.decision.toUpperCase()} (risk ${verdictObj.score}) page ${page}: ${verdictObj.reasons[0] || 'looks like a person browsing'}${decoyed ? ' - canary ' + decoyed.canary + ' tied to this visitor' : ''}`, { lane: 'shield', decision: verdictObj.decision, score: verdictObj.score, reasons: verdictObj.reasons.slice(0, 4), actor: verdictObj.key, attacker, ...(decoyed ? { canary: decoyed.canary } : {}) });
  const hdr = { 'X-CaptchaMe-Shield': verdictObj.decision, 'X-CaptchaMe-Risk': String(verdictObj.score) };
  if (verdictObj.decision === 'block') {
    await bump('scrapersStopped');
    return send(res, 429, { error: 'blocked', reason: 'This looks like automated scraping: ' + verdictObj.reasons.slice(0, 3).join('; ') + '.', appeal_url: '/appeal?actor=' + encodeURIComponent(verdictObj.key), declare_url: '/agent' }, hdr);
  }
  if (decoyed) {
    await bump('scrapersStopped');
    return send(res, 200, decoyed.listing, { ...hdr, 'Cache-Control': 'public, max-age=3600' });
  }
  if (verdictObj.decision === 'slow') {
    // No server-side wait: the scraper is told to come back later.
    return send(res, 429, { error: 'slow_down', reason: 'Requests are arriving faster than a person browses: ' + verdictObj.reasons.slice(0, 2).join('; ') + '.', retry_after_ms: verdictObj.retryAfterMs }, { ...hdr, 'Retry-After': String(Math.ceil(verdictObj.retryAfterMs / 1000)) });
  }
  send(res, 200, await verdictFeed(page), hdr);
}
route('GET', '/api/catalog', async (req, res) => {
  const page = parseInt(new URL(req.url, 'http://x').searchParams.get('page') || '1', 10) || 1;
  const wba = await webbotauth.verifyRequest(req);
  const meta = shieldMeta(req, { page });
  if (wba && wba.ok) meta.agent = true;
  const v = shield.assess(meta);
  await shieldRespond(req, res, v, page, attackerOf(req));
});

// ---------- API: zero-install bot cost audit from access logs ----------
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('log too large (limit ' + Math.round(limit / 1e6) + ' MB)'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
route('POST', '/api/audit/analyze', async (req, res) => {
  if (!rateLimit('audit:' + clientIp(req), 30)) return send(res, 429, { error: 'rate_limited', reason: 'Too many audits. Wait a minute.' });
  let text, opts = {};
  try {
    if (/application\/json/.test(req.headers['content-type'] || '')) { const b = await readBody(req, 8e6); text = b.log; opts = b; }
    else { text = await readRaw(req, 8e6); const q = new URL(req.url, 'http://x').searchParams; opts = { costPer1k: q.get('cost_per_1k'), costPerGB: q.get('cost_per_gb') }; }
  } catch (e) { return send(res, 413, { error: 'too_large', reason: e.message }); }
  if (!text || !String(text).trim()) return send(res, 400, { error: 'empty', reason: 'Send access-log lines (combined log format or JSON lines).' });
  const r = audit.analyze(text, opts);
  await logEvent('audit', `Log audit: ${r.lines.toLocaleString()} requests, ${Math.round(r.automated.share * 100)}% automated`, { lane: 'audit' });
  send(res, 200, r);
});
// The same audit on this server's own live traffic (admin only: it holds
// visitors' addresses and user agents).
route('GET', '/api/audit/live', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  const q = new URL(req.url, 'http://x').searchParams;
  const info = traffic.info();
  if (!info.requests) return send(res, 200, { empty: true, source: { kind: 'live', ...info } });
  const r = audit.analyze(traffic.lines(), { costPer1k: q.get('cost_per_1k'), costPerGB: q.get('cost_per_gb') });
  send(res, 200, { ...r, source: { kind: 'live', ...info, note: 'Page and asset requests are recorded without their size, so the per-GB cost covers API responses only.' } });
});
route('GET', '/api/catalog/item/:id', async (req, res, params) => {
  const id = decodeURIComponent(params.id);
  if (id.startsWith('trap-')) {
    const v = shield.assess(shieldMeta(req, { honeypot: true }));
    await logEvent('trap', 'Hidden listing link requested: only a program reading the raw page links there', { lane: 'shield', actor: v.key, attacker: attackerOf(req) });
    if (ag.enabled) await ag.trapHit(cookies(req).pop_actor || 'anon:' + clientIp(req) + '|' + (req.headers['user-agent'] || ''), '/api/catalog/item/' + id, req.headers['user-agent']);
    await bump('botsCaught');
    return shieldRespond(req, res, v, 1, attackerOf(req));
  }
  send(res, 404, { error: 'not_found' });
});
// For a customer's edge middleware: send request metadata, get a decision.
route('POST', '/api/shield/check', async (req, res) => {
  if (!rateLimit('shield:' + clientIp(req), 600)) return send(res, 429, { error: 'rate_limited' });
  const b = await readBody(req);
  const v = shield.assess({ ip: String(b.ip || ''), ua: String(b.ua || ''), acceptLanguage: String(b.acceptLanguage || ''), js: !!b.js, vid: String(b.vid || ''), page: Number(b.page), honeypot: !!b.honeypot });
  send(res, 200, { decision: v.decision, risk: v.score, reasons: v.reasons, retry_after_ms: v.retryAfterMs, actor: v.key });
});

// ---------- API: public stats ----------
route('GET', '/api/stats', async (req, res) => {
  const s = await store.stats();
  const sum = await ledger.summary();
  send(res, 200, { checks: s.checks || 0, humans: s.humans || 0, botsCaught: s.botsCaught || 0, agents: s.agents || 0, scrapersStopped: s.scrapersStopped || 0, savedUsd: sum.estimatedSaved });
});

// ---------- API: verify a presence/agent pass (widget customers) ----------
// The customer's server calls this. Send the visitor's user agent, language
// and IP so the pass can be checked against the browser that earned it.
route('POST', '/api/pass/verify', async (req, res) => {
  const body = await readBody(req) || {};
  const bind = body.user_agent ? tokens.bindingOf(body.user_agent, body.accept_language, body.remoteip) : null;
  const form = typeof body.form_hash === 'string' && /^[a-f0-9]{64}$/i.test(body.form_hash) ? body.form_hash.toLowerCase() : null;
  const v = tokens.verify(String(body.pass || body.pass_token || ''), { consume: false, bind, form });
  if (!v.ok) {
    if (v.relayed) {
      await logEvent('replay', 'Relayed pass refused: earned in one browser, presented from another (solver-farm token relay)', { lane: 'token', attacker: attackerOf(req) });
      await arena('captchame:token-relay', attackerOf(req), false);
      await bump('botsCaught');
    }
    if (v.relayed && v.actor) layer2.noteActor(v.actor, 'TOKEN_RELAY', 'solver', 'L6', 0.9, 'the pass was earned in one browser and presented from another: ' + v.reason);
    return send(res, 200, { ok: false, reason: v.reason || 'invalid pass' });
  }
  send(res, 200, { ok: true, subject: v.kind, actor: v.actor, via: v.via, share: v.kind === 'agent' ? 'agent fair-share lane' : 'human presence pass', browser_bound: v.bound, browser_checked: v.bindChecked, form_bound: v.formBound, form_checked: v.formChecked });
});

// ---------- API: the invisible ladder (rung 1 and 1b) ----------
const formOf = h => (typeof h === 'string' && /^[a-f0-9]{64}$/i.test(h) ? h.toLowerCase() : null);
async function mintSilent(req, via, form, attacker, note) {
  const actorId = 'human:' + crypto.randomBytes(6).toString('hex');
  await ledger.ensureActor(actorId, 'human'); // starts with the $2.00 human allowance
  await bump('checks'); await bump('humans');
  await arena('captchame:' + via, attacker, true);
  await logEvent('pass', note, { lane: via, attacker });
  await agPassed(req, actorId);
  return tokens.mint(actorId, 'human', reqBind(req), { form, via });
}
function pageNonceSign(b64) { return crypto.createHmac('sha256', SESSION_SECRET).update('pgn:' + b64).digest('base64url'); }
function netHash(req) { return crypto.createHmac('sha256', SESSION_SECRET).update('nh:' + clientIp(req) + '|' + (req.headers['user-agent'] || '')).digest('base64url').slice(0, 16); }
function pageNonceMint(req) {
  const payload = { iat: Date.now(), exp: Date.now() + 10 * 60e3, nh: netHash(req), f: 'cm_' + crypto.randomBytes(5).toString('hex') };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { nonce: b64 + '.' + pageNonceSign(b64), field: payload.f, ttl_ms: 10 * 60e3 };
}
function pageNonceCheck(req, nonce) {
  if (typeof nonce !== 'string' || nonce.length > 400) return { ok: false };
  const dot = nonce.lastIndexOf('.');
  if (dot < 1) return { ok: false };
  const b64 = nonce.slice(0, dot);
  const a = Buffer.from(nonce.slice(dot + 1)), b = Buffer.from(pageNonceSign(b64));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
  let p;
  try { p = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch { return { ok: false }; }
  if (!p || Date.now() > p.exp || p.nh !== netHash(req)) return { ok: false };
  return { ok: true, field: p.f };
}
route('GET', '/api/page/nonce', async (req, res) => {
  cors(req, res);
  if (!rateLimit('nonce:' + clientIp(req), 240)) return send(res, 429, { error: 'rate_limited' });
  send(res, 200, pageNonceMint(req));
});
route('POST', '/api/page/nonce', async (req, res) => {
  cors(req, res);
  if (!rateLimit('nonce:' + clientIp(req), 240)) return send(res, 429, { error: 'rate_limited' });
  send(res, 200, pageNonceMint(req));
});


// ---------- API: public stats ----------
// Tiny endpoint the widget pings to measure network round trip while a
// challenge runs. The verdict compares RTT with reaction lag.
route('GET', '/api/ping', async (req, res) => { send(res, 200, { t: Date.now() }); });
route('POST', '/api/ping', async (req, res) => { send(res, 200, { t: Date.now() }); });

// Page JS beacons once per page view, so the shield can score asset loads it
// observed itself instead of trusting a caller-supplied "js ran" flag.
route('POST', '/api/shield/beacon', async (req, res) => {
  if (!rateLimit('beacon:' + clientIp(req), 600)) return send(res, 429, { error: 'rate_limited' });
  const jar = cookies(req);
  const key = shield.keyFor({ ip: clientIp(req), ua: req.headers['user-agent'] || '', vid: jar.cm_vid || '' });
  const ok = shield.beacon(key, null);
  send(res, 200, { ok });
});


route('POST', '/api/pass/silent', async (req, res) => {
  cors(req, res);
  if (!rateLimit('silent:' + clientIp(req), 240)) return send(res, 429, { error: 'rate_limited', reason: 'Too many checks. Wait a minute.' });
  const body = await readBody(req, 300000);
  const r = passive.scorePassive(body.telemetry, shield.networkRisk(netMeta(req)));
  const form = formOf(body.form_hash), attacker = attackerOf(req);
  if (r.tier === 'pass') {
    const pass = await mintSilent(req, 'silent', form, attacker, 'Invisible pass: ' + (r.evidence[0] || 'normal interaction'));
    return send(res, 200, { tier: 'pass', pass_token: pass, evidence: r.evidence, detail: r.detail });
  }
  if (r.tier === 'nudge') {
    const goAfterMs = 450 + Math.floor(Math.random() * 700);
    const session = signSession({ id: crypto.randomBytes(12).toString('hex'), kind: 'nudge', goAfterMs, form, iat: Date.now() });
    await logEvent('stepup', 'Invisible check unsure, one-second button check offered: ' + r.reasons[0], { lane: 'silent', attacker, flags: r.reasons });
    return send(res, 200, { tier: 'nudge', session, params: { goAfterMs }, reasons: r.reasons, detail: r.detail });
  }
  await arena('captchame:silent', attacker, false);
  await logEvent('stepup', 'Invisible check escalated to a full check: ' + r.reasons[0], { lane: 'silent', attacker, flags: r.reasons });
  send(res, 200, { tier: 'challenge', reasons: r.reasons, detail: r.detail, challenge_url: '/check?embed=1&format=auto' + (form ? '&form=' + form : '') });
});
route('POST', '/api/pass/nudge', async (req, res) => {
  cors(req, res);
  const body = await readBody(req);
  const sess = readSession(body.session);
  if (!sess || sess.kind !== 'nudge') return send(res, 410, { error: 'session_gone', reason: 'The button check expired. Submit again.' });
  if (doneSessions.has(sess.id)) return send(res, 409, { error: 'replay', reason: 'This button check was already used.' });
  doneSessions.add(sess.id);
  const attacker = attackerOf(req);
  const r = Date.now() - sess.iat > 30000 ? { ok: false, reason: 'the button check expired' } : passive.scoreNudge({ goAfterMs: sess.goAfterMs }, body);
  if (r.ok) {
    const pass = await mintSilent(req, 'nudge', sess.form, attacker, 'Button check passed: ' + r.reason);
    return send(res, 200, { tier: 'pass', pass_token: pass, reason: r.reason });
  }
  await arena('captchame:nudge', attacker, false);
  await logEvent('stepup', 'Button check failed, full check required: ' + r.reason, { lane: 'nudge', attacker });
  send(res, 200, { tier: 'challenge', reason: r.reason, challenge_url: '/check?embed=1&format=auto' + (sess.form ? '&form=' + sess.form : '') });
});

// ---------- API: voice STT via Sarvam (server-side key, capped) ----------
// One STT call per voice challenge session, plus a daily cap, so the demo
// cannot burn the owner's Sarvam credits. The browser falls back to its
// built-in speech recognition whenever this route says no.
route('POST', '/api/voice/stt', async (req, res) => {
  const body = await readBody(req);
  const sess = readSession(body.session);
  if (!sess || sess.type !== 'voice') return send(res, 410, { error: 'session_gone', reason: 'Start a fresh voice challenge.' });
  if (sttUsedSessions.has(sess.id)) return send(res, 409, { error: 'stt_used', reason: 'This voice challenge already used its speech recognition call.' });
  const today = new Date().toISOString().slice(0, 10);
  if (sttDaily.day !== today) { sttDaily.day = today; sttDaily.n = 0; }
  if (sttDaily.n >= STT_DAILY_CAP) return send(res, 429, { error: 'stt_daily_cap', reason: 'Speech recognition is capped for today; the browser fallback still works.' });
  if (!SARVAM_API_KEY) return send(res, 503, { error: 'stt_not_configured', reason: 'Server speech recognition is not configured; use the browser fallback.' });
  const audioB64 = typeof body.audio === 'string' ? body.audio : '';
  if (audioB64.length < 100 || audioB64.length > 6 * 1024 * 1024) return send(res, 400, { error: 'bad_audio', reason: 'Audio missing or too large.' });

  sttUsedSessions.add(sess.id);
  sttDaily.n++;
  try {
    const buf = Buffer.from(audioB64, 'base64');
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: body.mime || 'audio/webm' }), 'audio.webm');
    fd.append('model', 'saaras:v4');
    fd.append('language_code', 'en-IN');
    fd.append('keyterms', JSON.stringify(sess.params.words));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': SARVAM_API_KEY },
      body: fd,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return send(res, 502, { error: 'stt_upstream', reason: 'Speech service error ' + r.status + '. Browser fallback still works.', upstream: txt.slice(0, 200) });
    }
    const j = await r.json();
    const transcript = (j.transcript || j.text || '').trim();
    await logEvent('call', `Sarvam STT used for a voice check (#${sttDaily.n} today)`, { lane: 'voice' });
    send(res, 200, { transcript, engine: 'sarvam' });
  } catch (e) {
    send(res, 502, { error: 'stt_failed', reason: 'Speech service unreachable. Browser fallback still works.' });
  }
});

// ---------- API: agent lane (Web Bot Auth-shaped, simplified) ----------
const agentNonces = new Map();
route('POST', '/api/agent/nonce', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('hex');
  agentNonces.set(nonce, Date.now());
  send(res, 200, { nonce, algorithm: 'ed25519', note: 'Sign this nonce with your agent key and POST it to /api/agent/declare. For a verified operator budget, sign each request with Web Bot Auth (RFC 9421) instead; see /api/agent/whoami.' });
});

route('POST', '/api/agent/declare', async (req, res) => {
  const body = await readBody(req);
  const { pubkey, signature, nonce, operator } = body;
  if (!pubkey || !signature || !nonce) return send(res, 400, { error: 'bad_request', reason: 'pubkey, signature and nonce are required.' });
  if (!agentNonces.has(nonce)) return send(res, 409, { error: 'bad_nonce', reason: 'Unknown or used nonce.' });
  agentNonces.delete(nonce);
  let ok = false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(pubkey, 'base64'), format: 'der', type: 'spki' });
    ok = crypto.verify(null, Buffer.from(nonce, 'utf8'), key, Buffer.from(signature, 'base64'));
  } catch { ok = false; }
  if (!ok) {
    await logEvent('fail', 'Agent declaration failed: bad signature');
    return send(res, 403, { error: 'bad_signature', reason: 'Signature did not verify against the public key.' });
  }
  const keyHash = crypto.createHash('sha256').update(pubkey).digest('hex').slice(0, 12);
  // A fresh key costs nothing to make, so a key alone earns no budget of its
  // own. Delegated: declared with a person's pass, it spends from that
  // person's fair share. Unverified: every such key on the same network
  // shares one small pool. (Agents that sign with Web Bot Auth are verified
  // per operator instead; see /api/agent/whoami.)
  let actorId, mode, budget, note;
  const delegated = body.pass ? tokens.verify(String(body.pass), { consume: false, bind: reqBind(req) }) : null;
  if (delegated && delegated.ok && delegated.kind === 'human') {
    actorId = delegated.actor; mode = 'delegated';
    const a = await ledger.getActor(actorId);
    budget = a ? ledger.remaining(a) : 0;
    note = 'Delegated to a verified person: this agent spends from their fair share, however many keys they use.';
  } else {
    actorId = 'agentpool:' + netPrefix(clientIp(req)); mode = 'pooled';
    const a = await ledger.ensureActor(actorId, 'agent');
    budget = ledger.remaining(a);
    note = 'Unverified key: it shares one $' + ledger.DEFAULTS.agent.toFixed(2) + ' pool with every unverified key from your network. Declare with a person’s pass to use their share, or sign requests with Web Bot Auth for a verified operator budget.';
  }
  const token = tokens.mint(actorId, 'agent', null, { via: mode });
  await bump('agents');
  await arena('agent-lane', attackerOf(req), true);
  await logEvent('agent', `Agent declared (${mode}): ${(operator || 'unnamed operator').slice(0, 60)} (key ${keyHash}) - challenge skipped, budget from ${mode === 'delegated' ? 'the person’s share' : 'the network pool'}`, { lane: 'agent', attacker: attackerOf(req) });
  layer2.observe(req, 'agent.declare', { verified: true, agentId: (operator || keyHash), actor: actorId, attacker: attackerOf(req), quiet: true, note: 'agent declared (' + mode + ')' });
  send(res, 200, { result: 'declared', mode, actor: actorId, agent_token: token, budget, note });
});

// Agent builders: check how this server sees your Web Bot Auth signature.
route('GET', '/api/agent/whoami', async (req, res) => {
  const v = await webbotauth.verifyRequest(req);
  if (!v) return send(res, 200, { verified: false, reason: 'No Web Bot Auth signature on this request (Signature, Signature-Input and Signature-Agent headers).' });
  if (!v.ok) return send(res, 401, { verified: false, reason: v.reason });
  const actorId = 'agent:wba:' + v.agent;
  const a = await ledger.ensureActor(actorId, 'verified');
  send(res, 200, { verified: true, operator: v.agent, keyid: v.keyid, actor: actorId, budget: ledger.remaining(a) });
});

// ---------- API: a metered resource behind the fair-share ledger ----------
// Each call costs the actor $0.10 of its allowance and returns this server's
// live verdict snapshot: counters plus the arena scoreboard, computed now.
// (The path keeps its original name so existing integrations keep working.)
route('GET', '/api/protected/quote', async (req, res) => {
  const jar = cookies(req);
  const auth = req.headers.authorization || '';
  let actorId, kind, passAgeS = null, via = null;
  const wba = await webbotauth.verifyRequest(req);
  if (wba && !wba.ok) return send(res, 401, { error: 'bad_agent_signature', reason: 'Web Bot Auth signature did not verify: ' + wba.reason });
  if (wba && wba.ok) {
    actorId = 'agent:wba:' + wba.agent; kind = 'agent';
    if (!(await ledger.getActor(actorId))) await logEvent('agent', `Verified signed agent: ${wba.agent} (Web Bot Auth) - operator budget opened`, { lane: 'agent', attacker: attackerOf(req) });
    await ledger.ensureActor(actorId, 'verified');
  } else if (auth.startsWith('Bearer ')) {
    // A fresh verification pass or agent token authorises one call and also
    // tops up the actor. After that the cookie-backed actor id carries the budget.
    const v = tokens.verify(auth.slice(7), { consume: false, bind: reqBind(req) });
    if (!v.ok) return send(res, 401, { error: 'invalid_token', reason: v.reason });
    actorId = v.actor; kind = v.kind; passAgeS = v.ageS; via = v.via;
    await ledger.ensureActor(actorId, kind === 'agent' ? 'agent' : 'anonymous');
  } else if (jar.pop_actor) {
    actorId = jar.pop_actor.startsWith('human:') || jar.pop_actor.startsWith('agent:') ? jar.pop_actor : 'human:' + jar.pop_actor;
    await ledger.ensureActor(actorId, 'anonymous');
    kind = 'anon';
  } else {
    actorId = 'human:' + crypto.randomBytes(6).toString('hex');
    await ledger.ensureActor(actorId, 'anonymous');
    kind = 'anon';
    res.setHeader('Set-Cookie', 'pop_actor=' + encodeURIComponent(actorId) + '; Path=/; SameSite=Lax');
  }
  // Post-verification layer: fold this request into the identity behind the pass, then decide.
  const l2 = layer2.observe(req, 'protected', { actor: actorId, ok: true, usd: ledger.COST_PER_CALL, attacker: attackerOf(req), agent: (kind === 'agent' || (wba && wba.ok)) ? { verified: true, id: actorId } : undefined, quiet: true, note: 'protected call (' + kind + ')' });
  if ((l2.decision === 'block' || l2.decision === 'step_up') && layer2.MODE === 'enforce') {
    layer2.denied(l2.subject, ledger.COST_PER_CALL);
    await bump('layer2Blocked');
    await logEvent('blocked', `Layer 2 ${l2.decision}: ${actorId.slice(0, 18)} looks like ${l2.cls.replace('_', ' ')} (${Math.round(l2.conf * 100)}%)`, { actor: actorId, lane: 'layer2', attacker: attackerOf(req) });
    return send(res, 403, {
      error: l2.decision === 'block' ? 'layer2_blocked' : 'step_up_required', decision: l2.decision, class: l2.cls, confidence: l2.conf, subject: l2.subject,
      reason: 'The post-verification layer linked this request to an identity that looks like ' + l2.cls.replace('_', ' ') + ': ' + l2.why + '.',
      appeal_url: '/appeal?actor=' + encodeURIComponent(actorId), ...(l2.decision === 'step_up' ? { challenge_url: '/check' } : {}), declare_url: '/agent',
    });
  }
  if (l2.decision !== 'allow') res.setHeader('X-CaptchaMe-L2', l2.decision + '; ' + l2.cls + '; shadow');
  // Layer 2 (abuseguard), when configured: one decision per person across every account and key linked to
  // them. In shadow mode (the default) the verdict is recorded and compared, never enforced. Fails open.
  let verdict = null;
  if (ag.enabled) {
    const rec = await ledger.getActor(actorId);
    const plan = wba && wba.ok ? 'agent' : rec && rec.kind === 'human' ? 'human' : rec && (rec.kind === 'agent' || rec.kind === 'verified') ? 'agent' : 'anonymous';
    await Promise.all([ag.link(actorId, 'ip', netPrefix(clientIp(req))), jar.cm_vid ? ag.link(actorId, 'device', jar.cm_vid) : null]);
    verdict = await ag.assess({
      actor: actorId, plan, path: '/api/protected/quote', ua: req.headers['user-agent'],
      signals: ag.signalsFor({ kind: wba && wba.ok ? 'agent' : plan === 'human' ? 'human' : kind, via, passAgeS: wba && wba.ok ? 0 : passAgeS, wbaAgent: wba && wba.ok ? wba.agent : null }),
    });
    const out = ag.toHttp(verdict, actorId);
    if (out) {
      await logEvent('blocked', `abuseguard ${verdict.decision}: ${actorId.slice(0, 18)} (${(verdict.reasons || []).slice(0, 3).join(', ')})`, { actor: actorId, lane: 'abuseguard' });
      return send(res, out.status, out.body, out.headers);
    }
    if (verdict && verdict.decision_id) res.setHeader('AG-Decision', `${verdict.decision}; enforced=${!!verdict.enforced}`);
  }
  const charge = await ledger.spend(actorId, ledger.COST_PER_CALL);
  if (verdict) ag.compare(verdict, !charge.ok);
  if (!charge.ok) {
    await logEvent('blocked', `Fair-share cap: ${actorId.slice(0, 18)} blocked (${charge.body.error})`, { actor: actorId });
    return send(res, charge.status, { ...charge.body, ...(verdict && verdict.decision_id ? { decision_id: verdict.decision_id } : {}) });
  }
  await ag.usage(actorId, ledger.COST_PER_CALL);
  const [s, board] = await Promise.all([store.stats(), store.arenaTable()]);
  const top = board.sort((a, b) => (b.pass + b.fail) - (a.pass + a.fail)).slice(0, 10).map(r => ({ format: r.format, attacker: r.attacker, pass: r.pass, fail: r.fail }));
  await logEvent('call', `API call served to ${actorId.slice(0, 18)} ($${ledger.COST_PER_CALL.toFixed(2)})`, { actor: actorId });
  send(res, 200, {
    resource: 'live verdict snapshot', at: new Date().toISOString(),
    data: { checks: s.checks || 0, humans: s.humans || 0, botsCaught: s.botsCaught || 0, agents: s.agents || 0, scrapersStopped: s.scrapersStopped || 0, arenaTop: top },
    charged: ledger.COST_PER_CALL, remaining: charge.remaining,
  });
});

// ---------- API: early-access requests (the protected form on /check) ----------
// A real form with a real server-side check: the pass must be a person's,
// earned in this browser, for exactly these field values, and it is used up.
route('POST', '/api/early-access', async (req, res) => {
  if (!rateLimit('early:' + clientIp(req), 20)) return send(res, 429, { error: 'rate_limited', reason: 'Too many requests. Wait a minute.' });
  const body = await readBody(req, 20000);
  const fields = {};
  for (const [k, v] of Object.entries(body || {})) if (k !== 'cm_pass' && typeof v === 'string') fields[k] = v;
  const name = String(fields.name || '').trim().slice(0, 80), email = String(fields.email || '').trim().slice(0, 120);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'bad_request', reason: 'A name and a valid email are required.' });
  // the same hash the widget makes: sorted [name, value] pairs, cm_pass left out
  const pairs = Object.entries(fields).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const form = crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
  const v = tokens.verify(String(body.cm_pass || ''), { consume: true, bind: reqBind(req), form });
  if (!v.ok || v.kind !== 'human' || !v.formBound) {
    await logEvent('fail', 'Early-access request refused: ' + (v.reason || (v.ok ? 'pass not bound to this form' : 'no valid pass')), { lane: 'form', attacker: attackerOf(req) });
    return send(res, 403, { error: 'no_pass', reason: v.ok ? 'This pass was not issued for this form.' : (v.reason || 'A valid pass from this page is required.') });
  }
  await store.addSignup({ id: crypto.randomBytes(8).toString('hex'), name, email, at: Date.now(), via: v.via || 'check' });
  await bump('signups');
  await logEvent('signup', `Early-access request accepted (verified by the ${v.via || 'live'} check)`, { lane: 'form' });
  send(res, 200, { ok: true, via: v.via, reason: 'Thanks. Your request is in, verified without a puzzle.' });
});
route('GET', '/api/admin/signups', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  send(res, 200, { signups: await store.listSignups() });
});

// ---------- API: ledger + appeals ----------
route('GET', '/api/ledger/me', async (req, res) => {
  const jar = cookies(req);
  const actorId = jar.pop_actor ? (jar.pop_actor.startsWith('human:') || jar.pop_actor.startsWith('agent:') ? jar.pop_actor : 'human:' + jar.pop_actor) : null;
  if (!actorId) return send(res, 200, { actor: null });
  const a = await ledger.getActor(actorId);
  send(res, 200, { actor: a ? { id: a.id, kind: a.kind, spent: +a.spent.toFixed(2), granted: a.granted, remaining: ledger.remaining(a) } : null });
});

route('POST', '/api/appeal', async (req, res) => {
  const body = await readBody(req);
  if (!body.actor || !body.message) return send(res, 400, { error: 'bad_request', reason: 'actor and message are required.' });
  const ap = await ledger.fileAppeal(body.actor, body.message);
  await ag.fileAppeal(String(body.actor), ap.id, body.message, typeof body.decision_id === 'string' ? body.decision_id.slice(0, 80) : null); // layer 2 keeps its own appeal record
  await logEvent('appeal', `Appeal filed by ${String(body.actor).slice(0, 18)}`, { actor: body.actor });
  send(res, 200, { ok: true, appeal_id: ap.id, reason: 'Appeal received. A human reviews every one; you will never be silently blocked.' });
});

// ---------- API: admin / dashboard ----------
function adminOK(req) { return req.headers['x-admin-key'] === ADMIN_KEY; }
route('GET', '/api/admin/events', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  const since = +(new URL(req.url, 'http://x').searchParams.get('since') || 0);
  // oldest first after the cursor, so clients can page through everything
  send(res, 200, { events: (await store.eventsSince(since)).slice(0, 200) });
});
route('GET', '/api/admin/actors', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  send(res, 200, { actors: await ledger.table(), summary: await ledger.summary() });
});
route('GET', '/api/admin/appeals', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  send(res, 200, { appeals: (await ledger.listAppeals()).slice(0, 50) });
});
route('POST', '/api/admin/appeal/:id', async (req, res, params) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  const body = await readBody(req);
  const ap = await ledger.resolveAppeal(+params.id, body.action);
  if (!ap) return send(res, 404, { error: 'not_found' });
  await ag.resolveAppeal(ap.id, ap.status === 'approved'); // CaptchaMe's own +$1 grant (ledger.resolveAppeal) is unchanged
  await logEvent('appeal', `Appeal #${ap.id} ${ap.status} (${ap.actorId.slice(0, 18)})`, {});
  send(res, 200, { ok: true, appeal: ap });
});
route('GET', '/api/admin/shield', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  send(res, 200, { actors: shield.state() });
});
// Reset counters and logs (in-memory mode only). Early-access requests stay.
route('POST', '/api/admin/reset', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  if (!store.reset()) return send(res, 400, { error: 'persistent_store', reason: 'Reset only works in in-memory mode; clear the Firestore collections instead.' });
  layer2.reset();
  shield.reset(); doneSessions.clear(); traffic.reset();
  send(res, 200, { ok: true, reason: 'Cleared: ledger, events, appeals, arena scores, stats, shield state and the live access log. Early-access requests were kept.' });
});

// ---------- abuseguard: signed events in, status out ----------
// abuseguard POSTs subject.flagged / appeal.filed / appeal.resolved here. Each message is signed
// (t=<unix>,v1=<hmac>) with the secret returned once by PUT /v1/webhook-endpoints; unsigned or stale ones are refused.
route('POST', '/api/abuseguard-events', async (req, res) => {
  const secret = process.env.ABUSEGUARD_WEBHOOK_SECRET || '';
  let raw;
  try { raw = await readRaw(req, 100000); } catch (e) { return send(res, 413, { error: 'too_large' }); }
  if (!secret || !ag.verifyWebhook(raw, req.headers['ag-signature'] || req.headers['x-abuseguard-signature'], secret)) return send(res, 401, { error: 'bad_signature' });
  let ev = {}; try { ev = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad_json' }); }
  const type = String(ev.type || ev.event || 'event').slice(0, 40);
  const d = ev.data || ev;
  await logEvent('abuseguard', `abuseguard ${type}` + (d.outcome ? ' (' + d.outcome + ')' : '') + (Array.isArray(d.reasons) ? ': ' + d.reasons.slice(0, 3).join(', ') : ''), { lane: 'abuseguard' });
  ag.noteWebhook();
  await bump('abuseguardEvents');
  send(res, 200, { ok: true });
});
route('GET', '/api/admin/abuseguard', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  send(res, 200, ag.status());
});

// ---------- layer 2: post-verification analysis ----------
route('GET', '/api/layer2/overview', async (req, res) => { send(res, 200, { ...layer2.overview({ demoOnly: !adminOK(req) }), view: adminOK(req) ? 'full' : 'demo' }); });
route('GET', '/api/layer2/subject/:id', async (req, res, params) => {
  const d = layer2.detail(params.id, { demoOnly: !adminOK(req) });
  if (!d) return send(res, 404, { error: 'not_found', reason: 'No identity with that id (it may have been merged into another one).' });
  send(res, 200, d);
});
// Local only: the page asks for the admin key the server printed in its log, so the person who started the
// server does not have to copy it. Refused on Vercel and for any request that came through a proxy.
route('GET', '/api/demo/key', async (req, res) => {
  const ra = String((req.socket && req.socket.remoteAddress) || '');
  const lo = (x) => /^(::1|127\.|::ffff:127\.)/.test(String(x).trim());
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').filter(Boolean);
  // loopback connection, every forwarded address is loopback, and the page was opened as localhost
  const local = lo(ra) && fwd.every(lo) && ['localhost', '127.0.0.1', '::1'].includes(host);
  if (process.env.VERCEL || !local) return send(res, 404, { error: 'not_found' });
  send(res, 200, { key: ADMIN_KEY });
});
// Demo only: the analysis behind a built-in attacker's run, so the home page can show it without an admin key.
route('GET', '/api/live/analysis/:id', async (req, res, params) => {
  const d = layer2.detail(params.id);
  if (!d || !d.attackers.length || !d.attackers.every((a) => /^Sim: /.test(a))) return send(res, 404, { error: 'not_found' });
  send(res, 200, d);
});
route('POST', '/api/layer2/reset', async (req, res) => { if (!adminOK(req)) return send(res, 403, { error: 'forbidden' }); layer2.reset(); send(res, 200, { ok: true }); });

// ---------- live attack room ----------
route('GET', '/api/live/feed', async (req, res) => {
  const since = new URL(req.url, 'http://x').searchParams.get('since');
  send(res, 200, { seq: live.last(), events: live.since(since) });
});
route('POST', '/api/live/reset', async (req, res) => { live.reset(); send(res, 200, { ok: true }); });
// Built-in attackers, so the room can be shown without your own tools. They
// hit this server over real HTTP with their own headers, like any client.
const simbots = require('./lib/simbots');
const simRunning = new Set();
route('POST', '/api/live/simulate', async (req, res) => {
  const body = await readBody(req);
  if (!simbots.BOTS[body.bot]) return send(res, 400, { error: 'bad_bot', reason: 'bot must be one of ' + Object.keys(simbots.BOTS).join(', ') });
  if (simRunning.has(body.bot)) return send(res, 409, { error: 'busy', reason: 'That simulator is already running.' });
  if (simRunning.size >= 3) return send(res, 429, { error: 'busy', reason: 'Three simulators are already running.' });
  const port = req.socket && req.socket.localPort;
  if (!port) return send(res, 500, { error: 'no_port' });
  simRunning.add(body.bot);
  simbots.run(body.bot, port, { formats: body.formats }).catch(() => {}).finally(() => simRunning.delete(body.bot));
  send(res, 202, { ok: true, bot: body.bot, label: simbots.BOTS[body.bot].label });
});
route('GET', '/api/live/bots', async (req, res) => {
  send(res, 200, { bots: Object.entries(simbots.BOTS).map(([id, b]) => ({ id, label: b.label, blurb: b.blurb })), running: [...simRunning], market: live.MARKET });
});

// ---------- honeypot trap (invisible to people, visible to DOM-reading agents) ----------
const trapHandler = async (req, res) => {
  layer2.observe(req, 'trap', { attacker: attackerOf(req), quiet: true, note: 'trap link' });
  await bump('botsCaught');
  await arena('trap-link', attackerOf(req), false);
  if (ag.enabled) await ag.trapHit(cookies(req).pop_actor || 'anon:' + clientIp(req) + '|' + (req.headers['user-agent'] || ''), '/trap', req.headers['user-agent']);
  await logEvent('trap', 'Trap link followed: only something reading the raw DOM would see it', { lane: 'trap', attacker: attackerOf(req) });
  send(res, 200, '<!doctype html><title>Trap</title><body style="background:#0b0e14;color:#e8ecf4;font-family:sans-serif;padding:40px">This link is invisible to people and marked hidden from assistive tech. Only a program reading the raw page could follow it. This visit has been logged as automated traffic.</body>', { 'Content-Type': 'text/html' });
};
route('GET', '/trap', trapHandler);
route('GET', '/api/trap', trapHandler); // alias: Next.js rewrites /trap here

// ---------- static ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'nope');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

const handler = async (req, res) => {
  const u = new URL(req.url, 'http://x');
  // Every request this handler answers goes into the live access log that
  // /api/audit/live reads, with its real status and size.
  const t0 = Date.now(), end = res.end;
  res.end = function (chunk, ...rest) {
    if (u.pathname === '/api/live/feed') return end.call(this, chunk, ...rest); // the room polls; keep it out of the audit log
    try {
      const bytes = chunk && typeof chunk !== 'function' ? Buffer.byteLength(chunk) : Number(res.getHeader('content-length')) || 0;
      traffic.record({ ip: clientIp(req), t: t0, method: req.method, path: req.url, status: res.statusCode, bytes, ua: req.headers['user-agent'] });
    } catch { /* logging never breaks a response */ }
    return end.call(this, chunk, ...rest);
  };
  if (req.method === 'OPTIONS' && (u.pathname.startsWith('/api/pass/') || u.pathname.startsWith('/api/page/'))) { cors(req, res); res.writeHead(204); return res.end(); }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.rx.exec(u.pathname);
    if (m) {
      const params = {}; r.keys.forEach((k, i) => params[k] = m[i + 1]);
      try { return await r.handler(req, res, params); }
      catch (e) { return send(res, 500, { error: 'server_error', reason: e.message }); }
    }
  }
  if (req.method === 'GET') {
    // On Vercel, /public is served by the platform and only /api/* reaches
    // this function. Locally the same handler serves everything.
    if (process.env.VERCEL) return send(res, 404, { error: 'not_found' });
    return serveStatic(req, res);
  }
  send(res, 404, { error: 'not_found' });
};

if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`CaptchaMe listening on http://localhost:${PORT}`);
    console.log(`Console: http://localhost:${PORT}/dashboard${process.env.POP_ADMIN_KEY ? '  (admin key from POP_ADMIN_KEY)' : ''}`);
  });
}
module.exports = handler;
