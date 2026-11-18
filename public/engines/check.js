(function () {
  'use strict';
  const app = document.getElementById('checkapp');
  if (!app) return;
  const out = document.getElementById('out');
  const EMBED = new URLSearchParams(location.search).has('embed');
  // When a protected form steps a visitor up to this check, the pass is bound
  // to that form's exact contents (a SHA-256 the parent page computed).
  const FORM = /^[a-f0-9]{64}$/i.test(new URLSearchParams(location.search).get('form') || '') ? new URLSearchParams(location.search).get('form').toLowerCase() : undefined;
  const ENV = (() => { try { return { webdriver: navigator.webdriver === true, plugins: navigator.plugins ? navigator.plugins.length : 0, hardware: navigator.hardwareConcurrency || 0 }; } catch { return {}; } })();
  const col = n => cmVar(n);
  const INK = { RED: '#ff4d5e', BLUE: '#4d8bff' };

  let NONCE = null;
  async function getNonce() {
    if (NONCE) return NONCE;
    try { const r = await fetch('/api/page/nonce', { cache: 'no-store' }); const d = await r.json(); NONCE = d.nonce || null; } catch { NONCE = null; }
    return NONCE;
  }
  async function post(url, body) {
    if (url === '/api/challenge/start') { const n = await getNonce(); if (n) body = { ...body, page_nonce: n }; }
    if (url === '/api/challenge/submit' && FORM) body = { ...body, form_hash: FORM };
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }
  function show(text) { out.innerHTML = '<div class="result fail"></div>'; out.firstChild.textContent = text; }
  function busy(on) { app.querySelectorAll('[data-start]').forEach(b => { b.disabled = on; }); }
  function report(res) {
    busy(false);
    const passed = verdict(out, res, { embed: EMBED, failHint: 'Retry, pick another format, or use the voice path.' });
    if (passed && EMBED && window.parent !== window) {
      try { window.parent.postMessage({ type: 'captchame:pass', pass_token: res.body && res.body.pass_token, score: res.body && res.body.score }, '*'); } catch { /* cross-origin parent */ }
    }
  }
  async function begin(type) {
    out.innerHTML = '';
    const r = await post('/api/challenge/start', { type });
    if (r.status !== 200) { show('Could not start: ' + (r.body.reason || r.status)); return null; }
    return r.body;
  }
  function idle(cv, text) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = col('--muted');
    let fs = Math.max(16, 16 * cv.width / (cv.getBoundingClientRect().width || cv.width));
    ctx.font = '500 ' + Math.round(fs) + 'px Inter, sans-serif';
    while (ctx.measureText(text).width > cv.width * 0.9 && fs > 10) { fs -= 1; ctx.font = '500 ' + Math.round(fs) + 'px Inter, sans-serif'; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cv.width / 2, cv.height / 2);
  }
  function pointIn(cv, e) {
    const rect = cv.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    return { x: (pt.clientX - rect.left) * (cv.width / rect.width), y: (pt.clientY - rect.top) * (cv.height / rect.height) };
  }

  // ---------- ring (with darts) and pulse share one tracker ----------
  function lissajous(P, cv, tms) {
    const t = tms / 1000;
    let px = P.px, py = P.py;
    for (const d of (P.darts || [])) if (tms >= d.at) { px = d.px; py = d.py; }
    return { x: (0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + px)) * cv.width, y: (0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + py)) * cv.height };
  }
  // The ring's jumps and the pulse's flashes arrive live from the server
  // (they are not in the challenge), so the page polls for them as it runs.
  function cuePoller(s, t0, onCue) {
    const got = new Set(), cues = [];
    let stop = false;
    (async function poll() {
      while (!stop) {
        try {
          const r = await post('/api/challenge/cue', { session: s.session });
          for (const c of (r.body && r.body.cues) || []) {
            if (got.has(c.kind + c.i)) continue;
            got.add(c.kind + c.i);
            const cue = { ...c, appliedAt: Math.round(performance.now() - t0) };
            cues.push(cue); onCue(cue);
          }
          if (r.body && r.body.done) break;
        } catch { /* keep polling */ }
        await new Promise(res => setTimeout(res, 150));
      }
    })();
    return { cues, stop() { stop = true; } };
  }

  function track(cv, s, withFlashes) {
    const P = { ...s.params, darts: [], flashes: [] }, ctx = cv.getContext('2d');
    const samples = [], clicks = [];
    const t0 = performance.now();
    const poller = s.params.cues ? cuePoller(s, t0, c => {
      if (c.kind === 'dart') P.darts.push({ at: c.appliedAt, px: c.px, py: c.py });
      else P.flashes.push(c.appliedAt);
    }) : { cues: [], stop() {} };
    let pos = null;
    const onMove = e => { pos = pointIn(cv, e); };
    const onClick = () => { const t = performance.now() - t0; if (withFlashes && t < P.durationMs) clicks.push(Math.round(t)); };
    const onKey = e => { if (withFlashes && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); onClick(); } };
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('touchmove', onMove, { passive: true });
    cv.addEventListener('pointerdown', onClick);
    window.addEventListener('keydown', onKey);
    const hot = t => withFlashes && P.flashes.some(f => t >= f && t <= f + P.flashWindowMs);
    return new Promise(resolve => {
      (function frame() {
        const t = performance.now() - t0;
        if (t >= P.durationMs) {
          cv.removeEventListener('pointermove', onMove); cv.removeEventListener('touchmove', onMove);
          cv.removeEventListener('pointerdown', onClick); window.removeEventListener('keydown', onKey);
          poller.stop();
          return resolve({ samples, clicks, cues: poller.cues });
        }
        const g = lissajous(P, cv, t), h = hot(t);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.beginPath(); ctx.arc(g.x, g.y, h ? 36 : 28, 0, 7);
        ctx.strokeStyle = h ? col('--warn') : col('--brand'); ctx.lineWidth = h ? 6 : 3.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, 7); ctx.fillStyle = h ? col('--warn') : col('--brand'); ctx.fill();
        // progress bar along the bottom
        ctx.fillStyle = col('--surface-3'); ctx.fillRect(0, cv.height - 5, cv.width, 5);
        ctx.fillStyle = col('--brand'); ctx.fillRect(0, cv.height - 5, cv.width * (t / P.durationMs), 5);
        if (pos) {
          ctx.beginPath(); ctx.arc(pos.x, pos.y, 8, 0, 7); ctx.fillStyle = col('--text'); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
          samples.push({ t: Math.round(t), x: +(pos.x / cv.width).toFixed(4), y: +(pos.y / cv.height).toFixed(4) });
        }
        requestAnimationFrame(frame);
      })();
    });
  }

  const ringCv = document.getElementById('field');
  const pulseCv = document.getElementById('pulsefield');
  const targetCv = document.getElementById('targetfield');
  function idleAll() {
    idle(ringCv, 'Press start, then keep your pointer on the ring');
    idle(pulseCv, 'Follow the ring, click whenever it flashes');
    idle(targetCv, 'Press start, then click each target as it appears');
  }
  idleAll();
  window.addEventListener('cm-theme', idleAll);

  const RUN = {
    async ring(s) { const r = await track(ringCv, s, false); idle(ringCv, 'Judging...'); report(await post('/api/challenge/submit', { session: s.session, samples: r.samples, cues: r.cues, env: ENV, form_hash: FORM })); idleAll(); },
    async pulse(s) { const r = await track(pulseCv, s, true); idle(pulseCv, 'Judging...'); report(await post('/api/challenge/submit', { session: s.session, samples: r.samples, clicks: r.clicks, cues: r.cues, env: ENV, form_hash: FORM })); idleAll(); },

    async beat(s) {
      const zone = document.getElementById('tapzone');
      const beats = s.params.beats, taps = [], t0 = performance.now(), endAt = beats[beats.length - 1] + 1200;
      let bi = 0;
      zone.textContent = 'Get ready...';
      const tap = () => { const t = performance.now() - t0; if (t < endAt) taps.push(Math.round(t)); };
      const key = e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); tap(); } };
      zone.addEventListener('pointerdown', tap); zone.addEventListener('keydown', key); zone.focus();
      await new Promise(resolve => {
        (function tick() {
          const t = performance.now() - t0;
          if (bi < beats.length && t >= beats[bi]) {
            bi++; zone.classList.add('hot'); zone.textContent = 'TAP';
            try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.08, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09); o.start(); o.stop(ac.currentTime + 0.1); } catch { /* no audio */ }
            setTimeout(() => { zone.classList.remove('hot'); zone.textContent = bi < beats.length ? '...' : 'done'; }, 120);
          }
          if (t < endAt) requestAnimationFrame(tick); else resolve();
        })();
      });
      zone.removeEventListener('pointerdown', tap); zone.removeEventListener('keydown', key);
      zone.textContent = 'Press start, then tap with the pulse';
      report(await post('/api/challenge/submit', { session: s.session, taps, env: ENV }));
    },

    async reflex(s) {
      const zone = document.getElementById('reflexzone');
      const rounds = s.params.rounds, clicks = [], t0 = performance.now(), endAt = s.params.totalMs;
      zone.textContent = 'Wait for the flash...'; zone.focus();
      const click = () => { const t = performance.now() - t0; if (t < endAt) clicks.push(Math.round(t)); };
      const key = e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); click(); } };
      zone.addEventListener('pointerdown', click); zone.addEventListener('keydown', key);
      let ri = 0;
      await new Promise(resolve => {
        (function tick() {
          const t = performance.now() - t0;
          if (ri < rounds.length && t >= rounds[ri].at) {
            const win = rounds[ri].windowMs; ri++;
            zone.classList.add('flash'); zone.textContent = 'CLICK';
            setTimeout(() => { zone.classList.remove('flash'); zone.textContent = ri < rounds.length ? 'Wait for the flash...' : 'Done'; }, win);
          }
          if (t < endAt) requestAnimationFrame(tick); else resolve();
        })();
      });
      zone.removeEventListener('pointerdown', click); zone.removeEventListener('keydown', key);
      zone.textContent = 'Press start, then click each flash';
      report(await post('/api/challenge/submit', { session: s.session, clicks, env: ENV }));
    },

    // Colour-word interference: pick the INK, not the word.
    async clash(s) {
      const P = s.params;
      const word = document.getElementById('clashWord');
      const prog = document.getElementById('clashProg');
      const btns = { RED: document.getElementById('clashRed'), BLUE: document.getElementById('clashBlue') };
      prog.innerHTML = P.trials.map(() => '<i></i>').join('');
      const responses = [], t0 = performance.now();
      let cur = -1;
      function choose(c) {
        if (cur < 0 || responses.some(r => r.i === cur)) return;
        responses.push({ i: cur, t: Math.round(performance.now() - t0), choice: c });
        prog.children[cur].classList.add('done');
        word.textContent = ''; cur = -1;
      }
      const onRed = () => choose('RED'), onBlue = () => choose('BLUE');
      const onKey = e => { if (e.key === 'f' || e.key === 'F' || e.key === 'ArrowLeft') choose('RED'); if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowRight') choose('BLUE'); };
      btns.RED.addEventListener('pointerdown', onRed); btns.BLUE.addEventListener('pointerdown', onBlue); window.addEventListener('keydown', onKey);
      btns.RED.disabled = btns.BLUE.disabled = false;
      word.style.fontSize = ''; word.style.fontWeight = '';
      word.style.color = col('--muted'); word.textContent = 'Ready...';
      await new Promise(resolve => {
        (function tick() {
          const t = performance.now() - t0;
          if (t >= P.totalMs) return resolve();
          const idx = P.trials.findIndex((tr, i) => t >= tr.at && t < tr.at + P.windowMs && !responses.some(r => r.i === i));
          if (idx !== cur) {
            cur = idx;
            if (idx >= 0) { word.textContent = P.trials[idx].word; word.style.color = INK[P.trials[idx].ink]; }
            else word.textContent = '';
          }
          requestAnimationFrame(tick);
        })();
      });
      btns.RED.removeEventListener('pointerdown', onRed); btns.BLUE.removeEventListener('pointerdown', onBlue); window.removeEventListener('keydown', onKey);
      btns.RED.disabled = btns.BLUE.disabled = true;
      word.style.color = col('--muted'); word.textContent = 'Judging...';
      report(await post('/api/challenge/submit', { session: s.session, responses, env: ENV }));
      word.textContent = '';
    },

    // Fitts' law: click each target; size and distance vary.
    async targets(s) {
      const P = s.params, cv = targetCv, ctx = cv.getContext('2d');
      const clicks = [], samples = [], t0 = performance.now();
      let i = 0, ptype = 'mouse', done;
      function draw() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        const tg = P.targets[i];
        if (!tg) return;
        ctx.beginPath(); ctx.arc(tg.x, tg.y, tg.r, 0, 7); ctx.fillStyle = col('--brand'); ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 3; ctx.strokeStyle = col('--brand'); ctx.stroke();
        ctx.beginPath(); ctx.arc(tg.x, tg.y, 3, 0, 7); ctx.fillStyle = col('--brand'); ctx.fill();
        ctx.fillStyle = col('--muted'); ctx.font = '600 15px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText((i + 1) + ' / ' + P.targets.length, 14, 12);
      }
      const onMove = e => { const p = pointIn(cv, e); if (samples.length < 4000) samples.push({ t: Math.round(performance.now() - t0), x: +p.x.toFixed(1), y: +p.y.toFixed(1) }); };
      const onDown = e => {
        ptype = e.pointerType || ptype;
        const p = pointIn(cv, e), tg = P.targets[i];
        if (!tg) return;
        clicks.push({ i, t: Math.round(performance.now() - t0), x: +p.x.toFixed(1), y: +p.y.toFixed(1) });
        if (Math.hypot(p.x - tg.x, p.y - tg.y) <= tg.r) { i++; if (i >= P.targets.length) done(); else draw(); }
      };
      cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerdown', onDown);
      draw();
      await new Promise(resolve => { done = resolve; setTimeout(resolve, P.timeoutMs); });
      cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerdown', onDown);
      idle(cv, 'Judging...');
      report(await post('/api/challenge/submit', { session: s.session, clicks, samples, pointerType: ptype, env: ENV }));
      idleAll();
    },
  };

  app.querySelectorAll('[data-start]').forEach(btn => btn.addEventListener('click', async () => {
    const type = btn.getAttribute('data-start');
    busy(true);
    const s = await begin(type);
    if (!s) return busy(false);
    if (type === 'auto') {
      window.dispatchEvent(new CustomEvent('cm-tab', { detail: s.type }));
      const note = document.getElementById('autoNote');
      if (note) note.textContent = 'The server picked: ' + s.type + '. Go!';
      await new Promise(r => setTimeout(r, 450));
    }
    try { await RUN[s.type](s); } catch (e) { busy(false); show('Something went wrong: ' + e.message); }
  }));
})();
