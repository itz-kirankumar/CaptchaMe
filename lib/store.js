'use strict';
// Persistent store: Firestore over its REST API (no dependencies) when
// FIREBASE_SA_JSON (service account JSON) is set; in-memory otherwise, which
// keeps local dev and the e2e suite dependency-free.
const crypto = require('crypto');

const SA_JSON = process.env.FIREBASE_SA_JSON || '';
let sa = null, project = null;
if (SA_JSON) {
  try { sa = JSON.parse(SA_JSON); project = sa.project_id; } catch { sa = null; }
}
const ENABLED = !!(sa && project);
const BASE = () => `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;

// ---- auth: service-account JWT -> access token, cached ----
let tokCache = { token: null, exp: 0 };
async function accessToken() {
  if (tokCache.token && Date.now() < tokCache.exp - 60000) return tokCache.token;
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })).toString('base64url');
  const unsigned = hdr + '.' + claims;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + sig,
  });
  const b = await r.json();
  if (!b.access_token) throw new Error('firebase auth failed: ' + (b.error_description || r.status));
  tokCache = { token: b.access_token, exp: Date.now() + (b.expires_in || 3600) * 1000 };
  return tokCache.token;
}

// ---- Firestore value (de)serialisation ----
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: toFields(v) } };
}
function toFields(obj) { const f = {}; for (const k of Object.keys(obj)) f[k] = toFs(obj[k]); return f; }
function fromFs(v) {
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  return fromFields(v.mapValue.fields || {});
}
function fromFields(f) { const o = {}; for (const k of Object.keys(f)) o[k] = fromFs(f[k]); return o; }

async function fsReq(method, path, body) {
  const t = await accessToken();
  const r = await fetch(BASE() + path, {
    method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404) return null;
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('firestore ' + r.status + ': ' + (b.error && b.error.message || 'unknown'));
  return b;
}

const mem = { actors: new Map(), events: [], appeals: [], appealSeq: 1, eventSeq: 1, arena: new Map(), stats: {}, signups: [] };
const MEM_EVENTS = 5000;

const store = {
  enabled: ENABLED,

  // ---- actors (fair-share ledger) ----
  async getActor(id) {
    if (!ENABLED) return mem.actors.get(id) || null;
    const d = await fsReq('GET', '/actors/' + encodeURIComponent(id));
    return d ? fromFields(d.fields) : null;
  },
  async putActor(id, rec) {
    if (!ENABLED) { mem.actors.set(id, rec); return; }
    await fsReq('PATCH', '/actors/' + encodeURIComponent(id), { fields: toFields(rec) });
  },
  async listActors() {
    if (!ENABLED) return [...mem.actors.entries()].map(([id, r]) => ({ id, ...r }));
    const d = await fsReq('GET', '/actors?pageSize=200');
    return (d.documents || []).map(doc => ({ id: decodeURIComponent(doc.name.split('/').pop()), ...fromFields(doc.fields) }));
  },

  // ---- event feed (dashboard) ----
  async addEvent(ev) {
    if (!ENABLED) { mem.events.push(ev); if (mem.events.length > MEM_EVENTS) mem.events.splice(0, mem.events.length - MEM_EVENTS); return; }
    await fsReq('POST', '/events?documentId=' + encodeURIComponent(String(ev.seq) + '-' + crypto.randomBytes(3).toString('hex')), { fields: toFields(ev) });
  },
  async nextEventSeq() {
    if (!ENABLED) return mem.eventSeq++;
    const d = await fsReq('GET', '/counters/events');
    const cur = d ? fromFields(d.fields).n : 0;
    await fsReq('PATCH', '/counters/events', { fields: toFields({ n: cur + 1 }) });
    return cur + 1;
  },
  async eventsSince(seq) {
    if (!ENABLED) return mem.events.filter(e => e.seq > seq);
    const q = { structuredQuery: { from: [{ collectionId: 'events' }],
      where: { fieldFilter: { field: { fieldPath: 'seq' }, op: 'GREATER_THAN', value: toFs(seq) } },
      orderBy: [{ field: { fieldPath: 'seq' }, direction: 'ASCENDING' }], limit: 100 } };
    const rows = await fsReq('POST', ':runQuery', q);
    return (rows || []).filter(r => r.document).map(r => fromFields(r.document.fields));
  },
  // newest first
  async recentEvents(n = 100) {
    if (!ENABLED) return mem.events.slice(-n).reverse();
    const q = { structuredQuery: { from: [{ collectionId: 'events' }],
      orderBy: [{ field: { fieldPath: 'seq' }, direction: 'DESCENDING' }], limit: Math.min(1000, n) } };
    const rows = await fsReq('POST', ':runQuery', q);
    return (rows || []).filter(r => r.document).map(r => fromFields(r.document.fields));
  },

  // ---- early-access requests from the protected form on /check ----
  async addSignup(rec) {
    if (!ENABLED) { mem.signups.unshift(rec); if (mem.signups.length > 5000) mem.signups.length = 5000; return; }
    await fsReq('PATCH', '/signups/' + encodeURIComponent(rec.id), { fields: toFields(rec) });
  },
  async listSignups() {
    if (!ENABLED) return mem.signups.slice(0, 200);
    const d = await fsReq('GET', '/signups?pageSize=200');
    return ((d && d.documents) || []).map(doc => fromFields(doc.fields)).sort((a, b) => b.at - a.at);
  },

  // ---- appeals ----
  async addAppeal(ap) {
    if (!ENABLED) { mem.appeals.push(ap); return; }
    await fsReq('PATCH', '/appeals/' + ap.id, { fields: toFields(ap) });
  },
  async nextAppealId() {
    if (!ENABLED) return mem.appealSeq++;
    const d = await fsReq('GET', '/counters/appeals');
    const cur = d ? fromFields(d.fields).n : 0;
    await fsReq('PATCH', '/counters/appeals', { fields: toFields({ n: cur + 1 }) });
    return cur + 1;
  },
  async getAppeal(id) {
    if (!ENABLED) return mem.appeals.find(a => a.id === id) || null;
    const d = await fsReq('GET', '/appeals/' + id);
    return d ? fromFields(d.fields) : null;
  },
  async putAppeal(id, ap) {
    if (!ENABLED) { const i = mem.appeals.findIndex(a => a.id === id); if (i >= 0) mem.appeals[i] = ap; return; }
    await fsReq('PATCH', '/appeals/' + id, { fields: toFields(ap) });
  },
  async listAppeals() {
    if (!ENABLED) return [...mem.appeals].sort((a, b) => b.id - a.id);
    const d = await fsReq('GET', '/appeals?pageSize=100');
    return (d.documents || []).map(doc => fromFields(doc.fields)).sort((a, b) => b.id - a.id);
  },

  // ---- arena scoreboard: format x attacker -> pass / fail ----
  async arenaRecord(format, attacker, passed) {
    const key = format + '||' + attacker;
    if (!ENABLED) {
      const r = mem.arena.get(key) || { format, attacker, pass: 0, fail: 0, last: 0 };
      r[passed ? 'pass' : 'fail']++; r.last = Date.now();
      mem.arena.set(key, r);
      return;
    }
    const path = '/arena/' + encodeURIComponent(key);
    const d = await fsReq('GET', path);
    const r = d ? fromFields(d.fields) : { format, attacker, pass: 0, fail: 0, last: 0 };
    r[passed ? 'pass' : 'fail']++; r.last = Date.now();
    await fsReq('PATCH', path, { fields: toFields(r) });
  },
  async arenaTable() {
    if (!ENABLED) return [...mem.arena.values()];
    const d = await fsReq('GET', '/arena?pageSize=300');
    return (d.documents || []).map(doc => fromFields(doc.fields));
  },

  // ---- public counters (home page stats) ----
  async bump(name, by = 1) {
    if (!ENABLED) { mem.stats[name] = (mem.stats[name] || 0) + by; return; }
    const d = await fsReq('GET', '/counters/stats');
    const cur = d ? fromFields(d.fields) : {};
    cur[name] = (cur[name] || 0) + by;
    await fsReq('PATCH', '/counters/stats', { fields: toFields(cur) });
  },
  async stats() {
    if (!ENABLED) return { ...mem.stats };
    const d = await fsReq('GET', '/counters/stats');
    return d ? fromFields(d.fields) : {};
  },

  // ---- counters reset (in-memory mode only; early-access requests are kept) ----
  reset() {
    if (ENABLED) return false;
    mem.actors.clear(); mem.events.length = 0; mem.appeals.length = 0; mem.arena.clear();
    mem.stats = {}; mem.appealSeq = 1; mem.eventSeq = 1;
    return true;
  },
};

module.exports = store;
