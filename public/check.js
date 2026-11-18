'use strict';
const out = document.getElementById('out');
function show(cls, text) {
  out.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'result ' + cls;
  d.textContent = text;
  out.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const ENV = (() => { try { return { webdriver: navigator.webdriver === true, plugins: navigator.plugins ? navigator.plugins.length : 0, hardware: navigator.hardwareConcurrency || 0 }; } catch { return {}; } })();
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

const EMBED = new URLSearchParams(location.search).has('embed');
function report(res) {
  const passed = verdict(out, res, { redirect: !EMBED, failHint: 'You can retry here, or use the voice path.' });
  if (passed && EMBED && window.parent !== window) {
    try { window.parent.postMessage({ type: 'captchame:pass', pass_token: res.body && res.body.pass_token, score: res.body && res.body.score }, '*'); } catch {}
  } else if (passed) setTimeout(() => location.href = '/use.html', 2400);
}

// ---------- ring ----------
const cv = document.getElementById('field');
const ctx = cv.getContext('2d');
let tracking = null;

function drawIdle() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#9aa4b8';
  const t1 = 'Press start, then keep your pointer on the ring';
  let fs1 = Math.max(16, 16 * cv.width / cv.getBoundingClientRect().width);
  ctx.font = Math.round(fs1) + 'px sans-serif';
  while (ctx.measureText(t1).width > cv.width * 0.9 && fs1 > 10) { fs1 -= 1; ctx.font = Math.round(fs1) + 'px sans-serif'; }
  ctx.textAlign = 'center';
  ctx.fillText(t1, cv.width / 2, cv.height / 2);
}
drawIdle();

document.getElementById('startRing').addEventListener('click', async () => {
  const r = await post('/api/challenge/start', { type: 'ring' });
  if (r.status !== 200) return show('fail', 'Could not start: ' + (r.body.reason || r.status));
  const P = r.body.params;
  const samples = [];
  const t0 = performance.now();
  let px = null, py = null;

  const darts = (P.darts || []).slice().sort((a, b) => a.at - b.at);
  function target(tms) {
    const t = tms / 1000;
    let px = P.px, py = P.py;
    for (const d of darts) { if (tms >= d.at) { px = d.px; py = d.py; } }
    return {
      x: (0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + px)) * cv.width,
      y: (0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + py)) * cv.height,
    };
  }
  function onMove(e) {
    const rect = cv.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    px = (pt.clientX - rect.left) * (cv.width / rect.width);
    py = (pt.clientY - rect.top) * (cv.height / rect.height);
  }
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('touchmove', onMove, { passive: true });

  function frame() {
    const t = performance.now() - t0;
    if (t >= P.durationMs) return finish();
    const g = target(t);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // ring
    ctx.beginPath(); ctx.arc(g.x, g.y, 26, 0, 7); ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, 7); ctx.fillStyle = '#7dd3fc'; ctx.fill();
    // pointer trail
    if (px !== null) {
      ctx.beginPath(); ctx.arc(px, py, 8, 0, 7); ctx.fillStyle = 'rgba(232,236,244,.85)'; ctx.fill();
      samples.push({ t: Math.round(t), x: +(px / cv.width).toFixed(4), y: +(py / cv.height).toFixed(4) });
    }
    requestAnimationFrame(frame);
  }
  async function finish() {
    cv.removeEventListener('pointermove', onMove);
    cv.removeEventListener('touchmove', onMove);
    drawIdle();
    const res = await post('/api/challenge/submit', { session: r.body.session, samples, env: ENV });
    report(res);
  }
  requestAnimationFrame(frame);
});

// ---------- beat ----------
const zone = document.getElementById('tapzone');
document.getElementById('startBeat').addEventListener('click', async () => {
  const r = await post('/api/challenge/start', { type: 'beat' });
  if (r.status !== 200) return show('fail', 'Could not start: ' + (r.body.reason || r.status));
  const beats = r.body.params.beats;
  const taps = [];
  const t0 = performance.now();
  const endAt = beats[beats.length - 1] + 1200;
  let bi = 0;
  zone.textContent = 'Get ready...';

  function tap() {
    const t = performance.now() - t0;
    if (t < endAt) taps.push(Math.round(t));
  }
  zone.addEventListener('pointerdown', tap);
  zone.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); tap(); } });
  zone.focus();

  function tick() {
    const t = performance.now() - t0;
    if (bi < beats.length && t >= beats[bi]) {
      bi++;
      zone.classList.add('hot');
      zone.textContent = 'TAP';
      try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(); const g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.08, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09); o.start(); o.stop(ac.currentTime + 0.1); } catch {}
      setTimeout(() => { zone.classList.remove('hot'); zone.textContent = bi < beats.length ? '...' : 'done'; }, 120);
    }
    if (t < endAt) requestAnimationFrame(tick);
    else finish();
  }
  async function finish() {
    zone.removeEventListener('pointerdown', tap);
    zone.textContent = 'Tap zone';
    const res = await post('/api/challenge/submit', { session: r.body.session, taps, env: ENV });
    report(res);
  }
  requestAnimationFrame(tick);
});

// ---------- reflex ----------
const reflexZone = document.getElementById('reflexzone');
document.getElementById('startReflex').addEventListener('click', async () => {
  const r = await post('/api/challenge/start', { type: 'reflex' });
  if (r.status !== 200) return show('fail', 'Could not start: ' + (r.body.reason || r.status));
  const rounds = r.body.params.rounds;
  const clicks = [];
  const t0 = performance.now();
  const endAt = r.body.params.totalMs;
  reflexZone.textContent = 'Wait for the flash...';
  reflexZone.focus();

  function click() {
    const t = performance.now() - t0;
    if (t < endAt) clicks.push(Math.round(t));
  }
  reflexZone.addEventListener('pointerdown', click);
  reflexZone.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); click(); } });

  let ri = 0;
  function tick() {
    const t = performance.now() - t0;
    if (ri < rounds.length && t >= rounds[ri].at) {
      const win = rounds[ri].windowMs; ri++;
      reflexZone.classList.add('flash');
      reflexZone.textContent = 'CLICK';
      setTimeout(() => { reflexZone.classList.remove('flash'); reflexZone.textContent = ri < rounds.length ? 'Wait for the flash...' : 'Done'; }, win);
    }
    if (t < endAt) requestAnimationFrame(tick);
    else finish();
  }
  async function finish() {
    reflexZone.removeEventListener('pointerdown', click);
    reflexZone.textContent = 'Tap the flash';
    const res = await post('/api/challenge/submit', { session: r.body.session, clicks, env: ENV });
    report(res);
  }
  requestAnimationFrame(tick);
});

// ---------- pulse (dual-task) ----------
const pcv = document.getElementById('pulsefield');
const pctx = pcv.getContext('2d');
(function drawPulseIdle() {
  pctx.clearRect(0, 0, pcv.width, pcv.height);
  pctx.fillStyle = '#9aa4b8'; pctx.textAlign = 'center';
  const t2 = 'Press start, follow the ring, click when it flashes';
  let fs2 = Math.max(16, 16 * pcv.width / pcv.getBoundingClientRect().width);
  pctx.font = Math.round(fs2) + 'px sans-serif';
  while (pctx.measureText(t2).width > pcv.width * 0.9 && fs2 > 10) { fs2 -= 1; pctx.font = Math.round(fs2) + 'px sans-serif'; }
  pctx.fillText(t2, pcv.width / 2, pcv.height / 2);
})();

document.getElementById('startPulse').addEventListener('click', async () => {
  const r = await post('/api/challenge/start', { type: 'pulse' });
  if (r.status !== 200) return show('fail', 'Could not start: ' + (r.body.reason || r.status));
  const P = r.body.params;
  const samples = [], clicks = [];
  const t0 = performance.now();
  let px = null, py = null;

  function target(tms) {
    const t = tms / 1000;
    return {
      x: (0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + P.px)) * pcv.width,
      y: (0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + P.py)) * pcv.height,
    };
  }
  function onMove(e) {
    const rect = pcv.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    px = (pt.clientX - rect.left) * (pcv.width / rect.width);
    py = (pt.clientY - rect.top) * (pcv.height / rect.height);
  }
  function onClick() {
    const t = performance.now() - t0;
    if (t < P.durationMs) clicks.push(Math.round(t));
  }
  pcv.addEventListener('pointermove', onMove);
  pcv.addEventListener('touchmove', onMove, { passive: true });
  pcv.addEventListener('pointerdown', onClick);
  const keyH = e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); onClick(); } };
  window.addEventListener('keydown', keyH);

  function flashing(t) {
    return P.flashes.some(f => t >= f && t <= f + P.flashWindowMs);
  }
  function frame() {
    const t = performance.now() - t0;
    if (t >= P.durationMs) return finish();
    const g = target(t);
    const hot = flashing(t);
    pctx.clearRect(0, 0, pcv.width, pcv.height);
    pctx.beginPath(); pctx.arc(g.x, g.y, hot ? 34 : 26, 0, 7);
    pctx.strokeStyle = hot ? '#f5d76e' : '#7dd3fc'; pctx.lineWidth = hot ? 5 : 3; pctx.stroke();
    pctx.beginPath(); pctx.arc(g.x, g.y, 4, 0, 7); pctx.fillStyle = hot ? '#f5d76e' : '#7dd3fc'; pctx.fill();
    if (px !== null) {
      pctx.beginPath(); pctx.arc(px, py, 8, 0, 7); pctx.fillStyle = 'rgba(232,236,244,.85)'; pctx.fill();
      samples.push({ t: Math.round(t), x: +(px / pcv.width).toFixed(4), y: +(py / pcv.height).toFixed(4) });
    }
    requestAnimationFrame(frame);
  }
  async function finish() {
    pcv.removeEventListener('pointermove', onMove);
    pcv.removeEventListener('touchmove', onMove);
    pcv.removeEventListener('pointerdown', onClick);
    window.removeEventListener('keydown', keyH);
    const res = await post('/api/challenge/submit', { session: r.body.session, samples, clicks, env: ENV });
    report(res);
  }
  requestAnimationFrame(frame);
});
