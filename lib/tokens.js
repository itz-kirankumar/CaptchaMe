'use strict';
// One-time, short-lived, HMAC-signed pass tokens.
const crypto = require('crypto');

const SECRET = process.env.POP_SECRET || crypto.randomBytes(32).toString('hex');
const TTL_MS = 5 * 60 * 1000;
const used = new Set(); // single-use ids

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

function mint(actorId, kind) {
  const payload = {
    jti: crypto.randomBytes(8).toString('hex'),
    actor: actorId,
    kind, // 'human' | 'agent'
    exp: Date.now() + TTL_MS,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return b64 + '.' + sign(b64);
}

// Returns {ok, actor, kind, reason}
function verify(token, { consume = true } = {}) {
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
  if (consume) used.add(payload.jti);
  if (used.size > 10000) { // bound memory
    const it = used.values(); for (let i = 0; i < 5000; i++) used.delete(it.next().value);
  }
  return { ok: true, actor: payload.actor, kind: payload.kind };
}

module.exports = { mint, verify };
