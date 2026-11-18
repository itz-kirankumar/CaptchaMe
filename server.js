'use strict';
/*
 * Proof of Presence - hackathon build.
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
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 1e6) { reject(new Error('body too large')); req.destroy(); } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

// ---------- event feed for the dashboard ----------
const events = [];
let eventSeq = 0;
function logEvent(type, message, extra = {}) {
  events.push({ seq: ++eventSeq, at: Date.now(), type, message, ...extra });
  if (events.length > 2000) events.splice(0, 1000);
}

// ---------- challenge sessions ----------
const sessions = new Map(); // id -> {type, params, createdAt, ip, done}
const SESSION_TTL = 90 * 1000;
setInterval(() => { const now = Date.now(); for (const [k, v] of sessions) if (now - v.createdAt > SESSION_TTL) sessions.delete(k); }, 30000).unref();

const VOICE_WORDS = ['mango', 'river', 'lantern', 'copper', 'window', 'falcon', 'harbor', 'pencil', 'thunder', 'garden', 'silver', 'bridge', 'marble', 'cloud', 'tiger', 'velvet', 'anchor', 'meadow', 'rocket', 'willow'];

const rateBuckets = new Map();
function rateLimit(ip, perMin = 40) {
  const now = Date.now(); const b = rateBuckets.get(ip) || { n: 0, reset: now + 60000 };
  if (now > b.reset) { b.n = 0; b.reset = now + 60000; }
  b.n++; rateBuckets.set(ip, b);
  return b.n <= perMin;
}

// ---------- API: challenges ----------
route('POST', '/api/challenge/start', async (req, res) => {
  const ip = req.socket.remoteAddress || 'na';
  if (!rateLimit(ip)) return send(res, 429, { error: 'rate_limited', reason: 'Too many challenge starts. Wait a minute.' });
  const body = await readBody(req);
  const id = crypto.randomBytes(12).toString('hex');
  const type = body.type;
  let params;
  if (type === 'ring') {
    params = {
      ax: 0.22 + Math.random() * 0.12, ay: 0.22 + Math.random() * 0.12,
      fx: 0.12 + Math.random() * 0.10, fy: 0.12 + Math.random() * 0.10,
      px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
      durationMs: 7000,
    };
  } else if (type === 'beat') {
    const beats = []; let t = 1500;
    for (let i = 0; i < 12; i++) { beats.push(Math.round(t)); t += 550 + Math.random() * 200; }
    params = { beats };
  } else if (type === 'voice') {
    const words = [...VOICE_WORDS].sort(() => Math.random() - 0.5).slice(0, 4);
    const cadence = words.map(() => 1400 + Math.round(Math.random() * 900)); // ms between word prompts
    params = { words, cadence };
  } else {
    return send(res, 400, { error: 'bad_type', reason: 'type must be ring, beat or voice' });
  }
  sessions.set(id, { type, params, createdAt: Date.now(), ip, done: false });
  send(res, 200, { session: id, type, params, expires_in_ms: SESSION_TTL });
});

route('POST', '/api/challenge/submit', async (req, res) => {
  const body = await readBody(req);
  const sess = sessions.get(body.session);
  if (!sess) return send(res, 410, { error: 'session_gone', reason: 'Challenge expired. Start a fresh one.' });
  if (sess.done) {
    logEvent('replay', `Replay blocked: session ${body.session.slice(0, 6)} submitted twice`, { lane: sess.type });
    return send(res, 409, { error: 'replay', reason: 'This challenge was already answered. Challenges work once.' });
  }
  sess.done = true;

  let result;
  if (sess.type === 'ring') result = scoring.scoreRing(sess.params, body.samples);
  else if (sess.type === 'beat') result = scoring.scoreBeat(sess.params.beats, body.taps);
  else result = scoring.scoreVoice(sess.params.words, body.wordTimings, body.transcript);

  const passed = result.score >= 60 && !result.flags.some(f => /perfect|zero-lag|uniform|before a human|no micro-corrections|synthetic/.test(f));
  const actorId = 'human:' + (cookies(req).pop_actor || crypto.randomBytes(6).toString('hex'));

  if (passed) {
    const rec = ledger.ensureActor(actorId, 'anonymous');
    rec.kind = 'human';
    ledger.grant(actorId, ledger.DEFAULTS.human, 'presence verified (+' + '$2.00)');
    const pass = tokens.mint(actorId, 'human');
    res.setHeader('Set-Cookie', 'pop_actor=' + encodeURIComponent(actorId) + '; Path=/; SameSite=Lax');
    logEvent('pass', `Human verified via ${sess.type} (score ${result.score})`, { lane: sess.type, score: result.score });
    send(res, 200, { result: 'pass', score: result.score, flags: result.flags, detail: result.detail, pass_token: pass, actor: actorId, budget_added: ledger.DEFAULTS.human });
  } else {
    logEvent('fail', `${sess.type} check failed (score ${result.score}): ${result.flags[0] || 'low score'}`, { lane: sess.type, score: result.score, flags: result.flags });
    send(res, 200, { result: 'fail', score: result.score, flags: result.flags, detail: result.detail, reason: result.flags[0] || 'The response did not look like a live person. Try again, or use another path.' });
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
    logEvent('fail', 'Agent declaration failed: bad signature');
    return send(res, 403, { error: 'bad_signature', reason: 'Signature did not verify against the public key.' });
  }
  const keyHash = crypto.createHash('sha256').update(pubkey).digest('hex').slice(0, 12);
  const actorId = 'agent:' + keyHash;
  ledger.ensureActor(actorId, 'agent');
  const token = tokens.mint(actorId, 'agent');
  logEvent('agent', `Agent declared: ${(operator || 'unnamed operator').slice(0, 60)} (key ${keyHash}) - challenge skipped, own budget granted`, { lane: 'agent' });
  send(res, 200, { result: 'declared', actor: actorId, agent_token: token, budget: ledger.DEFAULTS.agent, note: 'Declared agents skip the human checks and get their own fair-share budget.' });
});

// ---------- API: protected demo resource (a fake paid AI API) ----------
route('GET', '/api/protected/quote', async (req, res) => {
  const jar = cookies(req);
  const auth = req.headers.authorization || '';
  let actorId, kind;
  if (auth.startsWith('Bearer ')) {
    // A fresh verification pass or agent token authorises one call and also
    // tops up the actor. After that the cookie-backed actor id carries the budget.
    const v = tokens.verify(auth.slice(7), { consume: false });
    if (!v.ok) return send(res, 401, { error: 'invalid_token', reason: v.reason });
    actorId = v.actor; kind = v.kind;
    ledger.ensureActor(actorId, kind === 'agent' ? 'agent' : 'anonymous');
  } else if (jar.pop_actor) {
    actorId = jar.pop_actor.startsWith('human:') || jar.pop_actor.startsWith('agent:') ? jar.pop_actor : 'human:' + jar.pop_actor;
    ledger.ensureActor(actorId, 'anonymous');
    kind = 'anon';
  } else {
    actorId = 'human:' + crypto.randomBytes(6).toString('hex');
    ledger.ensureActor(actorId, 'anonymous');
    kind = 'anon';
    res.setHeader('Set-Cookie', 'pop_actor=' + encodeURIComponent(actorId) + '; Path=/; SameSite=Lax');
  }
  const charge = ledger.spend(actorId, ledger.COST_PER_CALL);
  if (!charge.ok) {
    logEvent('blocked', `Fair-share cap: ${actorId.slice(0, 18)} blocked (${charge.body.error})`, { actor: actorId });
    return send(res, charge.status, charge.body);
  }
  const QUOTES = [
    'Simulated AI response. Each call here costs the actor $0.10 of shared compute.',
    'This endpoint stands in for any paid AI API: LLM tokens, image runs, search credits.',
    'The ledger, not the puzzle, is what keeps one actor from draining the pool.',
  ];
  logEvent('call', `API call served to ${actorId.slice(0, 18)} ($${ledger.COST_PER_CALL.toFixed(2)})`, { actor: actorId });
  send(res, 200, { quote: QUOTES[Math.floor(Math.random() * QUOTES.length)], charged: ledger.COST_PER_CALL, remaining: charge.remaining });
});

// ---------- API: ledger + appeals ----------
route('GET', '/api/ledger/me', async (req, res) => {
  const jar = cookies(req);
  const actorId = jar.pop_actor ? (jar.pop_actor.startsWith('human:') || jar.pop_actor.startsWith('agent:') ? jar.pop_actor : 'human:' + jar.pop_actor) : null;
  if (!actorId) return send(res, 200, { actor: null });
  const a = ledger.getActor(actorId);
  send(res, 200, { actor: a ? { id: a.id, kind: a.kind, spent: +a.spent.toFixed(2), granted: a.granted, remaining: ledger.remaining(a) } : null });
});

route('POST', '/api/appeal', async (req, res) => {
  const body = await readBody(req);
  if (!body.actor || !body.message) return send(res, 400, { error: 'bad_request', reason: 'actor and message are required.' });
  const ap = ledger.fileAppeal(body.actor, body.message);
  logEvent('appeal', `Appeal filed by ${String(body.actor).slice(0, 18)}`, { actor: body.actor });
  send(res, 200, { ok: true, appeal_id: ap.id, reason: 'Appeal received. A human reviews every one; you will never be silently blocked.' });
});

// ---------- API: admin / dashboard ----------
function adminOK(req) { return req.headers['x-admin-key'] === ADMIN_KEY; }
route('GET', '/api/admin/events', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  const since = +(new URL(req.url, 'http://x').searchParams.get('since') || 0);
  send(res, 200, { events: events.filter(e => e.seq > since).slice(-200) });
});
route('GET', '/api/admin/actors', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  send(res, 200, { actors: ledger.table(), summary: ledger.summary() });
});
route('GET', '/api/admin/appeals', async (req, res) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  send(res, 200, { appeals: ledger.appeals.slice(-50) });
});
route('POST', '/api/admin/appeal/:id', async (req, res, params) => {
  if (!adminOK(req)) return send(res, 403, { error: 'forbidden' });
  const body = await readBody(req);
  const ap = ledger.resolveAppeal(+params.id, body.action);
  if (!ap) return send(res, 404, { error: 'not_found' });
  logEvent('appeal', `Appeal #${ap.id} ${ap.status} (${ap.actorId.slice(0, 18)})`, {});
  send(res, 200, { ok: true, appeal: ap });
});

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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.rx.exec(u.pathname);
    if (m) {
      const params = {}; r.keys.forEach((k, i) => params[k] = m[i + 1]);
      try { return await r.handler(req, res, params); }
      catch (e) { return send(res, 500, { error: 'server_error', reason: e.message }); }
    }
  }
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`Proof of Presence listening on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard.html  (admin key: ${ADMIN_KEY})`);
});
module.exports = server;
