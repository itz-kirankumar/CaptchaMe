'use strict';
// Fair-share ledger: a running record of what each actor has taken, capped in
// dollars, with a plain reason and an appeal when the cap bites.
// Backed by lib/store (Firestore when configured, in-memory otherwise).
const store = require('./store');

const DEFAULTS = {
  anonymous: 0.50, // free taste, then prove presence
  human: 2.00,     // granted per verified presence pass
  agent: 1.00,     // unverified agent keys: one shared pool per network
  verified: 5.00,  // per operator verified with Web Bot Auth signatures
};
const COST_PER_CALL = 0.10;

async function getActor(id) { return store.getActor(id); }

async function ensureActor(id, kind) {
  let a = await store.getActor(id);
  if (!a) {
    a = { id, kind, spent: 0, granted: DEFAULTS[kind] ?? 0, blocked: 0, createdAt: Date.now(), note: '' };
    await store.putActor(id, a);
  }
  return a;
}

async function grant(id, dollars, note) {
  const a = await store.getActor(id);
  if (a) { a.granted = +(a.granted + dollars).toFixed(4); if (note) a.note = note; await store.putActor(id, a); }
}

function remaining(a) { return +(a.granted - a.spent).toFixed(4); }

// Try to spend. Returns {ok} or {ok:false, status, body}
async function spend(id, cost = COST_PER_CALL) {
  const a = await store.getActor(id);
  if (!a) return { ok: false, status: 403, body: { error: 'unknown_actor', reason: 'This caller has no allowance yet. Prove presence or declare as an agent first.' } };
  if (remaining(a) < cost) {
    a.blocked++;
    await store.putActor(id, a);
    return {
      ok: false,
      status: 429,
      body: {
        error: 'budget_exceeded',
        reason: `This actor has used its fair share: $${a.spent.toFixed(2)} of $${a.granted.toFixed(2)}. ` +
          'The cap keeps one actor from burning the pool everyone shares.',
        actor: { id: a.id, kind: a.kind, spent: +a.spent.toFixed(2), granted: a.granted },
        appeal_url: '/appeal?actor=' + encodeURIComponent(a.id),
      },
    };
  }
  a.spent = +(a.spent + cost).toFixed(4);
  await store.putActor(id, a);
  return { ok: true, remaining: remaining(a) };
}

async function fileAppeal(actorId, message) {
  const id = await store.nextAppealId();
  const ap = { id, actorId, message: String(message || '').slice(0, 1000), status: 'open', at: Date.now() };
  await store.addAppeal(ap);
  return ap;
}

async function resolveAppeal(id, action) {
  const ap = await store.getAppeal(id);
  if (!ap || ap.status !== 'open') return null;
  ap.status = action === 'approve' ? 'approved' : 'denied';
  await store.putAppeal(id, ap);
  if (ap.status === 'approved') await grant(ap.actorId, 1.00, 'appeal approved: +$1.00');
  return ap;
}

async function listAppeals() { return store.listAppeals(); }

async function table() {
  const rows = await store.listActors();
  return rows.map(a => ({
    id: a.id, kind: a.kind, spent: +a.spent.toFixed(2), granted: a.granted,
    remaining: remaining(a), blocked: a.blocked, note: a.note,
  }));
}

async function summary() {
  const t = await table();
  const aps = await store.listAppeals();
  return {
    actors: t.length,
    totalSpent: +t.reduce((s, a) => s + a.spent, 0).toFixed(2),
    blockedCalls: t.reduce((s, a) => s + a.blocked, 0),
    estimatedSaved: +(t.reduce((s, a) => s + a.blocked, 0) * COST_PER_CALL).toFixed(2),
    openAppeals: aps.filter(a => a.status === 'open').length,
  };
}

module.exports = { DEFAULTS, COST_PER_CALL, ensureActor, getActor, grant, spend, remaining, fileAppeal, resolveAppeal, listAppeals, table, summary };
