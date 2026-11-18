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

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

function report(res) {
  const b = res.body;
  if (b.result === 'pass') {
    show('pass', `Passed (score ${b.score}).\n$${b.budget_added.toFixed(2)} added to your allowance on the demo API.\n\nTry it: /use.html`);
    setTimeout(() => location.href = '/use.html', 1600);
  } else {
    show('fail', `Not passed (score ${b.score}).\n${b.reason || ''}\n\nYou can retry, or use the voice path.`);
  }
}

// ---------- ring ----------
const cv = document.getElementById('field');
const ctx = cv.getContext('2d');
let tracking = null;

function drawIdle() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#9aa4b8';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Press start, then keep your pointer on the ring', cv.width / 2, cv.height / 2);
}
drawIdle();

document.getElementById('startRing').addEventListener('click', async () => {
  const r = await post('/api/challenge/start', { type: 'ring' });
  if (r.status !== 200) return show('fail', 'Could not start: ' + (r.body.reason || r.status));
  const P = r.body.params;
  const samples = [];
  const t0 = performance.now();
  let px = null, py = null;

  function target(tms) {
    const t = tms / 1000;
    return {
      x: (0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + P.px)) * cv.width,
      y: (0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + P.py)) * cv.height,
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
    const res = await post('/api/challenge/submit', { session: r.body.session, samples });
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
    const res = await post('/api/challenge/submit', { session: r.body.session, taps });
    report(res);
  }
  requestAnimationFrame(tick);
});
