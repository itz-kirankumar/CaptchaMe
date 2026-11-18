(function () {
  'use strict';
  const listEl = document.getElementById('runlist');
  if (!listEl || !window.CMActors) return;
  const A = window.CMActors;
  const KEY = new URLSearchParams(location.search).get('key') || 'demo-admin';
  const HDR = { 'Content-Type': 'application/json', 'X-CM-Attacker': 'dry run' };
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let NONCE = null;
  const getNonce = async () => { if (!NONCE) { try { const d = await (await fetch('/api/page/nonce', { cache: 'no-store' })).json(); NONCE = d.nonce || null; } catch { NONCE = null; } } return NONCE; };
  const post = async (url, body, extra) => { if (url === '/api/challenge/start') { const n = await getNonce(); if (n) body = { ...body, page_nonce: n }; } const r = await fetch(url, { method: 'POST', headers: { ...HDR, ...(extra || {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const waitFor = (type, P) => ({ ring: 0.75 * (P.durationMs || 0), pulse: 0.75 * (P.durationMs || 0), reflex: 0.75 * (P.totalMs || 0), beat: 0.75 * ((P.beats || [0]).slice(-1)[0] + 800), clash: 0.75 * (P.totalMs || 0), targets: 2100 }[type] || 0);
  const shared = {};

  // Ring jumps and pulse flashes arrive live; poll for them while the check runs.
  async function collectCues(s) {
    const P = s.body.params, want = P.dartCount || P.flashCount || 0, got = new Map(), t0 = performance.now();
    while (got.size < want && performance.now() - t0 < P.durationMs + 2000) {
      const c = await post('/api/challenge/cue', { session: s.body.session });
      for (const cue of (c.body && c.body.cues) || []) if (!got.has(cue.i)) got.set(cue.i, { ...cue, appliedAt: Math.round(performance.now() - t0) });
      await sleep(140);
    }
    const cues = [...got.values()].sort((a, b) => a.i - b.i);
    const live = { ...P };
    if (P.dartCount) live.darts = cues.map(c => ({ at: c.appliedAt, px: c.px, py: c.py }));
    if (P.flashCount) live.flashes = cues.map(c => c.appliedAt);
    return { cues, live };
  }
  // One live challenge: start, build the payload from the actor, wait the real time, submit.
  async function challenge(type, payload, wait = true, useCues = true) {
    const s = await post('/api/challenge/start', { type });
    if (s.status !== 200) return { ok: false, got: 'could not start: ' + (s.body.reason || s.status) };
    const t0 = performance.now();
    let P = s.body.params, cues;
    if (P.cues && wait && useCues) { const c = await collectCues(s); P = c.live; cues = c.cues; }
    else if (P.cues) P = { ...P, darts: P.dartCount ? [] : undefined, flashes: P.flashCount ? [] : undefined };
    const body = payload(P);
    if (wait) await sleep(Math.max(0, waitFor(type, s.body.params) - (performance.now() - t0)));
    const r = await post('/api/challenge/submit', { session: s.body.session, ...body, ...(cues ? { cues } : {}) });
    return r.body;
  }
  function typing(n) { const k = []; for (let i = 0; i < n; i++) k.push({ d: Math.round(70 + Math.random() * 90), f: i ? Math.round(60 + Math.random() * 260) : null }); return k; }
  function approach() { const p = []; for (let k = 0; k <= 30; k++) { const u = k / 30, m = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5; p.push({ t: 9000 + k * 16, x: Math.round(100 + 400 * m), y: Math.round(500 - 200 * m + Math.sin(u * 3) * 8) }); } return p; }
  async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  const expectPass = (type, payload) => async () => {
    const b = await challenge(type, payload);
    if (b.pass_token) shared.pass = b.pass_token;
    return { ok: b.result === 'pass', got: (b.result || 'error').toUpperCase() + ' · score ' + b.score + (b.result !== 'pass' && b.flags ? ' · ' + b.flags[0] : '') };
  };
  const expectFail = (type, payload, wait) => async () => {
    const b = await challenge(type, payload, wait);
    return { ok: b.result === 'fail', got: (b.result || 'error').toUpperCase() + ' · score ' + b.score + ' · ' + ((b.flags && b.flags[0]) || b.reason || '') };
  };

  const STEPS = [
    { g: 0, name: 'Server is up', exp: 'stats respond', run: async () => { const r = await fetch('/api/stats', { cache: 'no-store' }); return { ok: r.ok, got: 'HTTP ' + r.status }; } },
    { g: 1, name: 'Human follows the ring', exp: 'HUMAN', run: expectPass('ring', P => ({ samples: A.humanRing(P, Math.random() * 1e9 | 0) })) },
    { g: 1, name: 'Script replays the published ring path', exp: 'BOT: zero lag, no corrections', run: expectFail('ring', P => ({ samples: A.scriptRing(P) })) },
    { g: 1, name: 'Look-think-act agent on the ring', exp: 'BOT: seconds to re-aim', run: expectFail('ring', P => ({ samples: A.agentRing(P) })) },
    { g: 1, name: 'Human on colour clash', exp: 'HUMAN', run: expectPass('clash', P => ({ responses: A.humanClash(P, Math.random() * 1e9 | 0) })) },
    { g: 1, name: 'Page-text reader on colour clash', exp: 'BOT: picks the word, not the ink', run: expectFail('clash', P => ({ responses: A.readerClash(P) })) },
    { g: 1, name: 'Human on targets', exp: 'HUMAN', run: expectPass('targets', P => A.humanTargets(P, Math.random() * 1e9 | 0)) },
    { g: 1, name: 'Script clicks every target dead-centre', exp: 'BOT: no travel, exact centres', run: expectFail('targets', P => A.scriptTargets(P)) },
    { g: 1, name: 'Mouse bot moving at constant speed', exp: 'BOT: hands accelerate and brake', run: expectFail('targets', P => A.adaptiveTargets(P)) },
    { g: 1, name: 'Timer clicks every flash', exp: 'BOT: identical reaction times', run: expectFail('reflex', P => ({ clicks: A.scriptReflex(P.rounds) })) },
    { g: 1, name: 'Metronome taps the beat', exp: 'BOT: machine-perfect timing', run: expectFail('beat', P => ({ taps: A.scriptBeat(P.beats) })) },
    { g: 1, name: 'Human-shaped data, submitted instantly', exp: 'BOT: computed, not performed', run: expectFail('ring', P => ({ samples: A.adaptiveRing(P) }), false) },
    { g: 1, name: 'Replayed human trace that never listens for live jumps', exp: 'BOT: missing the live jump signals', run: async () => {
      const b = await challenge('ring', P => ({ samples: A.humanRing({ ...P, darts: [] }, 4) }), true, false);
      return { ok: b.result === 'fail' && (b.flags || []).some(f => /live jump signals/.test(f)), got: (b.result || 'error').toUpperCase() + ' · ' + ((b.flags && b.flags[0]) || '') };
    } },
    { g: 2, name: 'Person fills a form (invisible pass)', exp: 'passes silently, no check shown', run: async () => {
      const form = await sha256(JSON.stringify([['email', 'ada@example.com']]));
      const r = await post('/api/pass/silent', { telemetry: { timeOnPageMs: 9400, fields: [{ keys: typing(14), chars: 14 }], pointer: approach(), pointerType: 'mouse', trustedSubmit: true, env: {} }, form_hash: form });
      shared.silent = r.body.pass_token; shared.form = form;
      return { ok: r.body.tier === 'pass', got: (r.body.tier || 'error').toUpperCase() + ' · ' + ((r.body.evidence && r.body.evidence[0]) || (r.body.reasons && r.body.reasons[0]) || '') };
    } },
    { g: 2, name: 'Script fills the form instantly', exp: 'steps up to a full check', run: async () => {
      const r = await post('/api/pass/silent', { telemetry: { timeOnPageMs: 350, fields: [{ keys: [], chars: 15 }], pointer: [], trustedSubmit: false, env: {} } });
      return { ok: r.body.tier === 'challenge', got: (r.body.tier || 'error').toUpperCase() + ' · ' + ((r.body.reasons && r.body.reasons[0]) || '') };
    } },
    { g: 2, name: 'Silent pass pasted into a different form', exp: 'refused: different form submission', run: async () => {
      if (!shared.silent) return { ok: false, got: 'no silent pass from the row above' };
      const r = await post('/api/pass/verify', { pass: shared.silent, form_hash: await sha256('some other submission') });
      return { ok: r.body.ok === false && /different form/.test(r.body.reason || ''), got: (r.body.ok ? 'ACCEPTED' : 'REFUSED') + ' · ' + (r.body.reason || '') };
    } },
    { g: 2, name: 'Replay a finished session', exp: '409 replay refused', run: async () => {
      const s = await post('/api/challenge/start', { type: 'beat' });
      await post('/api/challenge/submit', { session: s.body.session, taps: A.humanBeat(s.body.params.beats) });
      const r = await post('/api/challenge/submit', { session: s.body.session, taps: A.humanBeat(s.body.params.beats) });
      return { ok: r.status === 409, got: 'HTTP ' + r.status + ' · ' + (r.body.reason || '') };
    } },
    { g: 2, name: 'Solver farm relays a pass token', exp: 'refused: earned in another browser', run: async () => {
      if (!shared.pass) return { ok: false, got: 'no human pass from the rows above to relay' };
      const r = await post('/api/pass/verify', { pass: shared.pass, user_agent: 'Mozilla/5.0 (solver-farm worker)', accept_language: 'ru-RU', remoteip: '198.51.100.7' });
      return { ok: r.body.ok === false && /different browser/.test(r.body.reason || ''), got: (r.body.ok ? 'ACCEPTED' : 'REFUSED') + ' · ' + (r.body.reason || '') };
    } },
    { g: 2, name: 'DOM reader follows the hidden link', exp: 'logged as automated', run: async () => { const r = await fetch('/trap', { headers: { 'X-CM-Attacker': 'dry run' } }); return { ok: r.status === 200, got: 'HTTP ' + r.status + ' · logged' }; } },
    { g: 2, name: 'Scraper walks the catalogue', exp: 'slowed, then decoyed or blocked', run: async () => {
      let last = 'allow', seen = [];
      for (let p = 1; p <= 14; p++) {
        const r = await fetch('/api/catalog?page=' + p, { credentials: 'omit', cache: 'no-store', headers: { 'X-CM-Attacker': 'dry run' } });
        last = r.headers.get('x-captchame-shield') || (r.status === 429 ? 'block' : '?');
        if (!seen.includes(last)) seen.push(last);
        if (last === 'block') break;
      }
      return { ok: last === 'block' || last === 'decoy', got: seen.join(' -> ').toUpperCase() };
    } },
    { g: 2, name: 'Honest agent declares with a signed key', exp: 'declared, own budget', run: async () => {
      try {
        const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
        const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
        const pub = b64(await crypto.subtle.exportKey('spki', kp.publicKey));
        const n = await post('/api/agent/nonce', {});
        const sig = b64(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(n.body.nonce)));
        const d = await post('/api/agent/declare', { pubkey: pub, signature: sig, nonce: n.body.nonce, operator: 'dry-run agent', pass: shared.silent });
        shared.agent = d.body.agent_token;
        return { ok: d.body.result === 'declared', got: (d.body.result || 'failed') + ' · ' + (d.body.mode || '') + ' · budget $' + (d.body.budget || 0).toFixed(2) };
      } catch (e) { return { ok: false, got: 'this browser lacks Ed25519 in WebCrypto: ' + e.message }; }
    } },
    { g: 2, name: 'Delegated agent spends to its person’s cap', exp: '429 with a reason and an appeal link', run: async () => {
      if (!shared.agent) return { ok: false, got: 'no agent token from the row above' };
      for (let i = 0; i < 45; i++) {
        const r = await fetch('/api/protected/quote', { credentials: 'omit', headers: { Authorization: 'Bearer ' + shared.agent } });
        if (r.status === 429) { const b = await r.json(); return { ok: !!b.appeal_url, got: 'capped after ' + i + ' calls · ' + b.reason.slice(0, 70) }; }
      }
      return { ok: false, got: 'never capped' };
    } },
  ];

  listEl.innerHTML = STEPS.map((s, i) => '<div class="runrow" id="row' + i + '"><span class="st"></span><div><b>' + esc(s.name) + '</b><div class="exp">expect: ' + esc(s.exp) + '</div><div class="got"></div></div><span class="t"></span></div>').join('');
  const prog = document.getElementById('prog'), summary = document.getElementById('summary');

  async function runStep(i) {
    const row = document.getElementById('row' + i), t0 = performance.now();
    row.className = 'runrow running';
    let r;
    try { r = await STEPS[i].run(); } catch (e) { r = { ok: false, got: 'error: ' + e.message }; }
    row.className = 'runrow ' + (r.ok ? 'ok' : 'bad');
    row.querySelector('.st').textContent = r.ok ? '✓' : '!';
    row.querySelector('.got').textContent = r.got;
    row.querySelector('.got').style.color = r.ok ? '' : 'var(--bot-text)';
    row.querySelector('.t').textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s';
    return r.ok;
  }

  document.getElementById('runAll').addEventListener('click', async e => {
    e.target.disabled = true;
    STEPS.forEach((_, i) => { const row = document.getElementById('row' + i); row.className = 'runrow'; row.querySelector('.st').textContent = ''; row.querySelector('.got').textContent = ''; row.querySelector('.t').textContent = ''; });
    const t0 = performance.now();
    let done = 0, good = 0;
    const tick = ok => { done++; if (ok) good++; prog.style.width = (100 * done / STEPS.length) + '%'; summary.textContent = good + ' / ' + done + ' as expected'; };
    for (const g of [0, 1, 2]) {
      const idx = STEPS.map((s, i) => (s.g === g ? i : -1)).filter(i => i >= 0);
      if (g === 1) await Promise.all(idx.map(i => runStep(i).then(tick)));
      else for (const i of idx) tick(await runStep(i));
    }
    summary.textContent = good + ' / ' + STEPS.length + ' as expected in ' + ((performance.now() - t0) / 1000).toFixed(0) + ' s';
    e.target.disabled = false;
  });

  document.getElementById('resetData').addEventListener('click', async () => {
    if (!confirm('Clear all demo data: ledger, events, scoreboard, stats and shield state?')) return;
    const r = await fetch('/api/admin/reset', { method: 'POST', headers: { 'X-Admin-Key': KEY } });
    const b = await r.json().catch(() => ({}));
    summary.textContent = r.ok ? 'demo data cleared' : (b.reason || 'reset failed');
  });
})();
