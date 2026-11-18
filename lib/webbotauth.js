'use strict';
// Verifies AI-agent requests signed with Web Bot Auth: HTTP Message
// Signatures (RFC 9421) as profiled by the IETF webbotauth working group
// (still a draft). The agent sends:
//   Signature-Agent: "https://agent.example"
//   Signature-Input: sig1=("@authority" "signature-agent");created=..;expires=..;keyid="<JWK thumbprint>";alg="ed25519";tag="web-bot-auth"
//   Signature: sig1=:<base64 signature>:
// and publishes its Ed25519 keys at
//   https://agent.example/.well-known/http-message-signatures-directory
// A verified agent is identified by its operator's host, so it needs no
// registration call and cannot multiply itself with throwaway keys.
const crypto = require('crypto');

const DIR_TTL_MS = 60 * 60 * 1000;
const dirCache = new Map();

function thumbprint(jwk) {
  return crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest('base64url');
}
const unquote = s => String(s || '').trim().replace(/^"(.*)"$/, '$1');

// Split a structured-field dictionary at top-level commas: label=value pairs.
function parseDict(v) {
  const out = new Map();
  let depth = 0, inQ = false, start = 0;
  const s = String(v || '');
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') inQ = !inQ;
    else if (!inQ && c === '(') depth++;
    else if (!inQ && c === ')') depth--;
    if (i === s.length || (c === ',' && !inQ && depth === 0)) {
      const part = s.slice(start, i).trim();
      const eq = part.indexOf('=');
      if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
      start = i + 1;
    }
  }
  return out;
}
function parseParams(raw) {
  const p = {};
  const rest = raw.replace(/^\([^)]*\)/, '');
  for (const m of rest.matchAll(/;([a-z0-9_-]+)=("([^"]*)"|[^;]*)/gi)) p[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return p;
}

function allowedAgentUrl(u) {
  if (u.protocol === 'https:') return true;
  // plain http only for local development and the test suite
  return u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && process.env.NODE_ENV !== 'production';
}

async function directory(agentUrl) {
  const hit = dirCache.get(agentUrl);
  if (hit && Date.now() - hit.at < DIR_TTL_MS) return hit.keys;
  const url = new URL('/.well-known/http-message-signatures-directory', agentUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/http-message-signatures-directory+json, application/json' } });
    if (!r.ok) throw new Error('key directory answered ' + r.status);
    const j = await r.json();
    const keys = new Map();
    for (const jwk of (j.keys || [])) {
      if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) continue;
      keys.set(thumbprint(jwk), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' }));
    }
    dirCache.set(agentUrl, { at: Date.now(), keys });
    return keys;
  } finally { clearTimeout(timer); }
}

// Returns null when the request makes no Web Bot Auth claim, otherwise
// { ok, agent, keyid, reason }.
async function verifyRequest(req) {
  const si = req.headers['signature-input'], sg = req.headers['signature'];
  if (!si || !sg) return null;
  try {
    const inputs = parseDict(si);
    let label = null, raw = null;
    for (const [k, v] of inputs) { if (/;tag="web-bot-auth"/.test(v)) { label = k; raw = v; break; } }
    if (!label) return { ok: false, reason: 'no signature tagged web-bot-auth' };
    const params = parseParams(raw);
    const now = Math.floor(Date.now() / 1000);
    if (params.alg && params.alg !== 'ed25519') return { ok: false, reason: 'unsupported algorithm ' + params.alg };
    if (!params.created || Number(params.created) > now + 60) return { ok: false, reason: 'signature created in the future' };
    if (!params.expires || Number(params.expires) < now) return { ok: false, reason: 'signature expired' };
    if (Number(params.expires) - Number(params.created) > 24 * 3600) return { ok: false, reason: 'signature validity longer than 24 hours' };
    const comps = [...(raw.match(/^\(([^)]*)\)/) || ['', ''])[1].matchAll(/"([^"]+)"/g)].map(m => m[1].toLowerCase());
    if (!comps.includes('@authority')) return { ok: false, reason: 'signature does not cover @authority' };

    const saRaw = req.headers['signature-agent'];
    let agentUrl = null;
    if (saRaw) {
      if (!comps.includes('signature-agent')) return { ok: false, reason: 'Signature-Agent header is not covered by the signature' };
      agentUrl = /^\s*"/.test(saRaw) ? unquote(saRaw) : unquote(parseDict(saRaw).get(label));
    }
    if (!agentUrl) return { ok: false, reason: 'no Signature-Agent naming the key directory' };
    const u = new URL(agentUrl);
    if (!allowedAgentUrl(u)) return { ok: false, reason: 'key directory must be served over https' };

    const lines = [];
    for (const c of comps) {
      if (c === '@authority') lines.push('"@authority": ' + String(req.headers.host || '').toLowerCase());
      else if (c.startsWith('@')) return { ok: false, reason: 'unsupported derived component ' + c };
      else { const v = req.headers[c]; if (v === undefined) return { ok: false, reason: 'covered header missing: ' + c }; lines.push('"' + c + '": ' + String(v).trim()); }
    }
    lines.push('"@signature-params": ' + raw);
    const sigMatch = /^:([A-Za-z0-9+/=]+):$/.exec(String(parseDict(sg).get(label) || ''));
    if (!sigMatch) return { ok: false, reason: 'malformed Signature header' };
    const keys = await directory(u.origin);
    const key = keys.get(unquote(params.keyid));
    if (!key) return { ok: false, reason: 'keyid not found in the agent’s key directory' };
    const ok = crypto.verify(null, Buffer.from(lines.join('\n'), 'utf8'), key, Buffer.from(sigMatch[1], 'base64'));
    return ok ? { ok: true, agent: u.host, keyid: unquote(params.keyid) } : { ok: false, reason: 'signature did not verify' };
  } catch (e) {
    return { ok: false, reason: 'could not verify: ' + e.message };
  }
}

module.exports = { verifyRequest, thumbprint, parseDict };
