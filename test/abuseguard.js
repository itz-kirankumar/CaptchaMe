'use strict';
// The abuseguard layer, tested against a stand-in for the abuseguard service so the suite needs nothing
// but Node. Covers: off by default, shadow mode never enforces, enforce mode returns the limit with a
// decision id, identifiers are hashed before they leave, appeals round-trip, fail open, signed webhooks.
// Run: node test/abuseguard.js     (see docs/ABUSEGUARD.md for running against the real service)
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; console.log('  PASS', name); } else { failed++; console.log('  FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- stand-in abuseguard: records every call, answers with whatever `mode` says ----
function stub() {
  const st = { calls: [], decision: 'allow', enforced: false, appealSeq: 0 };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { /* empty */ }
      st.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/v1/policy') return send(200, body);
      if (req.url === '/v1/events') return send(202, { accepted: (body.events || []).length });
      if (req.url === '/v1/decisions') {
        const limit = st.decision === 'limit';
        return send(200, { decision_id: 'dec_' + st.calls.length, subject: body.subject, class: 'legitimate_user', decision: st.decision, enforced: limit && st.enforced,
          reasons: limit ? ['DEVICE_CLUSTER', 'COST_OVER_BUDGET'] : ['NO_EXTERNAL_SIGNALS'], cost: { attributed_usd: limit ? 3 : 0, budget_usd: 0.5 },
          action: limit ? { type: 'limit', status: 429, retry_after_s: 86400 } : null, recovery: limit ? { appeal: true, paths: ['appeal'] } : null });
      }
      if (/\/appeal$/.test(req.url)) return send(200, { id: ++st.appealSeq, status: 'open' });
      if (/^\/v1\/appeals\//.test(req.url)) return send(200, { id: 1, status: 'resolved', outcome: body.outcome });
      if (/verifications$/.test(req.url)) return send(200, { ok: true });
      send(404, {});
    });
  });
  return { st, server };
}

function boot(port, extra) {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), POP_ADMIN_KEY: 'k', POP_RATE_PER_MIN: '5000', ...extra }, stdio: 'pipe' });
  return srv;
}
async function waitUp(base) { for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/stats'); return; } catch { await sleep(100); } } throw new Error('server did not start'); }
const get = (base, p, h = {}) => fetch(base + p, { headers: h }).then(async r => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) }));
const post = (base, p, b, h = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

(async () => {
  const { st, server } = stub();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const AG = 'http://127.0.0.1:' + server.address().port;
  const adminH = { 'x-admin-key': 'k' };

  // ---------------- off by default ----------------
  console.log('== off by default ==');
  let srv = boot(3991, {}); let base = 'http://localhost:3991'; await waitUp(base);
  const off = await get(base, '/api/admin/abuseguard', adminH);
  check('disabled without ABUSEGUARD_URL/KEY/SALT', off.body && off.body.enabled === false);
  const q0 = await get(base, '/api/protected/quote');
  check('quote works exactly as before', q0.status === 200 && q0.body.charged === 0.1);
  check('nothing was sent to abuseguard', st.calls.length === 0);
  srv.kill();

  // ---------------- shadow mode ----------------
  console.log('== shadow mode ==');
  st.decision = 'limit'; st.enforced = false;
  srv = boot(3992, { ABUSEGUARD_URL: AG, ABUSEGUARD_KEY: 'secretkey', ABUSEGUARD_SALT: 'salt1', ABUSEGUARD_WEBHOOK_SECRET: 'whsec' }); base = 'http://localhost:3992'; await waitUp(base);
  const sh = await get(base, '/api/protected/quote', { cookie: 'cm_vid=browserA' });
  check('shadow: a "limit" verdict is recorded but the call is served', sh.status === 200);
  const actor = decodeURIComponent((await fetch(base + '/api/protected/quote').then(r => r.headers.get('set-cookie') || '').then(c => (c.match(/pop_actor=([^;]+)/) || [])[1] || '')));
  const status = (await get(base, '/api/admin/abuseguard', adminH)).body;
  check('shadow: counted as would-limit, not enforced', status.stats.wouldLimit >= 1 && status.stats.enforcedLimit === 0, JSON.stringify(status.stats));
  check('shadow: mode and strictness reported', status.mode === 'shadow' && status.strictness === 'watch');
  const policy = st.calls.find(c => c.url === '/v1/policy');
  check('policy pushed once with the three CaptchaMe plans and the trap', policy && policy.body.budgets.length === 3 && policy.body.trap_paths.includes('/trap') && policy.body.strictness === 'watch', JSON.stringify(policy && policy.body));
  check('calls carry the tenant key', st.calls.every(c => c.auth === 'Bearer secretkey'));
  const dec = st.calls.find(c => c.url === '/v1/decisions');
  check('subject id is hashed, never the raw actor', dec && /^[0-9a-f]{32}$/.test(dec.body.subject.id) && !JSON.stringify(st.calls).includes('human:'), JSON.stringify(dec && dec.body.subject));
  check('plan and endpoint class are sent', dec && dec.body.context.plan === 'anonymous' && dec.body.context.endpoint_class === 'expensive');
  await sleep(2300); // the usage batch flushes after 2 s
  check('the paid call is reported as $0.10 usage', st.calls.some(c => c.url === '/v1/events' && c.body.events.some(e => e.type === 'usage' && e.usage.direct_usd === 0.1)));
  check('the shared browser is reported as a hashed device link', st.calls.some(c => c.url === '/v1/events' && c.body.events.some(e => e.type === 'link' && e.link.link_type === 'device' && /^[0-9a-f]{32}$/.test(e.link.value_hash))));
  check('the network is reported as an ip link', st.calls.some(c => c.url === '/v1/events' && c.body.events.some(e => e.type === 'link' && e.link.link_type === 'ip')));
  check('shadow: both layers still disagree-count (ledger allowed, abuseguard would limit)', status.stats.abuseguardStricter >= 1, JSON.stringify(status.stats));

  // trap hit is reported
  await get(base, '/trap');
  await sleep(2300);
  check('trap visit reported as a request event', st.calls.some(c => c.url === '/v1/events' && c.body.events.some(e => e.type === 'request' && e.request.path === '/trap')));

  // webhook
  const body = JSON.stringify({ id: 'evt_1', type: 'subject.flagged', created_at: new Date().toISOString(), data: { reasons: ['DEVICE_CLUSTER'] } });
  const sign = (b, t, sec) => `t=${t},v1=${crypto.createHmac('sha256', sec).update(t + '.' + b).digest('hex')}`;
  const t = Math.floor(Date.now() / 1000);
  const wh = (b, sig) => fetch(base + '/api/abuseguard-events', { method: 'POST', headers: { 'content-type': 'application/json', 'ag-signature': sig }, body: b }).then(r => r.status);
  check('signed webhook accepted', await wh(body, sign(body, t, 'whsec')) === 200);
  check('webhook with a wrong secret refused', await wh(body, sign(body, t, 'nope')) === 401);
  check('stale webhook refused (replay)', await wh(body, sign(body, t - 4000, 'whsec')) === 401);
  check('tampered webhook body refused', await wh(body.replace('DEVICE', 'XEVICE'), sign(body, t, 'whsec')) === 401);
  const feed = await get(base, '/api/admin/events?since=0', adminH);
  check('accepted webhook lands in the console event feed', feed.body.events.some(e => e.type === 'abuseguard' && /subject\.flagged/.test(e.message)));
  srv.kill();

  // ---------------- enforce mode ----------------
  console.log('== enforce mode ==');
  st.calls.length = 0; st.decision = 'limit'; st.enforced = true;
  srv = boot(3993, { ABUSEGUARD_URL: AG, ABUSEGUARD_KEY: 'secretkey', ABUSEGUARD_SALT: 'salt1', ABUSEGUARD_MODE: 'enforce', ABUSEGUARD_STRICTNESS: 'strict' }); base = 'http://localhost:3993'; await waitUp(base);
  const enRes = await fetch(base + '/api/protected/quote', { headers: { cookie: 'cm_vid=browserB' } });
  const en = { status: enRes.status, body: await enRes.json() };
  check('enforce: the limit becomes a 429 budget_exceeded', en.status === 429 && en.body.error === 'budget_exceeded' && en.body.source === 'abuseguard', JSON.stringify(en.body));
  check('enforce: plain reason, retry time, decision id and appeal link', /fair share/.test(en.body.reason) && en.body.retry_after_s === 86400 && /^dec_/.test(en.body.decision_id) && /appeal\?actor=/.test(en.body.appeal_url), JSON.stringify(en.body));
  check('enforce: Retry-After header set to the window reset', enRes.headers.get('retry-after') === '86400', String(enRes.headers.get('retry-after')));
  check('enforce: the model sent mode=enforce and strictness=strict', st.calls.find(c => c.url === '/v1/policy').body.strictness === 'strict' && st.calls.find(c => c.url === '/v1/decisions').body.mode === 'enforce');
  const who = decodeURIComponent((en.body.appeal_url.match(/actor=([^&]+)/) || [])[1] || '');
  const ap = await post(base, '/api/appeal', { actor: who, message: 'one real person', decision_id: en.body.decision_id });
  check('appeal filed locally', ap.status === 200 && ap.body.ok);
  check('appeal forwarded to abuseguard on the decision id', st.calls.some(c => /\/v1\/decisions\/dec_\d+\/appeal$/.test(c.url) && c.body.note === 'one real person'));
  const ok = await post(base, '/api/admin/appeal/' + ap.body.appeal_id, { action: 'approve' }, { 'x-admin-key': 'k' });
  check('approval grants the local +$1 as before', ok.status === 200 && ok.body.appeal.status === 'approved');
  check('approval is sent to abuseguard as "overturned"', st.calls.some(c => c.method === 'PATCH' && /\/v1\/appeals\/1$/.test(c.url) && c.body.outcome === 'overturned'));
  const nt = await post(base, '/api/admin/appeal/' + (ap.body.appeal_id + 99), { action: 'deny' }, { 'x-admin-key': 'k' });
  check('unknown appeal still 404s', nt.status === 404);

  // declared agent: verified credential signal with its real age
  st.calls.length = 0; st.decision = 'allow'; st.enforced = true;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const n = await post(base, '/api/agent/nonce', {});
  const d = await post(base, '/api/agent/declare', { pubkey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), signature: crypto.sign(null, Buffer.from(n.body.nonce), privateKey).toString('base64'), nonce: n.body.nonce, operator: 'test' });
  const aq = await get(base, '/api/protected/quote', { authorization: 'Bearer ' + d.body.agent_token });
  check('agent call served', aq.status === 200);
  const ad = st.calls.find(c => c.url === '/v1/decisions');
  check('agent sends a verified agent.credential signal with age < 300 s, plan agent', ad && ad.body.context.plan === 'agent' && ad.body.signals.some(s => s.type === 'agent.credential' && s.value.verified === true && s.freshness_s < 300), JSON.stringify(ad && ad.body));
  srv.kill();

  // ---------------- fail open ----------------
  console.log('== fail open ==');
  await new Promise(r => server.close(r)); server.closeAllConnections && server.closeAllConnections();
  srv = boot(3994, { ABUSEGUARD_URL: AG, ABUSEGUARD_KEY: 'secretkey', ABUSEGUARD_SALT: 'salt1', ABUSEGUARD_MODE: 'enforce' }); base = 'http://localhost:3994'; await waitUp(base);
  const t0 = Date.now();
  const fo = await get(base, '/api/protected/quote');
  check('abuseguard unreachable: the call is still served', fo.status === 200);
  check('abuseguard unreachable: answered well inside the deadline', Date.now() - t0 < 2500, (Date.now() - t0) + ' ms');
  const fs = (await get(base, '/api/admin/abuseguard', adminH)).body.stats;
  check('every fail-open is counted', fs.failOpen >= 1, JSON.stringify(fs));
  const ck = { cookie: 'pop_actor=' + encodeURIComponent('human:backstop1') };
  let last; for (let i = 0; i < 7; i++) last = await get(base, '/api/protected/quote', ck);
  check('local ledger is still the backstop when abuseguard is down (anonymous cap bites)', last.status === 429 && last.body.error === 'budget_exceeded' && last.body.source !== 'abuseguard', JSON.stringify(last.body));
  srv.kill();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
