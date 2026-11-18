'use strict';
// Side-by-side live judging: a perfect-tracking script vs a human-shaped hand.
// Movement data is generated client-side (clearly labeled as simulated); the
// verdicts come from the real server over the same API every visitor uses.
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
function gauss(rng) { return (rng() + rng() + rng() + rng() - 2) * 0.5; }
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function targetAt(P, tms) {
  const t = tms / 1000;
  let px = P.px, py = P.py;
  for (const d of (P.darts || [])) { if (tms >= d.at) { px = d.px; py = d.py; } }
  return { x: 0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + px), y: 0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + py) };
}
function scriptSamples(P) {
  const out = [];
  for (let t = 0; t < P.durationMs; t += 16) { const g = targetAt(P, t); out.push({ t, x: +g.x.toFixed(4), y: +g.y.toFixed(4) }); }
  return out;
}
function humanSamples(P, seed) {
  const rng = mulberry(seed);
  const lag = 140 + rng() * 120;
  const out = [];
  let wx = 0, wy = 0, cx = null, cy = null;
  for (let t = 0; t < P.durationMs; t += 16 + rng() * 6) {
    wx = wx * 0.95 + gauss(rng) * 0.004;
    wy = wy * 0.95 + gauss(rng) * 0.004;
    const g = targetAt(P, t - lag);
    if (cx === null) { cx = g.x; cy = g.y; }
    cx += (g.x - cx) * 0.25;
    cy += (g.y - cy) * 0.25;
    out.push({ t: Math.round(t), x: +(cx + wx + gauss(rng) * 0.01).toFixed(4), y: +(cy + wy + gauss(rng) * 0.01).toFixed(4) });
  }
  return out;
}

function animate(cv, P, samples, done) {
  const ctx = cv.getContext('2d');
  const t0 = performance.now();
  function frame() {
    const t = performance.now() - t0;
    if (t >= P.durationMs) return done();
    const g = targetAt(P, t);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.beginPath(); ctx.arc(g.x * cv.width, g.y * cv.height, 20, 0, 7);
    ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(g.x * cv.width, g.y * cv.height, 3, 0, 7); ctx.fillStyle = '#7dd3fc'; ctx.fill();
    // latest simulated cursor position at time t
    let cur = null;
    for (const s of samples) { if (s.t <= t) cur = s; else break; }
    if (cur) {
      ctx.beginPath(); ctx.arc(cur.x * cv.width, cur.y * cv.height, 7, 0, 7);
      ctx.fillStyle = 'rgba(232,236,244,.85)'; ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

document.getElementById('go').addEventListener('click', async () => {
  const go = document.getElementById('go');
  const status = document.getElementById('status');
  go.disabled = true;
  document.getElementById('botout').innerHTML = '';
  document.getElementById('humout').innerHTML = '';
  status.textContent = 'Two challenges started. Watch the cursors for 7 seconds...';

  const [rb, rh] = await Promise.all([
    post('/api/challenge/start', { type: 'ring' }),
    post('/api/challenge/start', { type: 'ring' }),
  ]);
  if (rb.status !== 200 || rh.status !== 200) { status.textContent = 'Could not start challenges.'; go.disabled = false; return; }

  const botS = scriptSamples(rb.body.params);
  const humS = humanSamples(rh.body.params, (Math.random() * 1e9) | 0);

  let botRes = null, humRes = null;
  await Promise.all([
    new Promise(res => animate(document.getElementById('botcv'), rb.body.params, botS, res)),
    new Promise(res => animate(document.getElementById('humcv'), rh.body.params, humS, res)),
  ]);

  status.textContent = 'Judging...';
  [botRes, humRes] = await Promise.all([
    post('/api/challenge/submit', { session: rb.body.session, samples: botS }),
    post('/api/challenge/submit', { session: rh.body.session, samples: humS }),
  ]);
  verdict(document.getElementById('botout'), botRes, { failHint: 'A script reads the path. It cannot help being perfect.' });
  verdict(document.getElementById('humout'), humRes, {});
  status.textContent = 'Both judged by the live server. Run it again, or try the human side yourself.';
  go.disabled = false;
});
