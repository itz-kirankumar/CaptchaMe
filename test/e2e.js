'use strict';
// End-to-end: boots the server, walks every lane as a synthetic human and as
// each attack, checks the ledger, cap and appeal flow.
// Run: node test/e2e.js
const { spawn } = require('child_process');
const crypto = require('crypto');
const actors = require('../demo/actors');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name, extra); }
}
async function post(path, body, headers = {}) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
}
async function get(path, headers = {}) {
  const r = await fetch(BASE + path, { headers });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function wallClockWait(type, P) {
  if (type === 'ring' || type === 'pulse') return 0.75 * P.durationMs;
  if (type === 'reflex') return 0.75 * P.totalMs;
  if (type === 'beat') return 0.75 * (P.beats[P.beats.length - 1] + 800);
  if (type === 'voice') return 3100;
  if (type === 'clash') return 0.75 * P.totalMs;
  if (type === 'targets') return 2100;
  return 0;
}
async function runChallenge(type, payloadFn, wait = true) {
  const start = await post('/api/challenge/start', { type });
  if (start.status !== 200) return { error: 'start failed ' + start.status };
  const payload = payloadFn(start.body.params);
  if (wait) await sleep(wallClockWait(type, start.body.params));
  const sub = await post('/api/challenge/submit', { session: start.body.session, ...payload });
  return { start: start.body, sub: sub.body, subStatus: sub.status };
}

(async () => {
  const srv = spawn(process.execPath, [require('path').join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), POP_RATE_PER_MIN: '2000' }, stdio: 'pipe' });
  await new Promise(res => srv.stdout.once('data', res));

  console.log('\n== humans should pass ==');
  for (const [type, fn] of [
    ['ring', P => ({ samples: actors.humanRing(P, 11) })],
    ['ring', P => ({ samples: actors.humanRing(P, 77) })],
    ['beat', P => ({ taps: actors.humanBeat(P.beats, 12) })],
    ['beat', P => ({ taps: actors.humanBeat(P.beats, 99) })],
    ['voice', P => actors.humanVoice(P.words, 13)],
    ['voice', P => actors.humanVoice(P.words, 55)],
    ['reflex', P => ({ clicks: actors.humanReflex(P.rounds, 21) })],
    ['reflex', P => ({ clicks: actors.humanReflex(P.rounds, 87) })],
    ['pulse', P => actors.humanPulse(P, 31)],
    ['pulse', P => actors.humanPulse(P, 77)],
  ]) {
    const r = await runChallenge(type, fn);
    check(`human ${type} passes`, r.sub && r.sub.result === 'pass', JSON.stringify(r.sub));
  }

  console.log('\n== bots should fail ==');
  {
    const r = await runChallenge('ring', P => ({ samples: actors.scriptRing(P) }));
    check('script ring bot fails', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.detail));
    check('script ring bot flagged', r.sub && r.sub.flags.length > 0, JSON.stringify(r.sub && r.sub.flags));
  }
  {
    const r = await runChallenge('ring', P => ({ samples: actors.agentRing(P) }));
    check('look-think-act agent ring fails', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.detail));
  }
  {
    const r = await runChallenge('beat', P => ({ taps: actors.scriptBeat(P.beats) }));
    check('machine-perfect beat fails', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.detail));
  }
  {
    const r = await runChallenge('voice', P => actors.botVoice(P.words));
    check('uniform voice playback fails', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.detail));
  }
  {
    const r = await runChallenge('reflex', P => ({ clicks: actors.scriptReflex(P.rounds) }));
    check('identical-timing reflex script fails', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.detail));
    check('reflex script flagged as timer', r.sub && r.sub.flags.some(f => /identical reaction/.test(f)), JSON.stringify(r.sub && r.sub.flags));
  }
  {
    const r = await runChallenge('reflex', P => ({ clicks: actors.agentReflex(P.rounds) }));
    check('slow agent reflex fails', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.detail));
  }
  {
    const r = await runChallenge('ring', P => ({ samples: actors.scriptRing(P) }));
    check('script ring flagged on dart tracking', r.sub && r.sub.flags.some(f => /zero reaction time/.test(f)), JSON.stringify(r.sub && r.sub.flags));
  }
  {
    const t = await get('/trap');
    check('trap endpoint responds', t.status === 200);
    const dash = await get('/api/admin/events', { 'x-admin-key': 'demo-admin' });
    check('trap visit logged on dashboard', JSON.stringify(dash.body).includes('trap'));
  }
  {
    // strongest free attacker: reads the params, fakes human jitter, submits instantly
    const r = await runChallenge('ring', P => ({ samples: actors.adaptiveRing(P, 5) }), false);
    check('adaptive jitter script fails', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.detail));
    check('adaptive script caught by wall clock', r.sub && r.sub.flags.some(f => /computed, not performed/.test(f)), JSON.stringify(r.sub && r.sub.flags));
  }
  {
    const r = await runChallenge('reflex', P => ({ clicks: actors.adaptiveReflex(P.rounds, 5) }), false);
    check('adaptive reflex script fails on wall clock', r.sub && r.sub.flags.some(f => /computed, not performed/.test(f)), JSON.stringify(r.sub && r.sub.flags));
  }
  {
    // webdriver probe
    const start = await post('/api/challenge/start', { type: 'beat' });
    const taps = actors.humanBeat(start.body.params.beats, 5);
    await sleep(wallClockWait('beat', start.body.params));
    const r = await post('/api/challenge/submit', { session: start.body.session, taps, env: { webdriver: true } });
    check('webdriver env fails', r.body && r.body.result === 'fail');
    check('webdriver flagged', r.body && r.body.flags.some(f => /automation control/.test(f)), JSON.stringify(r.body && r.body.flags));
  }
  {
    const r = await runChallenge('pulse', P => actors.agentPulse(P), false);
    check('step agent fails dual-task', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.flags));
  }
  {
    // the honest hard case: waits the full time, human-shaped samples.
    // DOCUMENTED residual gap: a dedicated simulator passes the challenge;
    // wall clock forces real time per attempt and the ledger caps the prize.
    const r = await runChallenge('pulse', P => actors.playbackPulse(P), true);
    console.log('  INFO wait-and-playback pulse result:', r.sub && r.sub.result, 'score', r.sub && r.sub.score, JSON.stringify(r.sub && r.sub.flags));
  }
  {
    // TTS pipeline with jitter: DOCUMENTED residual gap - it passes the voice
    // challenge itself; the ledger cap is the designed backstop
    const r = await runChallenge('voice', P => actors.ttsJitterVoice(P.words, 7), true);
    console.log('  INFO tts+jitter voice result:', r.sub && r.sub.result, 'score', r.sub && r.sub.score);
  }
  {
    // replay: answer a session, then answer it again
    const start = await post('/api/challenge/start', { type: 'beat' });
    const taps = actors.humanBeat(start.body.params.beats, 5);
    const first = await post('/api/challenge/submit', { session: start.body.session, taps });
    const replay = await post('/api/challenge/submit', { session: start.body.session, taps });
    check('first answer accepted', first.status === 200);
    check('replay rejected', replay.status === 409, 'got ' + replay.status);
  }
  {
    // forged token rejected
    const r = await get('/api/protected/quote', { Authorization: 'Bearer aaa.bbb' });
    check('forged bearer rejected', r.status === 401, 'got ' + r.status);
  }


  {
    // voice without speech recognition (Firefox etc): timing alone, capped
    const hv = actors.humanVoice(['a','b','c','d'], 21);
    const r = await runChallenge('voice', P => ({ wordTimings: hv.wordTimings.map((w,i)=>({...w, word: P.words[i], promptStartMs: w.promptStartMs})), transcript: '' }));
    check('human voice without ASR still passes on timing', r.sub && r.sub.result === 'pass', JSON.stringify(r.sub));
  }
  {
    const bv = actors.botVoice(['a','b','c','d']);
    const r = await runChallenge('voice', P => ({ wordTimings: bv.wordTimings.map((w,i)=>({...w, word: P.words[i]})), transcript: '' }));
    check('uniform playback without ASR still fails', r.sub && r.sub.result === 'fail', JSON.stringify(r.sub && r.sub.detail));
  }

  {
    // token relay: a pass earned in one browser, presented from another
    const r = await runChallenge('beat', P => ({ taps: actors.humanBeat(P.beats, 31) }));
    const tok = r.sub && r.sub.pass_token;
    const relayed = await post('/api/pass/verify', { pass: tok, user_agent: 'Mozilla/5.0 (solver-farm worker)', accept_language: 'ru-RU', remoteip: '198.51.100.7' });
    check('relayed pass (different browser) refused', relayed.body && relayed.body.ok === false && /different browser/.test(relayed.body.reason), JSON.stringify(relayed.body));
    const plain = await post('/api/pass/verify', { pass: tok });
    check('pass verifies when no browser details are sent', plain.body && plain.body.ok === true && plain.body.browser_bound === true && plain.body.browser_checked === false, JSON.stringify(plain.body));
  }

  console.log('\n== agent lane ==');
  let agentToken, agentActor;
  {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const n = await post('/api/agent/nonce', {});
    check('nonce issued', n.status === 200 && n.body.nonce);
    const sig = crypto.sign(null, Buffer.from(n.body.nonce, 'utf8'), privateKey).toString('base64');
    const d = await post('/api/agent/declare', { pubkey: pub, signature: sig, nonce: n.body.nonce, operator: 'e2e test agent' });
    check('agent declared', d.status === 200 && d.body.result === 'declared', JSON.stringify(d.body));
    agentToken = d.body.agent_token; agentActor = d.body.actor;
    const badN = await post('/api/agent/nonce', {});
    const bad = await post('/api/agent/declare', { pubkey: pub, signature: sig, nonce: badN.body.nonce, operator: 'reused sig' });
    check('replayed signature rejected', bad.status === 403, 'got ' + bad.status);
  }

  console.log('\n== fair-share ledger ==');
  {
    // anonymous actor: $0.50 free, then the cap
    const jar = [];
    let blocked = null;
    for (let i = 0; i < 8; i++) {
      const headers = jar.length ? { Cookie: jar.join('; ') } : {};
      const r = await fetch(BASE + '/api/protected/quote', { headers });
      const sc = r.headers.get('set-cookie'); if (sc) jar.push(sc.split(';')[0]);
      const b = await r.json();
      if (r.status === 429) { blocked = b; break; }
    }
    check('anonymous actor capped after free taste', !!blocked && blocked.error === 'budget_exceeded');
    check('block carries plain reason', !!blocked && /fair share/.test(blocked.reason), blocked && blocked.reason);
    check('block carries appeal url', !!blocked && /appeal/.test(blocked.appeal_url || ''));
    const ap = await post('/api/appeal', { actor: blocked.actor.id, message: 'e2e test appeal' });
    check('appeal filed', ap.status === 200 && ap.body.ok);
    const adm = await post('/api/admin/appeal/' + ap.body.appeal_id, { action: 'approve' }, { 'X-Admin-Key': 'demo-admin' });
    check('appeal approved by human', adm.status === 200 && adm.body.appeal.status === 'approved');
    const again = await fetch(BASE + '/api/protected/quote', { headers: { Cookie: jar.join('; ') } });
    check('actor served again after appeal', again.status === 200, 'got ' + again.status);
  }
  {
    // agent burns its own budget to the cap
    let blockedAt = -1;
    for (let i = 0; i < 15; i++) {
      const r = await get('/api/protected/quote', { Authorization: 'Bearer ' + agentToken });
      if (r.status === 429) { blockedAt = i; break; }
    }
    check('agent capped at its own budget', blockedAt === 10, 'blockedAt=' + blockedAt);
  }
  {
    const s = await get('/api/admin/actors', { 'X-Admin-Key': 'demo-admin' });
    check('admin ledger readable', s.status === 200 && s.body.actors.length > 0);
    check('savings counted', s.body.summary.estimatedSaved > 0, JSON.stringify(s.body.summary));
    const denied = await get('/api/admin/actors', { 'X-Admin-Key': 'wrong' });
    check('admin key enforced', denied.status === 403);
  }

  console.log('\n== new formats: clash and targets ==');
  {
    const humans = await Promise.all([41, 97].map(seed => runChallenge('clash', P => ({ responses: actors.humanClash(P, seed) }))));
    humans.forEach((r, k) => check('human clash passes #' + (k + 1), r.sub && r.sub.result === 'pass', JSON.stringify(r.sub)));
    const t = await Promise.all([51, 63].map(seed => runChallenge('targets', P => actors.humanTargets(P, seed))));
    t.forEach((r, k) => check('human targets passes #' + (k + 1), r.sub && r.sub.result === 'pass', JSON.stringify(r.sub)));
    const touch = await runChallenge('targets', P => ({ ...actors.humanTargets(P, 71), samples: [], pointerType: 'touch' }));
    check('human targets on touch passes', touch.sub && touch.sub.result === 'pass', JSON.stringify(touch.sub));
  }
  {
    const sc = await runChallenge('clash', P => ({ responses: actors.scriptClash(P) }), false);
    check('clash timer script fails', sc.sub && sc.sub.result === 'fail');
    check('clash timer flagged', sc.sub && sc.sub.flags.some(f => /identical answer time/.test(f)), JSON.stringify(sc.sub && sc.sub.flags));
    const rd = await runChallenge('clash', P => ({ responses: actors.readerClash(P) }), false);
    check('page-text reader picks the word and fails', rd.sub && rd.sub.flags.some(f => /picked the WORD/.test(f)), JSON.stringify(rd.sub && rd.sub.flags));
    const ag = await runChallenge('clash', P => ({ responses: actors.agentClash(P) }), false);
    check('look-think-act agent misses clash window', ag.sub && ag.sub.result === 'fail' && ag.sub.flags.some(f => /missed/.test(f)), JSON.stringify(ag.sub && ag.sub.flags));
    const ad = await runChallenge('clash', P => ({ responses: actors.adaptiveClash(P) }), true);
    console.log('  INFO adaptive clash (knows answers, random delays) result:', ad.sub && ad.sub.result, 'score', ad.sub && ad.sub.score);
  }
  {
    const s = await runChallenge('targets', P => actors.scriptTargets(P));
    check('targets script fails', s.sub && s.sub.result === 'fail');
    check('targets script flagged teleport', s.sub && s.sub.flags.some(f => /without travelling/.test(f)), JSON.stringify(s.sub && s.sub.flags));
    const st = await runChallenge('targets', P => ({ ...actors.scriptTargets(P), pointerType: 'touch' }));
    check('targets script posing as touch caught on dead-centre clicks', st.sub && st.sub.flags.some(f => /exact centre/.test(f)), JSON.stringify(st.sub && st.sub.flags));
    const ag = await runChallenge('targets', P => actors.agentTargets(P));
    check('targets agent fails', ag.sub && ag.sub.result === 'fail');
    const ad = await runChallenge('targets', P => actors.adaptiveTargets(P));
    check('targets adaptive (straight constant-speed path) fails', ad.sub && ad.sub.result === 'fail' && ad.sub.flags.some(f => /constant speed/.test(f)), JSON.stringify(ad.sub && ad.sub.flags));
  }
  {
    const seen = new Set();
    for (let i = 0; i < 12; i++) { const a = await post('/api/challenge/start', { type: 'auto' }); if (a.status === 200 && a.body.auto) seen.add(a.body.type); }
    check('auto mode picks the format server-side', seen.size >= 2 && [...seen].every(t => ['ring', 'pulse', 'reflex', 'clash', 'targets'].includes(t)), [...seen].join(','));
  }

  console.log('\n== arena: classic captchas ==');
  {
    for (const type of ['text', 'grid', 'math', 'slider', 'checkbox', 'rotate', 'click', 'pow']) {
      const s = await post('/api/arena/start', { type });
      check('classic ' + type + ' starts', s.status === 200 && s.body.session && (['checkbox', 'pow'].includes(type) || /^data:image\/svg/.test(s.body.params.image)));
      check('classic ' + type + ' answer not leaked to client', !JSON.stringify(s.body).includes('"answer"') && !/"need"|"pts"/.test(Buffer.from(s.body.session.split('.')[0], 'base64url').toString()));
    }
    {
      // proof of work: a plain script computes it, no human involved
      const s = await post('/api/arena/start', { type: 'pow' });
      let nonce = 0;
      for (;; nonce++) { const h = crypto.createHash('sha256').update(s.body.params.salt + ':' + nonce).digest(); let z = 0; for (const b of h) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; } if (z >= s.body.params.bits) break; }
      const v = await post('/api/arena/verify', { session: s.body.session, answer: nonce });
      check('proof-of-work passes for a plain script (it proves compute, not a person)', v.body && v.body.ok === true, JSON.stringify(v.body));
      const rot = await post('/api/arena/start', { type: 'rotate' });
      const wrongRot = await post('/api/arena/verify', { session: rot.body.session, answer: 0 });
      check('rotate left tilted fails', wrongRot.body && wrongRot.body.ok === false);
    }
    const s = await post('/api/arena/start', { type: 'text' });
    const wrong = await post('/api/arena/verify', { session: s.body.session, answer: 'ZZZZZ' }, { 'X-CM-Attacker': 'e2e-solver' });
    check('classic wrong answer fails', wrong.body && wrong.body.ok === false);
    const again = await post('/api/arena/verify', { session: s.body.session, answer: 'ZZZZZ' });
    check('classic replay rejected', again.status === 409);
    const cb = await post('/api/arena/start', { type: 'checkbox' });
    await sleep(700);
    const tick = await post('/api/arena/verify', { session: cb.body.session, answer: 'checked', extra: { moves: 5 } }, { 'X-CM-Attacker': 'e2e-solver' });
    check('bare checkbox passes a script that fakes 5 mouse moves (the point of the arena)', tick.body && tick.body.ok === true, JSON.stringify(tick.body));
    const res = await get('/api/arena/results');
    check('arena scoreboard records attacker labels', res.body.results.some(r => r.attacker === 'e2e-solver' && r.format === 'classic:checkbox' && r.pass >= 1), JSON.stringify(res.body.results.slice(0, 5)));
    const cfg = await get('/api/arena/config');
    check('third-party widgets fall back to test keys', cfg.body.turnstile.test === true && cfg.body.hcaptcha.siteKey && cfg.body.recaptcha.siteKey);
  }

  console.log('\n== scraper shield ==');
  {
    let last = null;
    for (let p = 1; p <= 12; p++) {
      const r = await fetch(BASE + '/api/catalog?page=' + p, { headers: { 'User-Agent': 'python-requests/2.32.3' } });
      last = { status: r.status, decision: r.headers.get('x-captchame-shield') };
    }
    check('python scraper walking pages ends blocked or decoyed', last && (last.decision === 'block' || last.decision === 'decoy'), JSON.stringify(last));
    const browser = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0 Safari/537.36', 'Accept-Language': 'en-IN,en;q=0.9', Cookie: 'cm_js=1; cm_vid=e2ebrowser01' };
    const a = await fetch(BASE + '/api/catalog?page=3', { headers: browser });
    await sleep(300);
    const b = await fetch(BASE + '/api/catalog?page=7', { headers: browser });
    check('a person browsing is allowed', a.headers.get('x-captchame-shield') === 'allow' && b.headers.get('x-captchame-shield') === 'allow', a.headers.get('x-captchame-shield') + '/' + b.headers.get('x-captchame-shield'));
    const trap = await fetch(BASE + '/api/catalog/item/trap-collectors', { headers: { ...browser, Cookie: 'cm_js=1; cm_vid=e2etrapper02' } });
    check('trap item blocks the visitor', trap.status === 429, 'got ' + trap.status);
    const chk = await post('/api/shield/check', { ip: '203.0.113.9', ua: 'Scrapy/2.11', acceptLanguage: '', js: false, page: 1 });
    check('shield check API returns a decision with reasons', chk.status === 200 && chk.body.decision && chk.body.reasons.length > 0, JSON.stringify(chk.body));
    const st = await get('/api/admin/shield', { 'X-Admin-Key': 'demo-admin' });
    check('shield state readable by admin', st.status === 200 && st.body.actors.length > 0);
  }

  console.log('\n== stats and reset ==');
  {
    const s = await get('/api/stats');
    check('public stats count checks and catches', s.body.checks > 0 && s.body.botsCaught > 0 && s.body.humans > 0, JSON.stringify(s.body));
    const r = await post('/api/admin/reset', {}, { 'X-Admin-Key': 'demo-admin' });
    check('demo reset clears data', r.status === 200 && r.body.ok);
    const s2 = await get('/api/stats');
    check('stats empty after reset', s2.body.checks === 0, JSON.stringify(s2.body));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  srv.kill();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
