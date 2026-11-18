(function () {
  'use strict';
  const grid = document.getElementById('rivalGrid');
  if (!grid) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const RANK = { info: 0, ok: 1, pass: 1, flag: 2, bypass: 3, block: 3 };

  // ---------- attacker label (cookie, so the embedded widget inherits it) ----------
  const PRESETS = ['Human', 'Buster', '2Captcha', 'CapSolver', 'NopeCHA', 'Computer-use agent', 'Comet', 'Claude in Chrome', 'Script'];
  const getLabel = () => (document.cookie.match(/(?:^|; )cm_attacker=([^;]*)/) || [])[1];
  const label = () => decodeURIComponent(getLabel() || '') || 'unlabelled';
  const isHuman = () => /^\s*(human|person)\b/i.test(label());
  function setLabel(v) {
    const clean = String(v || '').replace(/[^\w .()+:-]/g, '').trim().slice(0, 40);
    document.cookie = 'cm_attacker=' + encodeURIComponent(clean) + '; Path=/; SameSite=Lax; Max-Age=86400';
    renderPills();
  }
  function renderPills() {
    $('pills').innerHTML = PRESETS.map(p => '<button class="pill' + (label() === p ? ' on' : '') + '" data-p="' + esc(p) + '">' + esc(p) + '</button>').join('');
  }
  $('pills').addEventListener('click', e => { const p = e.target.closest('[data-p]'); if (p) setLabel(p.getAttribute('data-p')); });
  $('attackerSet').addEventListener('click', () => setLabel($('attackerInput').value));
  $('attackerInput').addEventListener('keydown', e => { if (e.key === 'Enter') setLabel(e.target.value); });
  if (!getLabel()) setLabel('Human'); else renderPills();

  // ---------- built-in attackers ----------
  const running = new Set();
  let BOTS = [], MARKET = {};
  function renderSims() {
    $('sims').innerHTML = BOTS.map(b => '<button class="pill sim' + (running.has(b.id) ? ' run' : '') + '" data-sim="' + esc(b.id) + '" title="' + esc(b.blurb) + '"' + (running.has(b.id) ? ' disabled' : '') + '>' + esc(b.label.replace(/^Sim: /, '')) + (running.has(b.id) ? ' ...' : '') + '</button>').join('');
  }
  $('sims').addEventListener('click', async e => {
    const b = e.target.closest('[data-sim]');
    if (!b || running.has(b.dataset.sim)) return;
    running.add(b.dataset.sim); renderSims();
    const r = await post('/api/live/simulate', { bot: b.dataset.sim });
    if (r.status !== 202) { running.delete(b.dataset.sim); renderSims(); line('rival', { at: Date.now(), layer: '!', level: 'flag', text: r.body.reason || 'could not start', side: 'atk', sid: '-', type: '-' }); }
    setTimeout(() => { running.delete(b.dataset.sim); renderSims(); }, 30000);
  });
  $('liveReset').addEventListener('click', () => {
    $('cmConsole').innerHTML = ''; $('rivalConsole').innerHTML = ''; $('l2Console').innerHTML = '';
    stats = { bypass: 0, spend: 0, blocked: 0, through: 0 }; renderStats();
    attempts.clear(); focusDone = false; resetLayers(null); clearViz();
    for (const k of Object.keys(rivalCount)) rivalCount[k] = 0;
    grid.querySelectorAll('.lr-count').forEach(el => { el.textContent = ''; });
  });

  $('liveRefresh').addEventListener('click', async function () {
    if (this.disabled) return;
    this.disabled = true;
    const oldText = this.textContent;
    this.textContent = 'Loading new captchas...';

    grid.querySelectorAll('.lr-card').forEach(card => {
      card.classList.remove('hit');
      card.querySelector('.lr-res').textContent = '';
      card.querySelector('.lr-res').className = 'lr-res';
    });
    await Promise.all(Array.from(grid.querySelectorAll('.lr-card'), load));

    const frame = $('cmFrame');
    frame.src = '/check?embed=1&fresh=' + Date.now();
    pulse('cmPulse', 'fresh widget', 'on');

    this.textContent = 'New captchas loaded';
    setTimeout(() => {
      this.textContent = oldText;
      this.disabled = false;
    }, 900);
  });

  // ---------- rival cards ----------
  const CLASSIC = [['text', 'Distorted text'], ['math', 'Math'], ['grid', 'Image grid'], ['slider', 'Slider'], ['rotate', 'Rotate'], ['click', 'Click in order'], ['checkbox', 'Bare checkbox'], ['pow', 'Proof of work']];
  const rivalCount = {};
  grid.innerHTML = CLASSIC.map(([t, name]) => '<div class="lr-card" data-type="' + t + '"><div class="lr-card-h"><b>' + name + '</b><span class="spacer"></span><span class="lr-count mono"></span><button class="sm ghost" data-new title="Load a fresh puzzle">Refresh</button></div><div class="lr-price mono" data-price></div><div class="body"></div><div class="lr-res"></div></div>').join('');

  function result(card, r) {
    const el = card.querySelector('.lr-res');
    if (r.status !== 200) { el.className = 'lr-res'; el.textContent = (r.body && r.body.reason) || 'Error'; return; }
    const ms = r.body.elapsedMs ? ' (' + (r.body.elapsedMs / 1000).toFixed(1) + ' s)' : '';
    el.className = 'lr-res ' + (r.body.ok ? (isHuman() ? 'ok' : 'bad') : 'ok');
    el.textContent = (r.body.ok ? (isHuman() ? 'Passed: ' : 'Bypassed: ') : 'Rejected: ') + r.body.reason + ms;
    setTimeout(() => load(card), 2600);
  }
  async function load(card) {
    const type = card.getAttribute('data-type');
    const body = card.querySelector('.body');
    card.querySelector('.lr-res').textContent = '';
    const s = await post('/api/arena/start', { type });
    if (s.status !== 200) { body.innerHTML = '<p class="note">' + esc(s.body.reason || 'Could not load') + '</p>'; return; }
    const P = s.body.params, session = s.body.session;
    const verify = async (answer, extra) => result(card, await post('/api/arena/verify', { session, answer, extra }));
    const prompt = '<p class="lr-prompt">' + esc(P.prompt) + '</p>';
    if (P.input === 'text') {
      body.innerHTML = prompt + '<img alt="captcha image" src="' + P.image + '"><div class="answer"><input aria-label="answer" autocomplete="off"><button class="sm">Verify</button></div>';
      const inp = body.querySelector('input');
      body.querySelector('button').onclick = () => verify(inp.value);
      inp.onkeydown = e => { if (e.key === 'Enter') verify(inp.value); };
    } else if (P.input === 'grid') {
      body.innerHTML = prompt + '<div class="gridcap"><img alt="image grid" src="' + P.image + '"><div class="cells">' + Array.from({ length: 9 }, (_, i) => '<button aria-label="tile ' + (i + 1) + '" data-i="' + i + '"></button>').join('') + '</div></div><div class="answer"><button class="sm">Verify</button></div>';
      body.querySelectorAll('.cells button').forEach(b => { b.onclick = () => b.classList.toggle('sel'); });
      body.querySelector('.answer button').onclick = () => verify([...body.querySelectorAll('.cells button.sel')].map(b => b.dataset.i).join(','));
    } else if (P.input === 'slider') {
      body.innerHTML = prompt + '<div class="slidecap"><img alt="slider puzzle" src="' + P.image + '" style="width:100%"><div class="piece"></div></div><input type="range" min="0" max="' + (P.width - P.pieceSize) + '" value="0" aria-label="slider"><div class="answer"><button class="sm">Verify</button></div>';
      const img = body.querySelector('img'), piece = body.querySelector('.piece'), range = body.querySelector('input');
      const place = () => { const k = (img.clientWidth || P.width) / P.width; piece.style.width = piece.style.height = P.pieceSize * k + 'px'; piece.style.top = P.pieceY * k + 'px'; piece.style.left = range.value * k + 'px'; };
      img.onload = place; range.oninput = place; place();
      body.querySelector('.answer button').onclick = () => verify(range.value);
    } else if (P.input === 'rotate') {
      body.innerHTML = prompt + '<img alt="tilted picture" src="' + P.image + '" style="width:110px;border-radius:50%"><input type="range" min="0" max="359" value="0" aria-label="rotation"><div class="answer"><button class="sm">Verify</button></div>';
      const img = body.querySelector('img'), range = body.querySelector('input');
      range.oninput = () => { img.style.transform = 'rotate(' + range.value + 'deg)'; };
      body.querySelector('.answer button').onclick = () => verify(Number(range.value));
    } else if (P.input === 'click') {
      body.innerHTML = prompt + '<div style="position:relative"><img alt="shapes to click" src="' + P.image + '" style="width:100%;cursor:crosshair"><div class="marks"></div></div><div class="answer"><button class="sm ghost" data-clear>Clear</button><button class="sm">Verify</button></div>';
      const img = body.querySelector('img'), marks = body.querySelector('.marks');
      let pts = [];
      img.onclick = e => {
        if (pts.length >= 3) return;
        const r = img.getBoundingClientRect(), k = P.width / r.width;
        pts.push({ x: Math.round((e.clientX - r.left) * k), y: Math.round((e.clientY - r.top) * k) });
        marks.insertAdjacentHTML('beforeend', '<span class="mk" style="left:' + (e.clientX - r.left - 10) + 'px;top:' + (e.clientY - r.top - 10) + 'px">' + pts.length + '</span>');
      };
      body.querySelector('[data-clear]').onclick = () => { pts = []; marks.innerHTML = ''; };
      body.querySelector('.answer button:not([data-clear])').onclick = () => verify(pts);
    } else if (P.input === 'checkbox') {
      body.innerHTML = '<label class="checkcap"><input type="checkbox"> I&apos;m not a robot</label>';
      let moves = 0;
      const mm = () => { moves++; };
      document.addEventListener('pointermove', mm);
      body.querySelector('input').onchange = () => { document.removeEventListener('pointermove', mm); verify('checked', { moves, webdriver: navigator.webdriver === true }); };
    } else if (P.input === 'pow') {
      body.innerHTML = prompt + '<div class="answer"><button class="sm">Run proof of work</button></div>';
      body.querySelector('button').onclick = async () => {
        const enc = new TextEncoder();
        for (let n = 0; n < 5e6; n++) {
          const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(P.salt + ':' + n)));
          let z = 0;
          for (const b of h) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
          if (z >= P.bits) return verify(n);
        }
      };
    }
  }
  grid.addEventListener('click', e => { const b = e.target.closest('[data-new]'); if (b) load(b.closest('.lr-card')); });
  grid.querySelectorAll('.lr-card').forEach(load);

  function flashCard(type, e) {
    const card = grid.querySelector('.lr-card[data-type="' + type + '"]');
    if (!card) return;
    if (e.bypass) {
      rivalCount[type] = (rivalCount[type] || 0) + 1;
      card.querySelector('.lr-count').textContent = rivalCount[type] + 'x beaten';
      card.classList.remove('hit'); void card.offsetWidth; card.classList.add('hit');
      const res = card.querySelector('.lr-res');
      res.className = 'lr-res bad';
      res.textContent = 'Bypassed by ' + e.attacker + ' · cost them $' + (e.cost || 0).toFixed(4);
    }
  }

  // ---------- stats ----------
  let stats = { bypass: 0, spend: 0, blocked: 0, through: 0 };
  function renderStats() {
    $('stBypass').textContent = stats.bypass;
    $('stSpend').textContent = '$' + stats.spend.toFixed(stats.spend < 1 ? 4 : 2);
    $('stBlocked').textContent = stats.blocked;
    $('stThrough').textContent = stats.through;
  }

  const sessionId = 'CM-' + Date.now().toString(36).slice(-6).toUpperCase();
  $('lrSession').textContent = 'SESSION · ' + sessionId;
  function tickClock() {
    $('lrClock').textContent = new Date().toISOString().slice(11, 19);
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- consoles ----------
  const t = ms => { const d = new Date(ms); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };
  function line(where, e) {
    const box = $(where === 'cm' ? 'cmConsole' : where === 'l2' ? 'l2Console' : 'rivalConsole');
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const div = document.createElement('div');
    div.className = 'ln ' + e.level + (e.final ? ' fin' : '') + ' s-' + e.side;
    const who = e.side === 'l2' ? 'layer 2 · ' + e.type : e.side === 'atk' ? 'attacker' : e.side === 'rival' ? (e.layer === 'CM' ? 'captchame shadow' : 'rival') : e.type;
    div.innerHTML = '<span class="ts">' + t(e.at) + '</span><span class="ly">' + esc(e.layer) + '</span><span class="tag">' + esc(who) + ' · ' + esc(String(e.attacker || '').replace(/^Sim: /, '')) + (e.sid && e.sid !== '-' ? ' · ' + esc(e.sid.slice(0, 6)) : '') + '</span><span class="tx">' + esc(e.text) + '</span>';
    box.appendChild(div);
    while (box.childElementCount > 500) box.firstElementChild.remove();
    if (stick) box.scrollTop = box.scrollHeight;
  }

  // ---------- layer stack ----------
  let focus = null, focusDone = false;
  const attempts = new Map();
  const layerEls = {};
  $('layers').querySelectorAll('li').forEach(li => { layerEls[li.dataset.layer] = li; });
  function resetLayers(sid) {
    focus = sid;
    for (const li of Object.values(layerEls)) { li.className = 'idle'; li.dataset.rank = '-1'; li.querySelector('.lr-ltext').textContent = sid ? '...' : 'waiting'; }
  }
  function applyLayer(e) {
    const li = layerEls[e.layer];
    if (!li) return;
    const r = RANK[e.level] ?? 0, cur = Number(li.dataset.rank);
    if (r >= cur) {
      li.dataset.rank = String(r);
      li.className = 'on ' + (e.level === 'pass' ? 'ok' : e.level);
      li.querySelector('.lr-ltext').textContent = e.text;
    }
    li.classList.remove('blink'); void li.offsetWidth; li.classList.add('blink');
  }
  function pulse(id, text, cls) { const el = $(id); el.textContent = text; el.className = 'lr-pulse ' + (cls || 'on'); clearTimeout(el._t); el._t = setTimeout(() => { el.className = 'lr-pulse'; el.textContent = 'idle'; }, 4000); }

  // ---------- visual: last attempt ----------
  const vizCv = $('vizCv'), vctx = vizCv.getContext('2d');
  let vizAnim = 0;
  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, Math.round(r.width)), h = Math.round(w * 0.42);
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px'; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, c };
  }
  function clearViz() {
    cancelAnimationFrame(vizAnim);
    const { w, h, c } = fitCanvas(vizCv);
    c.clearRect(0, 0, w, h);
    c.fillStyle = css('--faint'); c.font = '13px ' + css('--font-body');
    c.fillText('No attempt yet. Pass or attack the CaptchaMe widget.', 16, h / 2);
    $('vizLabel').textContent = '';
  }
  function drawViz(e) {
    cancelAnimationFrame(vizAnim);
    const v = e.viz || {};
    const { w, h, c } = fitCanvas(vizCv);
    const bot = e.verdict !== 'pass';
    $('vizLabel').textContent = (bot ? 'BLOCK ' : 'PASS ') + e.score + '/100 · ' + String(e.attacker || '').replace(/^Sim: /, '');
    const tgC = css('--human'), cuC = bot ? css('--bot') : css('--agent'), grid2 = css('--line-2'), txt = css('--muted');
    if (v.path && v.path.cursor && v.path.cursor.length > 1) {
      const P = v.path, n = P.cursor.length;
      const X = x => 10 + x * (w * 0.62 - 20), Y = y => 10 + y * (h - 20);
      const t0 = performance.now(), dur = 1600;
      (function frame(now) {
        const k = Math.min(1, (now - t0) / dur), m = Math.max(2, Math.round(n * k));
        c.clearRect(0, 0, w, h);
        c.strokeStyle = grid2; c.strokeRect(10, 10, w * 0.62 - 20, h - 20);
        c.lineWidth = 2; c.setLineDash([5, 4]); c.strokeStyle = tgC; c.beginPath();
        for (let i = 0; i < m; i++) { const p = P.target[i]; i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])); }
        c.stroke(); c.setLineDash([]);
        c.strokeStyle = cuC; c.lineWidth = 2; c.beginPath();
        for (let i = 0; i < m; i++) { const p = P.cursor[i]; i ? c.lineTo(X(p[1]), Y(p[2])) : c.moveTo(X(p[1]), Y(p[2])); }
        c.stroke();
        // dart moments
        for (const at of P.darts || []) {
          const i = P.cursor.findIndex(p => p[0] >= at);
          if (i >= 0 && i < m) { const p = P.target[i]; c.fillStyle = css('--warn'); c.beginPath(); c.arc(X(p[0]), Y(p[1]), 6, 0, 7); c.fill(); }
        }
        const head = P.cursor[m - 1]; c.fillStyle = cuC; c.beginPath(); c.arc(X(head[1]), Y(head[2]), 5, 0, 7); c.fill();
        // right panel: distance to target over time
        const x0 = w * 0.62 + 6, pw = w - x0 - 10;
        c.fillStyle = txt; c.font = '11px ' + css('--font-mono');
        c.fillText('gap to target', x0, 22);
        c.strokeStyle = grid2; c.strokeRect(x0, 30, pw, h - 60);
        let maxD = 0.05; const ds = P.cursor.map((p, i) => { const d = Math.hypot(p[1] - P.target[i][0], p[2] - P.target[i][1]); maxD = Math.max(maxD, d); return d; });
        c.strokeStyle = cuC; c.lineWidth = 1.5; c.beginPath();
        for (let i = 0; i < m; i++) { const xx = x0 + (i / (n - 1)) * pw, yy = 30 + (h - 60) - (ds[i] / maxD) * (h - 64); i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
        c.stroke();
        c.fillStyle = txt;
        c.fillText('lag ' + (P.lagMs ?? '?') + ' ms' + (P.lagMs === 0 ? '  <- no human is that fast' : ''), x0, h - 14);
        if (k < 1) vizAnim = requestAnimationFrame(frame);
      })(t0);
      return;
    }
    const rts = (v.rts || []).filter(x => x !== null && Number.isFinite(x));
    const offs = v.offsets || [];
    c.clearRect(0, 0, w, h);
    if (rts.length || offs.length) {
      const isOff = !rts.length, vals = isOff ? offs : rts;
      const lo = isOff ? -300 : 0, hi = isOff ? 300 : 1200;
      const X = x => 20 + ((Math.max(lo, Math.min(hi, x)) - lo) / (hi - lo)) * (w - 40);
      c.fillStyle = css('--brand-soft');
      if (isOff) c.fillRect(X(-120), 30, X(40) - X(-120), h - 70); else c.fillRect(X(150), 30, X(450) - X(150), h - 70);
      c.strokeStyle = grid2; c.beginPath(); c.moveTo(20, h - 40); c.lineTo(w - 20, h - 40); c.stroke();
      c.fillStyle = txt; c.font = '11px ' + css('--font-mono');
      for (let g = lo; g <= hi; g += isOff ? 100 : 200) { c.fillText(String(g), X(g) - 8, h - 24); }
      c.fillText(isOff ? 'tap offset from the beat (ms)' : 'reaction time per signal (ms)', 20, 20);
      vals.forEach((r, i) => { c.fillStyle = cuC; c.beginPath(); c.arc(X(r), 50 + (i % 6) * ((h - 110) / 6), 6, 0, 7); c.fill(); });
      return;
    }
    c.fillStyle = txt; c.font = '13px ' + css('--font-body');
    c.fillText('No drawable data for this attempt: ' + ((e.reasons || [])[0] || e.text).slice(0, 80), 16, h / 2);
  }

  // ---------- live sensor on the embedded widget ----------
  const sCv = $('sensorCv');
  const trail = [];
  let sensor = { n: 0, untrusted: 0, teleports: 0, turns: 0, coalesced: 0, lastV: null, lastDir: null, speeds: [], clicks: 0, clicksNoPath: 0, lastMoveAt: 0 };
  function sensorLine(level, text) { line('cm', { at: Date.now(), layer: 'S', level, text, side: 'sensor', type: 'sensor', attacker: label(), sid: '-' }); }
  function attachSensor() {
    const f = $('cmFrame');
    let w;
    try { w = f.contentWindow; if (!w || !w.document) return; } catch { return; }
    w.addEventListener('pointermove', ev => {
      const now = performance.now();
      const ce = ev.getCoalescedEvents ? ev.getCoalescedEvents().length : 1;
      sensor.coalesced += ce;
      if (!ev.isTrusted) { sensor.untrusted++; if (sensor.untrusted === 1) sensorLine('block', 'pointer event with isTrusted=false: generated by page script, not a device'); }
      const p = { x: ev.clientX, y: ev.clientY, t: now, W: w.innerWidth, H: w.innerHeight };
      const prev = trail[trail.length - 1];
      if (prev) {
        const dx = p.x - prev.x, dy = p.y - prev.y, dist = Math.hypot(dx, dy), dt = Math.max(1, now - prev.t);
        if (dist > 160 && dt < 40) { sensor.teleports++; sensorLine('flag', 'pointer jumped ' + Math.round(dist) + ' px in ' + Math.round(dt) + ' ms with no path between: a teleport, typical of agent clicks'); }
        const v = dist / dt; p.v = v; sensor.speeds.push(v); if (sensor.speeds.length > 120) sensor.speeds.shift();
        const dir = Math.atan2(dy, dx);
        if (sensor.lastDir !== null && dist > 1.5) { let d = Math.abs(dir - sensor.lastDir); if (d > Math.PI) d = 2 * Math.PI - d; if (d > 0.35) sensor.turns++; }
        if (dist > 1.5) sensor.lastDir = dir;
      }
      sensor.n++; sensor.lastMoveAt = now;
      trail.push(p); if (trail.length > 240) trail.shift();
    }, { passive: true });
    w.addEventListener('pointerdown', ev => {
      sensor.clicks++;
      if (!ev.isTrusted) sensorLine('block', 'click with isTrusted=false: synthetic click');
      else if (performance.now() - sensor.lastMoveAt > 1500 || !trail.length) { sensor.clicksNoPath++; sensorLine('flag', 'click at (' + ev.clientX + ',' + ev.clientY + ') with no pointer approach: element was targeted directly'); }
      trail.push({ x: ev.clientX, y: ev.clientY, t: performance.now(), W: w.innerWidth, H: w.innerHeight, click: true });
    }, { passive: true });
  }
  $('cmFrame').addEventListener('load', attachSensor);
  attachSensor();
  let lastReport = 0;
  (function sensorFrame() {
    const { w, h, c } = fitCanvas(sCv);
    c.clearRect(0, 0, w, h);
    const now = performance.now();
    const live = trail.filter(p => now - p.t < 2500);
    c.strokeStyle = css('--line-2'); c.strokeRect(0.5, 0.5, w - 1, h - 1);
    for (let i = 1; i < live.length; i++) {
      const a = live[i - 1], b = live[i];
      const fade = 1 - (now - b.t) / 2500;
      const v = b.v || 0;
      c.strokeStyle = v > 2.2 ? css('--warn') : css('--agent');
      c.globalAlpha = Math.max(0.05, fade); c.lineWidth = 2;
      c.beginPath(); c.moveTo(a.x / a.W * w, a.y / a.H * h); c.lineTo(b.x / b.W * w, b.y / b.H * h); c.stroke();
    }
    c.globalAlpha = 1;
    live.filter(p => p.click).forEach(p => { c.strokeStyle = css('--brand'); c.beginPath(); c.arc(p.x / p.W * w, p.y / p.H * h, 9, 0, 7); c.stroke(); });
    if (!live.length) { c.fillStyle = css('--faint'); c.font = '13px ' + css('--font-body'); c.fillText('No movement in the widget right now.', 16, h / 2); }
    if (now - lastReport > 250) {
      lastReport = now;
      const sp = sensor.speeds, m = sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : 0, peak = sp.length ? Math.max(...sp) : 0;
      const rate = live.length > 1 ? (live.length / ((live[live.length - 1].t - live[0].t) / 1000 || 1)) : 0;
      $('sensorOut').innerHTML = [
        'events <b>' + sensor.n + '</b>', 'rate <b>' + rate.toFixed(0) + '/s</b>', 'speed <b>' + m.toFixed(2) + '</b> px/ms',
        'peak/mean <b>' + (m ? (peak / m).toFixed(1) : '-') + '</b>', 'turns <b>' + sensor.turns + '</b>',
        'coalesced <b>' + (sensor.n ? (sensor.coalesced / sensor.n).toFixed(1) : '-') + '</b>',
        'teleports <b class="' + (sensor.teleports ? 'warn' : '') + '">' + sensor.teleports + '</b>',
        'untrusted <b class="' + (sensor.untrusted ? 'bad' : '') + '">' + sensor.untrusted + '</b>',
      ].join('<span class="sep">·</span>');
      $('sensorTrust').textContent = sensor.untrusted ? 'synthetic input seen' : sensor.n ? 'device input' : '';
    }
    requestAnimationFrame(sensorFrame);
  })();

  // ---------- feed ----------
  let since = 0;
  function handle(e) {
    if (e.side === 'cm') {
      const list = attempts.get(e.sid) || [];
      list.push(e); attempts.set(e.sid, list);
      if (attempts.size > 60) attempts.delete(attempts.keys().next().value);
      if (e.final || (e.sid !== focus && (focus === null || focusDone))) {
        // show this attempt's whole layer picture
        resetLayers(e.sid); focusDone = !!e.final;
        list.forEach(applyLayer);
      } else if (e.sid === focus) applyLayer(e);
      line('cm', e);
      pulse('cmPulse', e.layer + ' ' + (e.level === 'block' ? 'blocking' : 'reading'), e.level === 'block' ? 'bad' : 'on');
      if (e.final) {
        if (e.verdict === 'pass') { if (!/^\s*(human|person)\b/i.test(e.attacker || '')) stats.through++; }
        else stats.blocked++;
        renderStats(); drawViz(e);
        pulse('cmPulse', e.verdict === 'pass' ? 'PASS' : 'BLOCK', e.verdict === 'pass' ? 'ok' : 'bad');
      }
    } else if (e.side === 'rival') {
      line('rival', e);
      if (e.level === 'bypass') pulse('rvPulse', 'bypassed: ' + e.type, 'bad');
      if (e.final) {
        if (e.bypass) { stats.bypass++; stats.spend += e.cost || 0; renderStats(); }
        flashCard(e.type, e);
      }
    } else if (e.side === 'l2') {
      line('l2', e);
      pulse('l2Pulse', e.l2 ? e.l2.cls.replace('_', ' ') : 'packet', e.level === 'block' ? 'bad' : e.level === 'ok' ? 'ok' : 'on');
    } else if (e.side === 'atk') {
      line('rival', e);
      if (/finished$/.test(e.text)) { const b = BOTS.find(x => x.label === e.attacker); if (b) { running.delete(b.id); renderSims(); } }
    }
  }
  async function poll() {
    try {
      const r = await fetch('/api/live/feed?since=' + since, { cache: 'no-store' });
      const j = await r.json();
      for (const e of j.events || []) { handle(e); since = Math.max(since, e.seq); }
      if (j.seq < since) since = 0; // server restarted
    } catch { /* keep polling */ }
    setTimeout(poll, document.hidden ? 2000 : 450);
  }

  (async () => {
    try {
      const j = await (await fetch('/api/live/bots', { cache: 'no-store' })).json();
      BOTS = j.bots || []; MARKET = j.market || {};
      (j.running || []).forEach(id => running.add(id));
    } catch { /* simulators unavailable */ }
    renderSims();
    grid.querySelectorAll('.lr-card').forEach(card => { const m = MARKET[card.dataset.type]; if (m) card.querySelector('[data-price]').textContent = m.price + ' · ' + m.speed + ' to solve'; });
    clearViz(); renderStats();
    poll();
  })();
  window.addEventListener('resize', () => { if (!$('vizLabel').textContent) clearViz(); });
  window.addEventListener('cm-theme', () => { if (!$('vizLabel').textContent) clearViz(); });
})();
