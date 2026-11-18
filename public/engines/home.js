(function () {
  'use strict';
  const cv = document.getElementById('herocv');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const P = { ax: 0.32, ay: 0.3, fx: 0.17, fy: 0.23, px: 0.4, py: 1.3 };
  const at = t => ({ x: (0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + P.px)) * cv.width, y: (0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + P.py)) * cv.height });
  let hx = null, hy = null, wx = 0, wy = 0;
  const trail = [];
  const t0 = performance.now();
  function frame() {
    if (!document.body.contains(cv)) return;
    const t = (performance.now() - t0) / 1000;
    const g = at(t), lagged = at(t - 0.18);
    wx = wx * 0.94 + (Math.random() - 0.5) * 2.2; wy = wy * 0.94 + (Math.random() - 0.5) * 2.2;
    if (hx === null) { hx = lagged.x; hy = lagged.y; }
    hx += (lagged.x - hx) * 0.22 + wx * 0.25; hy += (lagged.y - hy) * 0.22 + wy * 0.25;
    trail.push({ x: hx, y: hy }); if (trail.length > 40) trail.shift();
    ctx.clearRect(0, 0, cv.width, cv.height);
    // grid
    ctx.strokeStyle = v('--line'); ctx.lineWidth = 1;
    for (let x = 40; x < cv.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke(); }
    for (let y = 40; y < cv.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); }
    // target ring
    ctx.beginPath(); ctx.arc(g.x, g.y, 30, 0, 7); ctx.strokeStyle = v('--brand'); ctx.globalAlpha = 0.35; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1;
    // human trail and dot
    ctx.beginPath(); trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = v('--human'); ctx.globalAlpha = 0.5; ctx.lineWidth = 2.5; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, 7); ctx.fillStyle = v('--human'); ctx.fill();
    // bot dot: glued to the target
    ctx.beginPath(); ctx.arc(g.x, g.y, 7, 0, 7); ctx.fillStyle = v('--bot'); ctx.fill();
    ctx.font = '600 15px "JetBrains Mono", monospace'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = v('--bot-text'); ctx.fillText('BOT 0 ms', g.x + 16, g.y - 14);
    ctx.fillStyle = v('--human-text'); ctx.fillText('HUMAN ~180 ms', hx + 16, hy + 30);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  async function stats() {
    const band = document.getElementById('statband');
    if (!band) return;
    if (!band.dataset.orig) band.dataset.orig = band.innerHTML;
    try {
      const s = await (await fetch('/api/stats', { cache: 'no-store' })).json();
      if (!s.checks) {
        // Fresh deployment, no traffic yet: say so honestly instead of showing dashes.
        band.dataset.idle = '1';
        band.innerHTML = '<div class="statlive"><span class="dot"></span><span>Live now. Counters start with the first visitor on this deployment - <a href="/check">run the live demo</a> to light them up.</span></div>';
      } else {
        if (band.dataset.idle) { band.innerHTML = band.dataset.orig; delete band.dataset.idle; }
        const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = Number(n || 0).toLocaleString(); };
        set('st-checks', s.checks); set('st-humans', s.humans); set('st-bots', s.botsCaught); set('st-agents', s.agents); set('st-scrape', s.scrapersStopped);
      }
    } catch { /* offline */ }
    setTimeout(stats, 4000);
  }
  stats();
})();
