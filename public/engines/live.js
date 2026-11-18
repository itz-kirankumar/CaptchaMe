(function () {
  'use strict';
  const go = document.getElementById('go');
  if (!go || !window.CMActors) return;
  const A = window.CMActors;
  const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const INK = { RED: '#ff4d5e', BLUE: '#4d8bff' };
  let NONCE = null;
  const getNonce = async () => { if (!NONCE) { try { const d = await (await fetch('/api/page/nonce', { cache: 'no-store' })).json(); NONCE = d.nonce || null; } catch { NONCE = null; } } return NONCE; };
  const post = async (url, body) => { if (url === '/api/challenge/start') { const n = await getNonce(); if (n) body = { ...body, page_nonce: n }; } const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CM-Attacker': 'live run' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const seed = () => Math.random() * 1e9 | 0;

  // attacker options per format; each returns a submit payload
  const ATTACKERS = {
    ring: [['script', 'Script that read the path', P => ({ samples: A.scriptRing(P) })], ['agent', 'Look-think-act agent', P => ({ samples: A.agentRing(P) })]],
    targets: [['script', 'Script clicking exact centres', P => A.scriptTargets(P)], ['adaptive', 'Mouse bot, straight constant-speed paths', P => A.adaptiveTargets(P)], ['agent', 'Look-think-act agent', P => A.agentTargets(P)]],
    clash: [['reader', 'Agent reading the page text', P => ({ responses: A.readerClash(P) })], ['script', 'Timer that knows the answers', P => ({ responses: A.scriptClash(P) })], ['agent', 'Look-think-act agent', P => ({ responses: A.agentClash(P) })]],
    reflex: [['script', 'Timer that clicks every flash', P => ({ clicks: A.scriptReflex(P.rounds) })], ['agent', 'Look-think-act agent', P => ({ clicks: A.agentReflex(P.rounds) })]],
  };
  const HUMAN = {
    ring: P => ({ samples: A.humanRing(P, seed()) }),
    targets: P => A.humanTargets(P, seed()),
    clash: P => ({ responses: A.humanClash(P, seed()) }),
    reflex: P => ({ clicks: A.humanReflex(P.rounds, seed()) }),
  };
  const fmtSel = document.getElementById('fmt'), atkSel = document.getElementById('atk');
  function fillAttackers() { atkSel.innerHTML = ATTACKERS[fmtSel.value].map(([id, label]) => '<option value="' + id + '">' + label + '</option>').join(''); document.getElementById('atkName').textContent = atkSel.options[0].text; }
  fmtSel.onchange = fillAttackers; atkSel.onchange = () => { document.getElementById('atkName').textContent = atkSel.selectedOptions[0].text; };
  fillAttackers();

  // Ring jumps arrive live from the server during the run.
  function livePoll(s) {
    const t0 = performance.now(), P = { ...s.body.params, darts: [] }, cues = [], seen = new Set();
    let stop = false;
    (async () => {
      while (!stop) {
        try {
          const r = await post('/api/challenge/cue', { session: s.body.session });
          for (const c of r.body.cues || []) {
            if (seen.has(c.i)) continue;
            seen.add(c.i);
            const at = Math.round(performance.now() - t0);
            cues.push({ ...c, appliedAt: at }); P.darts.push({ at, px: c.px, py: c.py });
          }
          if (r.body.done) break;
        } catch { /* keep polling */ }
        await new Promise(res => setTimeout(res, 150));
      }
    })();
    return { P, cues, stop() { stop = true; } };
  }

  const duration = (fmt, P, pay) => fmt === 'ring' ? P.durationMs : fmt === 'reflex' ? P.totalMs : fmt === 'clash' ? P.totalMs : (pay.clicks.length ? pay.clicks[pay.clicks.length - 1].t + 400 : 3000);

  function drawFrame(cv, fmt, P, pay, t) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (fmt === 'ring') {
      const g = A.targetAt(P, t);
      ctx.beginPath(); ctx.arc(g.x * W, g.y * H, 22, 0, 7); ctx.strokeStyle = v('--brand'); ctx.lineWidth = 3; ctx.stroke();
      // live preview: the bot sits on the target; the hand trails it by ~180 ms
      const st = cv._st || (cv._st = { x: g.x, y: g.y });
      if (cv._side === 'bot') { st.x = g.x; st.y = g.y; }
      else { const lag = A.targetAt(P, Math.max(0, t - 180)); st.x += (lag.x - st.x) * 0.2 + (Math.random() - 0.5) * 0.004; st.y += (lag.y - st.y) * 0.2 + (Math.random() - 0.5) * 0.004; }
      ctx.beginPath(); ctx.arc(st.x * W, st.y * H, 7, 0, 7); ctx.fillStyle = v('--text'); ctx.fill();
    } else if (fmt === 'targets') {
      const kx = W / P.field.w, ky = H / P.field.h;
      const idx = pay.clicks.findIndex(c => c.t > t);
      const tg = P.targets[idx === -1 ? P.targets.length - 1 : pay.clicks[idx].i];
      if (idx !== -1 && tg) { ctx.beginPath(); ctx.arc(tg.x * kx, tg.y * ky, tg.r * kx, 0, 7); ctx.fillStyle = v('--brand'); ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = v('--brand'); ctx.lineWidth = 2.5; ctx.stroke(); }
      let pos = { x: P.field.w / 2, y: P.field.h / 2 };
      for (const s of pay.samples) { if (s.t <= t) pos = s; else break; }
      for (const c of pay.clicks) { if (c.t <= t && (!pay.samples.length || c.t >= (pos.t || 0))) pos = c; }
      ctx.beginPath(); ctx.arc(pos.x * kx, pos.y * ky, 6, 0, 7); ctx.fillStyle = v('--text'); ctx.fill();
      ctx.fillStyle = v('--muted'); ctx.font = '600 13px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(Math.min(P.targets.length, (idx === -1 ? P.targets.length : idx)) + ' / ' + P.targets.length, 10, 10);
    } else if (fmt === 'clash') {
      const i = P.trials.findIndex(tr => t >= tr.at && t < tr.at + P.windowMs);
      const answered = i >= 0 && pay.responses.find(r => r.i === i && r.t <= t);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (i >= 0 && !answered) { ctx.font = '800 64px "Bricolage Grotesque", sans-serif'; ctx.fillStyle = INK[P.trials[i].ink]; ctx.fillText(P.trials[i].word, W / 2, H / 2 - 20); }
      const last = pay.responses.filter(r => r.t <= t).slice(-1)[0];
      if (last && t - last.t < 600) { const tr = P.trials[last.i]; ctx.font = '700 16px Inter, sans-serif'; ctx.fillStyle = last.choice === tr.ink ? v('--human-text') : v('--bot-text'); ctx.fillText('picked ' + last.choice + ' in ' + Math.round(last.t - tr.at) + ' ms', W / 2, H / 2 + 40); }
      timeline(ctx, W, H, P.trials.map(tr => [tr.at, tr.at + P.windowMs]), pay.responses.map(r => r.t), P.totalMs, t);
    } else if (fmt === 'reflex') {
      const hot = P.rounds.some(r => t >= r.at && t < r.at + r.windowMs);
      ctx.beginPath(); ctx.arc(W / 2, H / 2 - 20, 60, 0, 7); ctx.fillStyle = hot ? v('--brand') : v('--surface-3'); ctx.fill();
      const clicked = pay.clicks.some(c => c <= t && t - c < 160);
      if (clicked) { ctx.beginPath(); ctx.arc(W / 2, H / 2 - 20, 70, 0, 7); ctx.strokeStyle = v('--text'); ctx.lineWidth = 3; ctx.stroke(); }
      timeline(ctx, W, H, P.rounds.map(r => [r.at, r.at + r.windowMs]), pay.clicks, P.totalMs, t);
    }
    ctx.fillStyle = v('--surface-3'); ctx.fillRect(0, H - 4, W, 4);
  }
  // windows as blocks, responses as ticks, a playhead
  function timeline(ctx, W, H, wins, ticks, total, t) {
    const y = H - 34, x = ms => 16 + (W - 32) * ms / total;
    ctx.fillStyle = v('--surface-3'); ctx.fillRect(16, y, W - 32, 14);
    ctx.fillStyle = v('--brand'); ctx.globalAlpha = 0.35; wins.forEach(([a, b]) => ctx.fillRect(x(a), y, x(b) - x(a), 14)); ctx.globalAlpha = 1;
    ctx.fillStyle = v('--text'); ticks.filter(k => k <= t).forEach(k => ctx.fillRect(x(k) - 1, y - 5, 2, 24));
    ctx.fillStyle = v('--bot'); ctx.fillRect(x(Math.min(t, total)) - 1, y - 8, 2, 30);
  }

  function play(cv, fmt, P, pay) {
    const total = duration(fmt, P, pay);
    const speed = total > 13000 ? total / 13000 : 1;
    const t0 = performance.now();
    return new Promise(res => {
      (function frame() {
        if (!document.body.contains(cv)) return res();
        const t = (performance.now() - t0) * speed;
        drawFrame(cv, fmt, P, pay, Math.min(t, total));
        if (t >= total) return res(speed);
        requestAnimationFrame(frame);
      })();
    });
  }

  go.addEventListener('click', async () => {
    const fmt = fmtSel.value, atk = ATTACKERS[fmt].find(a => a[0] === atkSel.value);
    const status = document.getElementById('status');
    go.disabled = true;
    document.getElementById('botout').innerHTML = ''; document.getElementById('humout').innerHTML = '';
    status.textContent = 'Two challenges started on the server...';
    const [sb, sh] = await Promise.all([post('/api/challenge/start', { type: fmt }), post('/api/challenge/start', { type: fmt })]);
    if (sb.status !== 200 || sh.status !== 200) { status.textContent = 'Could not start: ' + ((sb.body && sb.body.reason) || (sh.body && sh.body.reason) || 'error'); go.disabled = false; return; }
    const live = fmt === 'ring';
    const pollB = live ? livePoll(sb) : null, pollH = live ? livePoll(sh) : null;
    let botPay = live ? null : atk[2](sb.body.params), humPay = live ? null : HUMAN[fmt](sh.body.params);
    status.textContent = live ? 'Watch both sides. The jumps arrive live from the server...' : 'Watch both sides...';
    const bcv = document.getElementById('botcv'), hcv = document.getElementById('humcv');
    bcv._side = 'bot'; hcv._side = 'human'; bcv._st = hcv._st = null;
    const [spB, spH] = await Promise.all([play(bcv, fmt, live ? pollB.P : sb.body.params, botPay), play(hcv, fmt, live ? pollH.P : sh.body.params, humPay)]);
    if (live) {
      pollB.stop(); pollH.stop();
      botPay = { ...atk[2](pollB.P), cues: pollB.cues };
      humPay = { ...HUMAN.ring(pollH.P), cues: pollH.cues };
    }
    if ((spB || 1) > 1 || (spH || 1) > 1) status.textContent = 'Played faster than real time for the slow side. Judging...';
    else status.textContent = 'Judging...';
    // the server enforces a real-time floor; make sure it has passed
    await new Promise(r => setTimeout(r, 300));
    const [rb, rh] = await Promise.all([post('/api/challenge/submit', { session: sb.body.session, ...botPay }), post('/api/challenge/submit', { session: sh.body.session, ...humPay })]);
    verdict(document.getElementById('botout'), rb, { failHint: 'Caught on the shape of its response.', next: false, quiet: true });
    verdict(document.getElementById('humout'), rh, { next: false });
    status.textContent = 'Both judged by the live server. Try another attacker.';
    go.disabled = false;
  });
})();
