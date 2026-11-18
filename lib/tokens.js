'use strict';
// One-time, short-lived, HMAC-signed pass tokens.
const crypto = require('crypto');

const SECRET = process.env.POP_SECRET || crypto.randomBytes(32).toString('hex');
const TTL_MS = 5 * 60 * 1000;
const used = new Set(); // single-use ids

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

// A pass is bound to the browser that earned it: a short hash of its user
// agent, language and network prefix. Solver farms hand a token earned on a
// worker's machine to the bot's browser; a bound token refuses that relay.
// (A farm can still route the worker through the bot's proxy and copy its
// user agent; binding raises the cost, the fair-share ledger caps the prize.)
function bindingOf(ua, lang, ip) {
  const s = String(ip || '');
  const prefix = s.includes(':') ? s.split(':').slice(0, 3).join(':') : s.split('.').slice(0, 2).join('.');
  return crypto.createHash('sha256').update(String(ua || '') + '|' + String(lang || '') + '|' + prefix).digest('base64url').slice(0, 12);
}

// extra.form: SHA-256 of the exact form fields the pass was earned for, so a
// pass cannot be pasted into a different submission.
function mint(actorId, kind, bind, extra) {
  const payload = {
    jti: crypto.randomBytes(8).toString('hex'),
    actor: actorId,
    kind, // 'human' | 'agent'
    exp: Date.now() + TTL_MS,
  };
  if (bind) payload.bind = bind;
  if (extra && typeof extra.form === 'string' && /^[a-f0-9]{64}$/.test(extra.form)) payload.form = extra.form;
  if (extra && extra.via) payload.via = String(extra.via).slice(0, 16);
  if (extra && Number.isFinite(extra.rtt)) payload.rtt = Math.round(extra.rtt);
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return b64 + '.' + sign(b64);
}

// Returns {ok, actor, kind, reason}
function verify(token, { consume = true, bind = null, form = null } = {}) {
  if (typeof token !== 'string' || token.length > 512) return { ok: false, reason: 'malformed token' };
  const dot = token.lastIndexOf('.');
  if (dot < 1) return { ok: false, reason: 'malformed token' };
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = sign(b64);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' };
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); }
  catch { return { ok: false, reason: 'malformed payload' }; }
  if (Date.now() > payload.exp) return { ok: false, reason: 'pass expired (passes live 5 minutes)' };
  if (used.has(payload.jti)) return { ok: false, reason: 'pass already used (each pass works once)' };
  if (payload.bind && bind && payload.bind !== bind) return { ok: false, reason: 'pass was earned in a different browser: a relayed solver token', relayed: true };
  if (payload.form && form && payload.form !== String(form).toLowerCase()) return { ok: false, reason: 'pass was issued for a different form submission', relayed: true };
  if (consume) used.add(payload.jti);
  if (used.size > 10000) { // bound memory
    const it = used.values(); for (let i = 0; i < 5000; i++) used.delete(it.next().value);
  }
  return { ok: true, actor: payload.actor, kind: payload.kind, via: payload.via || null, rtt: Number.isFinite(payload.rtt) ? payload.rtt : null, bound: !!payload.bind, bindChecked: !!(payload.bind && bind), formBound: !!payload.form, formChecked: !!(payload.form && form) };
}

module.exports = { mint, verify, bindingOf };
