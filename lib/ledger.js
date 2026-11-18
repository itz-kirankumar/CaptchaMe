'use strict';
// Fair-share ledger: a running record of what each actor has taken, capped in
// dollars, with a plain reason and an appeal when the cap bites.
// This is the step after detection that bot vendors leave to the customer.

const DEFAULTS = {
  anonymous: 0.50, // free taste, then prove presence
  human: 2.00,     // granted per verified presence pass
  agent: 1.00,     // per declared agent key
};
const COST_PER_CALL = 0.10;

const actors = new Map(); // id -> {id, kind, spent, granted, blocked, createdAt, note}
let appealSeq = 1;
const appeals = []; // {id, actorId, message, status, at}

function getActor(id) { return actors.get(id) || null; }

function ensureActor(id, kind) {
  let a = actors.get(id);
  if (!a) {
    a = { id, kind, spent: 0, granted: DEFAULTS[kind] ?? 0, blocked: 0, createdAt: Date.now(), note: '' };
    actors.set(id, a);
  }
  return a;
}

function grant(id, dollars, note) {
  const a = actors.get(id);
  if (a) { a.granted = +(a.granted + dollars).toFixed(4); if (note) a.note = note; }
}

function remaining(a) { return +(a.granted - a.spent).toFixed(4); }

// Try to spend. Returns {ok} or {ok:false, status, body}
function spend(id, cost = COST_PER_CALL) {
  const a = actors.get(id);
  if (!a) return { ok: false, status: 403, body: { error: 'unknown_actor', reason: 'This caller has no allowance yet. Prove presence or declare as an agent first.' } };
  if (remaining(a) < cost) {
    a.blocked++;
    return {
      ok: false,
      status: 429,
      body: {
        error: 'budget_exceeded',
        reason: `This actor has used its fair share: $${a.spent.toFixed(2)} of $${a.granted.toFixed(2)}. ` +
          'The cap keeps one actor from burning the pool everyone shares.',
        actor: { id: a.id, kind: a.kind, spent: +a.spent.toFixed(2), granted: a.granted },
        appeal_url: '/appeal.html?actor=' + encodeURIComponent(a.id),
      },
    };
  }
  a.spent = +(a.spent + cost).toFixed(4);
  return { ok: true, remaining: remaining(a) };
}

function fileAppeal(actorId, message) {
  const ap = { id: appealSeq++, actorId, message: String(message || '').slice(0, 1000), status: 'open', at: Date.now() };
  appeals.push(ap);
  return ap;
}

function resolveAppeal(id, action) {
  const ap = appeals.find(x => x.id === id);
  if (!ap || ap.status !== 'open') return null;
  ap.status = action === 'approve' ? 'approved' : 'denied';
  if (ap.status === 'approved') grant(ap.actorId, 1.00, 'appeal approved: +$1.00');
  return ap;
}

function table() {
  return [...actors.values()].map(a => ({
    id: a.id, kind: a.kind, spent: +a.spent.toFixed(2), granted: a.granted,
    remaining: remaining(a), blocked: a.blocked, note: a.note,
  }));
}

function summary() {
  const t = table();
  return {
    actors: t.length,
    totalSpent: +t.reduce((s, a) => s + a.spent, 0).toFixed(2),
    blockedCalls: t.reduce((s, a) => s + a.blocked, 0),
    estimatedSaved: +(t.reduce((s, a) => s + a.blocked, 0) * COST_PER_CALL).toFixed(2),
    openAppeals: appeals.filter(a => a.status === 'open').length,
  };
}

module.exports = { DEFAULTS, COST_PER_CALL, ensureActor, getActor, grant, spend, remaining, fileAppeal, resolveAppeal, table, summary, appeals };
