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

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.POP_ADMIN_KEY || 'demo-admin';
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
// How long after it starts a challenge can still be answered: its own length
// plus a short grace. Solver queues that relay a task take 10-40 s.
const ACTIVE_GRACE_MS = Number(process.env.POP_ACTIVE_GRACE_MS) || 6000;
function maxAnswerMs(type, P) {
  if (type === 'ring' || type === 'pulse') return P.durationMs + ACTIVE_GRACE_MS;
  if (type === 'reflex' || type === 'clash') return P.totalMs + ACTIVE_GRACE_MS;
  if (type === 'beat') return P.beats[P.beats.length - 1] + 800 + ACTIVE_GRACE_MS;
  if (type === 'targets') return P.timeoutMs + 2000;
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
    if (!s.id || Date.now() - s.iat > SESSION_TTL) return null;
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
const AUTO_TYPES = ['ring', 'pulse', 'reflex', 'clash', 'targets'];
const CLASH_COLORS = ['RED', 'BLUE'];
function makeParams(type) {
  let params;
  if (type === 'clash') {
    const kinds = [true, true, true, true, false, false, false, false].sort(() => Math.random() - 0.5);
    let t = 1300;
    const trials = kinds.map(cong => {
      const ink = CLASH_COLORS[Math.random() < 0.5 ? 0 : 1];
      const word = cong ? ink : CLASH_COLORS.find(c => c !== ink);
      const tr = { at: Math.round(t), word, ink };
      t += 1450 + Math.random() * 400;
      return tr;
    });
    return { colors: CLASH_COLORS, trials, windowMs: 1300, totalMs: Math.round(trials[trials.length - 1].at + 1700) };
  }
  if (type === 'targets') {
    const W = 800, H = 450, radii = [16, 24, 34, 48];
    const targets = [];
    let prev = { x: W / 2, y: H / 2 };
    for (let i = 0; i < 9; i++) {
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

route('POST', '/api/challenge/start', async (req, res) => {
  const ip = clientIp(req);
  if (!rateLimit(ip)) return send(res, 429, { error: 'rate_limited', reason: 'Too many challenge starts. Wait a minute.' });
  const body = await readBody(req);
  const id = crypto.randomBytes(12).toString('hex');
  const type = body.type === 'auto' ? AUTO_TYPES[Math.floor(Math.random() * AUTO_TYPES.length)] : body.type;
  let params = makeParams(type);
  if (params) { /* clash or targets */ }
  else if (type === 'ring') {
    params = {
      ax: 0.22 + Math.random() * 0.12, ay: 0.22 + Math.random() * 0.12,
      fx: 0.12 + Math.random() * 0.10, fy: 0.12 + Math.random() * 0.10,
      px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
      durationMs: 7000,
      reacquireMs: 1200,
      darts: [2200 + Math.random() * 800, 4400 + Math.random() * 800].map(at => ({
        at: Math.round(at),
        px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
      })),
    };
  } else if (type === 'beat') {
    const beats = []; let t = 1500;
    for (let i = 0; i < 12; i++) { beats.push(Math.round(t)); t += 550 + Math.random() * 200; }
    params = { beats };
  } else if (type === 'pulse') {
    const flashes = [];
    let ft = 1400 + Math.random() * 800;
    while (ft < 6200) { flashes.push(Math.round(ft)); ft += 1500 + Math.random() * 1500; }
    params = {
      ax: 0.26 + Math.random() * 0.12, ay: 0.22 + Math.random() * 0.12,
      fx: 0.07 + Math.random() * 0.08, fy: 0.05 + Math.random() * 0.06,
      px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
      durationMs: 7000, flashes, flashWindowMs: 800,
    };
  } else if (type === 'reflex') {
    const rounds = []; let t = 1200;
    for (let i = 0; i < 5; i++) { rounds.push({ at: Math.round(t), windowMs: 900 }); t += 1400 + Math.random() * 1900; }
    params = { rounds, totalMs: Math.round(t + 800) };
  } else if (type === 'voice') {
    const words = [...VOICE_WORDS].sort(() => Math.random() - 0.5).slice(0, 4);
    const cadence = words.map(() => 1400 + Math.round(Math.random() * 900)); // ms between word prompts
    params = { words, cadence };
  } else {
    return send(res, 400, { error: 'bad_type', reason: 'type must be one of ring, beat, reflex, pulse, clash, targets, voice or auto' });
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
  if (typeof body.form_hash === 'string' && /^[a-f0-9]{64}$/i.test(body.form_hash)) sess.form = body.form_hash.toLowerCase();
  send(res, 200, { session: signSession(sess), type, params: publicParams, active_window_ms: maxAnswerMs(type, publicParams), auto: body.type === 'auto' });
});

// ---------- live cues for the hidden schedule ----------
const CUE_WINDOW_MS = 1500;
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
  send(res, 200, { cues, srv, done: srv > Math.max(...sealed.items.map(x => x.at)) + CUE_WINDOW_MS });
});

route('POST', '/api/challenge/submit', async (req, res) => {
  const body = await readBody(req);
  const sess = readSession(body.session);
  if (!sess) return send(res, 410, { error: 'session_gone', reason: 'Challenge expired or was tampered with. Start a fresh one.' });
  const attacker = attackerOf(req);
  if (doneSessions.has(sess.id)) {
    await logEvent('replay', `Replay blocked: session ${sess.id.slice(0, 6)} submitted twice`, { lane: sess.type, attacker });
    await bump('botsCaught');
    await arena('captchame:' + sess.type, attacker, false);
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
  const tooFast = elapsedMs < minMs;
  const extraHard = [];

  // Out-of-band solver queues take 10-40 s; a live session answers in its own length.
  const maxMs = maxAnswerMs(sess.type, sess.params);
  if (elapsedMs > maxMs) extraHard.push('answered ' + (elapsedMs / 1000).toFixed(1) + ' s after the challenge started; it runs ' + Math.round((maxMs - ACTIVE_GRACE_MS) / 1000) + ' s: a relayed or queued solve, not a live session');

  // Rebuild the hidden schedule on the browser's own timeline from the signed
  // cue receipts. A run that never fetched its cues was scripted in advance.
  let P = sess.params;
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
  else result = scoring.scoreVoice(sess.params.words, body.wordTimings, body.transcript);

  if (tooFast) { result.score = Math.min(result.score, 10); result.flags.push('answered in ' + Math.round(elapsedMs) + ' ms for a challenge that runs ' + Math.round(minMs / 0.7) + ' ms: computed, not performed'); }
  if (webdriver) { result.score = Math.min(result.score, 10); result.flags.push('browser reports it is under automation control (navigator.webdriver)'); }
  if (extraHard.length) { result.score = Math.min(result.score, 10); result.flags.unshift(...extraHard); }
  if (!extraHard.length && netScore >= 30) { result.score -= 15; result.flags.push('unusual connection: ' + (netNow.reasons[0] || 'network signals')); }

  const hardFlag = extraHard.length || (result.hard && result.hard.length) || result.flags.some(f => /perfect|zero-lag|uniform|before a human|no micro-corrections|synthetic|before a flash|identical reaction|look-think-act|zero reaction time|never re-acquired|computed, not performed|automation control|one task at a time/.test(f));
  const passed = result.score >= 60 && !tooFast && !webdriver && !hardFlag;
  const actorId = 'human:' + (cookies(req).pop_actor || crypto.randomBytes(6).toString('hex'));
  await arena('captchame:' + sess.type, attacker, passed);
  await bump('checks');

  if (passed) {
    const rec = await ledger.ensureActor(actorId, 'anonymous');
    rec.kind = 'human';
    await ledger.grant(actorId, ledger.DEFAULTS.human, 'presence verified (+' + '$2.00)');
    const pass = tokens.mint(actorId, 'human', reqBind(req), { form: sess.form || body.form_hash, via: sess.type });
    res.setHeader('Set-Cookie', ['pop_actor=' + encodeURIComponent(actorId) + '; Path=/; SameSite=Lax', 'cm_pass=1; Path=/; SameSite=Lax; Max-Age=3600']);
    await bump('humans');
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
  if (body.type === 'pow') { sess.salt = made.params.salt; sess.bits = made.params.bits; }
  send(res, 200, { session: signSession(sess), type: body.type, params: made.params });
});

route('POST', '/api/arena/verify', async (req, res) => {
  const body = await readBody(req);
  const sess = readSession(body.session);
  if (!sess || sess.kind !== 'classic') return send(res, 410, { error: 'session_gone', reason: 'Challenge expired. Load a fresh one.' });
  if (doneSessions.has(sess.id)) return send(res, 409, { error: 'replay', reason: 'Already answered.' });
  doneSessions.add(sess.id);
  const attacker = attackerOf(req);
  const extra = { ...(body.extra || {}), elapsedMs: Date.now() - sess.iat, salt: sess.salt, bits: sess.bits };
  const r = classic.check(sess.type, sess.ah, body.answer, extra, classicHash, sess.enc ? unseal(sess.enc) : null);
  await arena('classic:' + sess.type, attacker, r.ok);
  await logEvent('arena', `Classic ${sess.type} captcha ${r.ok ? 'solved' : 'failed'} by ${attacker}: ${r.reason}`, { lane: 'classic:' + sess.type, attacker, result: r.ok ? 'pass' : 'fail' });
  send(res, 200, { ok: r.ok, reason: r.reason, elapsedMs: Date.now() - sess.iat });
});

// Real vendor widgets. Without keys, the vendors' published test keys are
// used, which always pass: the page says so. Add real keys for a real fight.
const THIRD = {
  turnstile: { site: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY, testSite: '1x00000000000000000000AA', testSecret: '1x0000000000000000000000000000000AA', verify: 'https://challenges.cloudflare.com/turnstile/v0/siteverify' },
  hcaptcha: { site: process.env.HCAPTCHA_SITE_KEY, secret: process.env.HCAPTCHA_SECRET_KEY, testSite: '10000000-ffff-ffff-ffff-000000000001', testSecret: '0x0000000000000000000000000000000000000000', verify: 'https://api.hcaptcha.com/siteverify' },
  recaptcha: { site: process.env.RECAPTCHA_SITE_KEY, secret: process.env.RECAPTCHA_SECRET_KEY, testSite: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', testSecret: '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe', verify: 'https://www.google.com/recaptcha/api/siteverify' },
};
route('GET', '/api/arena/config', async (req, res) => {
  const out = {};
  for (const [k, v] of Object.entries(THIRD)) out[k] = { siteKey: (v.site && v.secret) ? v.site : v.testSite, test: !(v.site && v.secret) };
  send(res, 200, out);
});
route('POST', '/api/arena/thirdparty', async (req, res) => {
  const body = await readBody(req);
  const p = THIRD[body.provider];
  if (!p || typeof body.token !== 'string' || !body.token) return send(res, 400, { error: 'bad_request', reason: 'provider and token are required' });
  const test = !(p.site && p.secret);
  const attacker = attackerOf(req);
  let ok = false, reason = '';
  try {
    const form = new URLSearchParams({ secret: test ? p.testSecret : p.secret, response: body.token });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(p.verify, { method: 'POST', body: form, signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    ok = !!j.success;
    reason = ok ? 'vendor verified the token' : 'vendor rejected the token' + (j['error-codes'] ? ' (' + j['error-codes'].join(', ') + ')' : '');
  } catch { reason = 'could not reach the vendor to verify'; }
  if (test) reason += ' [test key: always passes]';
  await arena(body.provider, attacker, ok);
  await logEvent('arena', `${body.provider} ${ok ? 'passed' : 'failed'} for ${attacker}: ${reason}`, { lane: body.provider, attacker, result: ok ? 'pass' : 'fail' });
  send(res, 200, { ok, reason, test });
});
route('GET', '/api/arena/results', async (req, res) => {
  send(res, 200, { results: await store.arenaTable() });
});

// ---------- API: scraper shield (a protected listing) ----------
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
  await logEvent('scrape', `Shield ${verdictObj.decision.toUpperCase()} (risk ${verdictObj.score}) page ${page}: ${verdictObj.reasons[0] || 'looks like a person browsing'}`, { lane: 'shield', decision: verdictObj.decision, score: verdictObj.score, reasons: verdictObj.reasons.slice(0, 4), actor: verdictObj.key, attacker });
  const hdr = { 'X-CaptchaMe-Shield': verdictObj.decision, 'X-CaptchaMe-Risk': String(verdictObj.score) };
  if (verdictObj.decision === 'block') {
    await bump('scrapersStopped');
    return send(res, 429, { error: 'blocked', reason: 'This looks like automated scraping: ' + verdictObj.reasons.slice(0, 3).join('; ') + '.', appeal_url: '/appeal?actor=' + encodeURIComponent(verdictObj.key), declare_url: '/agent' }, hdr);
  }
  if (verdictObj.decision === 'decoy') { await bump('scrapersStopped'); return send(res, 200, shield.decoy(page, verdictObj.key), { ...hdr, 'Cache-Control': 'public, max-age=3600' }); }
  if (verdictObj.decision === 'slow') {
    // No server-side wait: the scraper is told to come back later.
    return send(res, 429, { error: 'slow_down', reason: 'Requests are arriving faster than a person browses: ' + verdictObj.reasons.slice(0, 2).join('; ') + '.', retry_after_ms: verdictObj.retryAfterMs }, { ...hdr, 'Retry-After': String(Math.ceil(verdictObj.retryAfterMs / 1000)) });
  }
  send(res, 200, shield.catalog(page), hdr);
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
route('GET', '/api/catalog/item/:id', async (req, res, params) => {
  const id = decodeURIComponent(params.id);
  if (id.startsWith('trap-')) {
    const v = shield.assess(shieldMeta(req, { honeypot: true }));
    await logEvent('trap', 'Hidden catalogue item requested: only a program reading the raw page links there', { lane: 'shield', actor: v.key, attacker: attackerOf(req) });
    await bump('botsCaught');
    return shieldRespond(req, res, v, 1, attackerOf(req));
  }
  const m = /^NW-(\d+)$/.exec(id);
  if (!m) return send(res, 404, { error: 'not_found' });
  const n = +m[1] - 10000;
  const page = Math.floor(n / 12) + 1;
  const it = shield.catalog(page).items[n % 12];
  send(res, it ? 200 : 404, it || { error: 'not_found' });
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
  return tokens.mint(actorId, 'human', reqBind(req), { form, via });
}
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
  send(res, 200, { nonce, algorithm: 'ed25519', note: 'Sign this nonce with your agent key and POST it to /api/agent/declare. Shape follows the Web Bot Auth draft (Signature-Input / Signature); simplified for the demo.' });
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

// ---------- API: protected demo resource (a fake paid AI API) ----------
route('GET', '/api/protected/quote', async (req, res) => {
  const jar = cookies(req);
  const auth = req.headers.authorization || '';
  let actorId, kind;
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
    actorId = v.actor; kind = v.kind;
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
  const charge = await ledger.spend(actorId, ledger.COST_PER_CALL);
  if (!charge.ok) {
    await logEvent('blocked', `Fair-share cap: ${actorId.slice(0, 18)} blocked (${charge.body.error})`, { actor: actorId });
    return send(res, charge.status, charge.body);
  }
  const QUOTES = [
    'Simulated AI response. Each call here costs the actor $0.10 of shared compute.',
    'This endpoint stands in for any paid AI API: LLM tokens, image runs, search credits.',
    'The ledger, not the puzzle, is what keeps one actor from draining the pool.',
  ];
  await logEvent('call', `API call served to ${actorId.slice(0, 18)} ($${ledger.COST_PER_CALL.toFixed(2)})`, { actor: actorId });
  send(res, 200, { quote: QUOTES[Math.floor(Math.random() * QUOTES.length)], charged: ledger.COST_PER_CALL, remaining: charge.remaining });
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
  await logEvent('appeal', `Appeal #${ap.id} ${ap.status} (${ap.actorId.slice(0, 18)})`, {});
  send(res, 200, { ok: true, appeal: ap });
});
route('GET', '/api/admin/shield', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  send(res, 200, { actors: shield.state() });
});
// Wipe demo data before going on stage (in-memory mode only).
route('POST', '/api/admin/reset', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  if (!store.reset()) return send(res, 400, { error: 'persistent_store', reason: 'Reset only works in in-memory mode; clear the Firestore collections instead.' });
  shield.reset(); doneSessions.clear();
  send(res, 200, { ok: true, reason: 'Demo data cleared: ledger, events, appeals, arena scores, stats and shield state.' });
});

// ---------- honeypot trap (invisible to people, visible to DOM-reading agents) ----------
const trapHandler = async (req, res) => {
  await bump('botsCaught');
  await arena('trap-link', attackerOf(req), false);
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
  if (req.method === 'OPTIONS' && u.pathname.startsWith('/api/pass/')) { cors(req, res); res.writeHead(204); return res.end(); }
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
    console.log(`Dashboard: http://localhost:${PORT}/dashboard.html  (admin key: ${ADMIN_KEY})`);
  });
}
module.exports = handler;
