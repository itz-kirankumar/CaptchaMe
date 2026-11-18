'use strict';
// abuseguard client: the second layer behind CaptchaMe.
//
//   Layer 1  CaptchaMe   proves a live person (or a declared agent) is present and issues the pass.
//   Layer 2  abuseguard  decides how much that visitor may use, across everything linked to them.
//
// Off by default. Set ABUSEGUARD_URL, ABUSEGUARD_KEY and ABUSEGUARD_SALT to turn it on; with any of the
// three missing every function here is a no-op and CaptchaMe behaves exactly as before.
//
// Rules this module keeps:
//   * Server-side only. abuseguard trusts the signals its caller sends, so the browser never talks to it.
//   * Every identifier is hashed here with ABUSEGUARD_SALT before it leaves the process.
//   * Hard deadline, fail open. A slow or dead service never blocks a request (decision D3 in the guide).
//   * Shadow first. ABUSEGUARD_MODE defaults to "shadow" and the policy strictness to "watch": verdicts are
//     recorded and compared with CaptchaMe's own ledger, nothing is enforced until you say so.
// Port of sdk/node/index.js from abuseguard 0.4.0 (CommonJS, so it loads in server.js without a build step).
const crypto = require('crypto');

const env = process.env;
const BASE = String(env.ABUSEGUARD_URL || '').replace(/\/+$/, '');
const KEY = env.ABUSEGUARD_KEY || '';
const SALT = env.ABUSEGUARD_SALT || '';
const ENABLED = !!(BASE && KEY && SALT);
const MODE = env.ABUSEGUARD_MODE === 'enforce' ? 'enforce' : 'shadow';
const STRICTNESS = ['watch', 'gentle', 'strict'].includes(env.ABUSEGUARD_STRICTNESS) ? env.ABUSEGUARD_STRICTNESS : 'watch';
const TIMEOUT_MS = Number(env.ABUSEGUARD_TIMEOUT_MS) || 300; // a little over the SDK's 150 ms: CaptchaMe may be serverless
const WINDOW_S = Number(env.ABUSEGUARD_WINDOW_S) || 86400;    // decision D2: abuseguard resets each window, the ledger is lifetime
const SERVERLESS = !!env.VERCEL; // timers do not survive a frozen function, so send events inline there
const PASS_FRESH_S = 300;        // abuseguard ignores human/agent proofs older than this

// CaptchaMe's ledger plans, mapped onto abuseguard budgets by context.plan.
const PLAN_BUDGETS = { anonymous: 0.5, human: 2, agent: 1 };

const stats = {
  assessed: 0, failOpen: 0, wouldLimit: 0, enforcedLimit: 0, enforcedOther: 0, errors: 0,
  agree: 0, abuseguardStricter: 0, ledgerStricter: 0, tracked: 0, trackFailed: 0, appealsFiled: 0, appealsResolved: 0, webhooks: 0,
};
const lastDecision = new Map(); // actor -> decision_id (the appeal needs it; CaptchaMe's ledger does not keep it)
const appealLinks = new Map();  // CaptchaMe appeal id -> abuseguard appeal id
const sentLinks = new Set();    // actor|type|hash, so a link is reported once per process
function remember(map, k, v, max = 5000) { if (map.size >= max) map.delete(map.keys().next().value); map.set(k, v); }

const hash = raw => crypto.createHmac('sha256', SALT).update(String(raw)).digest('hex').slice(0, 32);
const subject = actor => ({ kind: 'session', id: hash(actor) });
const auth = { 'content-type': 'application/json', authorization: 'Bearer ' + KEY };

async function call(method, path, body, timeoutMs = TIMEOUT_MS) {
  const r = await fetch(BASE + path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { status: r.status, ok: r.ok, body: json };
}

// ---- policy: set once per process so the plans line up with CaptchaMe's ledger ----
let policyDone = null;
function ensurePolicy() {
  if (!ENABLED || env.ABUSEGUARD_AUTOPOLICY === '0') return Promise.resolve();
  if (!policyDone) {
    policyDone = call('PUT', '/v1/policy', {
      preset: 'ai_app', strictness: STRICTNESS, window_s: WINDOW_S, budget_usd: PLAN_BUDGETS.anonymous,
      budgets: Object.entries(PLAN_BUDGETS).map(([plan, budget_usd]) => ({ match: { plan }, budget_usd })),
      trap_paths: ['/trap', '/api/catalog/item/trap-'],
      endpoint_costs: [{ prefix: '/api/protected/quote', usd: 0.10 }],
    }, 5000).then(r => { if (!r.ok) policyDone = null; }).catch(() => { policyDone = null; });
  }
  return policyDone;
}

// Open: allow. Never a block (spec section 6).
function fallback(sub) {
  return { subject: sub, class: 'inconclusive', decision: 'allow', enforced: false, effective_decision: 'allow', reasons: ['ENGINE_UNAVAILABLE'], cost: { attributed_usd: 0, budget_usd: 0 }, action: null, recovery: null, unavailable: true };
}

// Build the signals CaptchaMe can honestly vouch for, with their real age.
// human.liveness  : a CaptchaMe pass was verified on this request.
// agent.credential: a signed agent was verified on this request (Web Bot Auth, or a declared Ed25519 key).
function signalsFor({ kind, via, passAgeS, wbaAgent }) {
  if (wbaAgent) {
    return [{ type: 'agent.credential', value: { scheme: 'web-bot-auth', agent_id: wbaAgent, verified: true, user_bound: true }, confidence: 0.95, freshness_s: 0, provenance: 'captchame' }];
  }
  if (kind === 'agent' && Number.isFinite(passAgeS) && passAgeS < PASS_FRESH_S) {
    return [{ type: 'agent.credential', value: { scheme: 'captchame-ed25519', agent_id: 'declared', verified: true, user_bound: via === 'delegated' }, confidence: 0.9, freshness_s: passAgeS, provenance: 'captchame' }];
  }
  if (kind === 'human' && Number.isFinite(passAgeS) && passAgeS < PASS_FRESH_S) {
    return [{ type: 'human.liveness', value: 'pass', confidence: 0.9, freshness_s: passAgeS, provenance: 'captchame' }];
  }
  return [];
}

// One decision. Returns a verdict or null when abuseguard is off. Never throws.
async function assess({ actor, plan, path, ua, signals, surface = 'api', endpointClass = 'expensive' }) {
  if (!ENABLED) return null;
  await ensurePolicy();
  stats.assessed++;
  let v;
  try {
    const r = await call('POST', '/v1/decisions', {
      subject: subject(actor), mode: MODE,
      context: { surface, endpoint_class: endpointClass, plan },
      request: { path: String(path || '/').slice(0, 2048), ua: String(ua || '').slice(0, 300) },
      signals: signals || [],
    });
    if (r.status >= 400 && r.status < 500) { stats.errors++; return { ...fallback(subject(actor)), reasons: ['INTEGRATION_ERROR'], error: r.body }; } // visible, still open
    if (!r.ok || !r.body) throw new Error('upstream ' + r.status);
    v = r.body;
  } catch {
    stats.failOpen++;
    return fallback(subject(actor));
  }
  if (v.decision_id) remember(lastDecision, actor, v.decision_id);
  if (v.decision === 'limit') stats.wouldLimit++;
  return v;
}

// Map an enforced, non-allow verdict to the HTTP answer CaptchaMe should give, or null to carry on.
function toHttp(v, actor) {
  if (!v || v.unavailable || v.error || !v.enforced || v.decision === 'allow') return null;
  const retry = v.action && v.action.retry_after_s ? Math.ceil(v.action.retry_after_s) : 0;
  const body = {
    error: v.decision === 'limit' ? 'budget_exceeded' : v.decision === 'slow' ? 'slow_down' : v.decision === 'step_up' ? 'step_up_required' : 'blocked',
    decision: v.decision, reason: reasonText(v), reasons: v.reasons, action: v.action, recovery: v.recovery, decision_id: v.decision_id,
    source: 'abuseguard',
    appeal_url: '/appeal?actor=' + encodeURIComponent(actor) + (v.decision_id ? '&decision=' + encodeURIComponent(v.decision_id) : ''),
  };
  if (v.decision === 'step_up') body.challenge_url = '/check';
  if (retry) body.retry_after_s = retry;
  if (v.cost && Number.isFinite(v.cost.budget_usd)) body.remaining_usd = +Math.max(0, v.cost.budget_usd - v.cost.attributed_usd).toFixed(4);
  stats[v.decision === 'limit' ? 'enforcedLimit' : 'enforcedOther']++;
  return { status: v.decision === 'slow' || v.decision === 'limit' ? 429 : 403, headers: retry ? { 'Retry-After': String(retry) } : {}, body };
}
function reasonText(v) {
  const r = (v.reasons || []).filter(x => x !== 'NO_EXTERNAL_SIGNALS');
  if (v.decision === 'limit') return 'This person has used their fair share across every account and key linked to them (' + (r.join(', ') || 'COST_OVER_BUDGET') + '). The cap resets with the window.';
  return 'abuseguard flagged this visitor (' + (r.join(', ') || v.decision) + ').';
}

// Compare abuseguard's view with the local ledger's, the week-1 shadow-mode measurement.
function compare(v, ledgerBlocked) {
  if (!ENABLED || !v || v.unavailable || v.error) return;
  const ag = v.decision === 'limit' || v.decision === 'block';
  if (ag === !!ledgerBlocked) stats.agree++;
  else if (ag) stats.abuseguardStricter++;
  else stats.ledgerStricter++;
}

// ---- events (best effort, batched; inline on serverless) ----
let queue = [], timer = null;
async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  const events = queue; queue = [];
  for (let i = 0; i < events.length; i += 1000) {
    try { const r = await call('POST', '/v1/events', { events: events.slice(i, i + 1000) }, 5000); if (!r.ok) stats.trackFailed += Math.min(1000, events.length - i); }
    catch { stats.trackFailed += Math.min(1000, events.length - i); }
  }
}
async function track(event) {
  if (!ENABLED) return;
  stats.tracked++;
  queue.push({ ts: new Date().toISOString(), ...event });
  if (SERVERLESS || queue.length >= 1000) return flush();
  if (!timer) { timer = setTimeout(flush, 2000); if (timer.unref) timer.unref(); }
}
// The cost of a served call, attributed to the person.
const usage = (actor, usd) => track({ type: 'usage', subject: subject(actor), usage: { requests: 1, direct_usd: usd, endpoint: '/api/protected/quote' } });
// What links this actor to others. The network prefix is always known; a device id only if the browser has one.
function link(actor, type, raw) {
  if (!ENABLED || !raw) return Promise.resolve();
  const k = actor + '|' + type + '|' + raw;
  if (sentLinks.has(k)) return Promise.resolve();
  if (sentLinks.size > 50000) sentLinks.clear();
  sentLinks.add(k);
  // Sent now, not batched: the very next decision for this actor must already know who it is linked to.
  return track({ type: 'link', subject: subject(actor), link: { link_type: type, value_hash: hash(raw) } }).then(flush);
}
const signup = actor => track({ type: 'signup', subject: subject(actor) });
const trapHit = (actor, path, ua) => track({ type: 'request', subject: subject(actor), request: { path, ua: String(ua || '').slice(0, 300), status: 200 } });

// ---- step-up result: a passed live check moves the next decision on ----
async function verify(actor, step, result) {
  if (!ENABLED) return false;
  try { return (await call('POST', '/v1/subjects/session/' + encodeURIComponent(subject(actor).id) + '/verifications', { step, result }, 5000)).ok; }
  catch { return false; }
}

// ---- appeals ----
async function fileAppeal(actor, localId, note, decisionId) {
  if (!ENABLED) return null;
  const id = decisionId || lastDecision.get(actor);
  if (!id) return null;
  try {
    const r = await call('POST', '/v1/decisions/' + encodeURIComponent(id) + '/appeal', { channel: 'api', note: String(note || '').slice(0, 2000) }, 5000);
    if (!r.ok || !r.body || r.body.id === undefined) return null;
    remember(appealLinks, localId, r.body.id); stats.appealsFiled++;
    return r.body.id;
  } catch { return null; }
}
async function resolveAppeal(localId, approved) {
  if (!ENABLED || !appealLinks.has(localId)) return false;
  try {
    const r = await call('PATCH', '/v1/appeals/' + encodeURIComponent(appealLinks.get(localId)), { outcome: approved ? 'overturned' : 'upheld' }, 5000);
    if (r.ok) { stats.appealsResolved++; appealLinks.delete(localId); }
    return r.ok;
  } catch { return false; }
}

// ---- signed webhooks: t=<unix>,v1=<hex hmac of "<t>.<raw body>"> ----
function verifyWebhook(rawBody, header, secret) {
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(String(header || ''));
  if (!m || !secret || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(m[1] + '.' + rawBody).digest();
  const given = Buffer.from(m[2], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const noteWebhook = () => { stats.webhooks++; };
const status = () => ({ enabled: ENABLED, mode: MODE, strictness: STRICTNESS, window_s: WINDOW_S, host: ENABLED ? new URL(BASE).host : null, webhook_secret_set: !!env.ABUSEGUARD_WEBHOOK_SECRET, stats: { ...stats } });

module.exports = { enabled: ENABLED, mode: MODE, hash, subject, signalsFor, assess, toHttp, compare, track, usage, link, signup, trapHit, verify, fileAppeal, resolveAppeal, verifyWebhook, noteWebhook, flush, ensurePolicy, status, PLAN_BUDGETS };
