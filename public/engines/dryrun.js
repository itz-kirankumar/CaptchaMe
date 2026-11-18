(function () {
  'use strict';
  const listEl = document.getElementById('runlist');
  if (!listEl || !window.CMActors) return;
  const A = window.CMActors;
  const KEY = new URLSearchParams(location.search).get('key') || 'demo-admin';
  const HDR = { 'Content-Type': 'application/json', 'X-CM-Attacker': 'dry run' };
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const post = async (url, body, extra) => { const r = await fetch(url, { method: 'POST', headers: { ...HDR, ...(extra || {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const waitFor = (type, P) => ({ ring: 0.75 * (P.durationMs || 0), pulse: 0.75 * (P.durationMs || 0), reflex: 0.75 * (P.totalMs || 0), beat: 0.75 * ((P.beats || [0]).slice(-1)[0] + 800), clash: 0.75 * (P.totalMs || 0), targets: 2100 }[type] || 0);
  const shared = {};

  // One live challenge: start, build the payload from the actor, wait the real time, submit.
  async function challenge(type, payload, wait = true) {
    const s = await post('/api/challenge/start', { type });
    if (s.status !== 200) return { ok: false, got: 'could not start: ' + (s.body.reason || s.status) };
    const body = payload(s.body.params);
    if (wait) await sleep(waitFor(type, s.body.params));
    const r = await post('/api/challenge/submit', { session: s.body.session, ...body });
    return r.body;
  }
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
        const d = await post('/api/agent/declare', { pubkey: pub, signature: sig, nonce: n.body.nonce, operator: 'dry-run agent' });
        shared.agent = d.body.agent_token;
        return { ok: d.body.result === 'declared', got: (d.body.result || 'failed') + ' · budget $' + (d.body.budget || 0).toFixed(2) };
      } catch (e) { return { ok: false, got: 'this browser lacks Ed25519 in WebCrypto: ' + e.message }; }
    } },
    { g: 2, name: 'Agent spends to its fair-share cap', exp: '429 with a reason and an appeal link', run: async () => {
      if (!shared.agent) return { ok: false, got: 'no agent token from the row above' };
      for (let i = 0; i < 20; i++) {
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
