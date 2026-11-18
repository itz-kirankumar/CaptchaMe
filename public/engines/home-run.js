(function () {
  'use strict';
  const form = document.getElementById('runForm');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- section reveal ----------
  const rv = [...document.querySelectorAll('.block, .cta-big, .statband')];
  rv.forEach(el => el.classList.add('rv'));
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
    rv.forEach(el => io.observe(el));
  } else rv.forEach(el => el.classList.add('in'));

  // ---------- hero curves with travelling dots ----------
  const svg = $('thCurves');
  function curves() {
    if (!svg) return;
    const box = svg.parentElement.getBoundingClientRect();
    const W = Math.max(900, window.innerWidth), H = Math.max(520, box.height);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const cy = H * 0.62, cx = W / 2, n = 9;
    let out = '';
    for (const side of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const k = (i - (n - 1) / 2) / ((n - 1) / 2);
        const x0 = side < 0 ? -20 : W + 20, y0 = cy + k * H * 0.55 - H * 0.12;
        const x1 = cx + side * 480, y1 = cy + k * 14;
        const c1x = x0 + (x1 - x0) * 0.55, c2x = x0 + (x1 - x0) * 0.8;
        const id = 'cv' + (side < 0 ? 'l' : 'r') + i;
        out += '<path id="' + id + '" d="M' + x0 + ' ' + y0 + ' C' + c1x + ' ' + y0 + ' ' + c2x + ' ' + y1 + ' ' + x1 + ' ' + y1 + '" style="animation-duration:' + (22 + i * 2) + 's"/>';
        if (!reduce) { const vi = i % 4 === 1; out += '<circle class="' + (vi ? 'vi' : 'sq') + '" r="' + (vi ? 3.2 : 2.4) + '"><animateMotion dur="' + (9 + (i * 1.7) % 7) + 's" begin="-' + (i * 1.3) + 's" repeatCount="indefinite"><mpath href="#' + id + '"/></animateMotion></circle>'; }
      }
    }
    svg.innerHTML = out;
  }
  curves(); let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(curves, 200); });

  // ---------- attackers ----------
  const sel = $('runBot'), sug = $('runSug');
  let BOTS = [];
  const ALLOWED = ['script', 'farm', 'headless', 'agent', 'adaptive'];
  (async () => {
    try { BOTS = (await (await fetch('/api/live/bots', { cache: 'no-store' })).json()).bots.filter(b => ALLOWED.includes(b.id)); } catch { /* offline */ }
    sel.innerHTML = '<option value="person">You, as a person (follow the ring)</option>' + BOTS.map(b => '<option value="' + esc(b.id) + '">' + esc(b.label.replace(/^Sim: /, '')) + '</option>').join('');
    note();
    buildDropdown();
  })();

  // ---------- custom dropdown (the native select stays underneath for state and forms) ----------
  function buildDropdown() {
    const bar = $('runForm');
    if (bar.querySelector('.dd')) return;
    sel.classList.add('dd-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    const dd = document.createElement('div'); dd.className = 'dd';
    const first = s => String(s || '').split(/[.:]/)[0].slice(0, 70);
    const items = [{ v: 'person', t: 'You, as a person', d: 'Follow the ring with your pointer', g: 'You' }].concat(BOTS.map(b => ({ v: b.id, t: b.label.replace(/^Sim: /, ''), d: first(b.blurb), g: 'Attackers' })));
    dd.innerHTML = '<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false"><span class="dd-cur"></span><svg class="dd-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button><ul class="dd-list" role="listbox" tabindex="-1" hidden></ul>';
    sel.after(dd);
    const btn = dd.querySelector('.dd-btn'), list = dd.querySelector('.dd-list'), cur = dd.querySelector('.dd-cur');
    let lastG = '', html = '';
    items.forEach((it, i) => { if (it.g !== lastG) { html += '<li class="dd-g" role="presentation">' + esc(it.g) + '</li>'; lastG = it.g; } html += '<li class="dd-o" role="option" data-v="' + esc(it.v) + '" data-i="' + i + '"><i class="dd-dot ' + (it.v === 'person' ? 'p' : 'b') + '"></i><span><b>' + esc(it.t) + '</b><small>' + esc(it.d) + '</small></span><svg class="dd-ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></li>'; });
    list.innerHTML = html;
    const opts = [...list.querySelectorAll('.dd-o')];
    let hi = 0;
    function paint() { const v = sel.value; const it = items.find(x => x.v === v) || items[0]; cur.innerHTML = '<i class="dd-dot ' + (it.v === 'person' ? 'p' : 'b') + '"></i>' + esc(it.t); opts.forEach((o, i) => { o.setAttribute('aria-selected', o.dataset.v === v ? 'true' : 'false'); o.classList.toggle('hi', i === hi); }); }
    function open() { list.hidden = false; btn.setAttribute('aria-expanded', 'true'); dd.classList.add('open'); hi = Math.max(0, opts.findIndex(o => o.dataset.v === sel.value)); paint(); }
    function shut() { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); dd.classList.remove('open'); }
    function pick(i) { sel.value = opts[i].dataset.v; sel.dispatchEvent(new Event('change')); paint(); shut(); btn.focus(); }
    btn.addEventListener('click', () => (list.hidden ? open() : shut()));
    list.addEventListener('click', e => { const o = e.target.closest('.dd-o'); if (o) pick(Number(o.dataset.i)); });
    list.addEventListener('mousemove', e => { const o = e.target.closest('.dd-o'); if (o) { hi = Number(o.dataset.i); opts.forEach((x, i) => x.classList.toggle('hi', i === hi)); } });
    dd.addEventListener('keydown', e => {
      if (e.key === 'Escape') { shut(); btn.focus(); return; }
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); if (list.hidden) { open(); return; } hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length; paint(); opts[hi].scrollIntoView({ block: 'nearest' }); }
      if ((e.key === 'Enter' || e.key === ' ') && !list.hidden) { e.preventDefault(); pick(hi); }
    });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) shut(); });
    sel.addEventListener('change', paint);
    paint();
  }

  function note() { if (sel.value === 'person') { sug.innerHTML = '<b>You</b> Follow the moving ring with your pointer when it appears. A person passes; layer 2 then confirms you are one.'; return; } const b = BOTS.find(x => x.id === sel.value); sug.innerHTML = b ? '<b>' + esc(b.label.replace(/^Sim: /, '')) + '</b> ' + esc(b.blurb) : 'Loading attackers...'; }
  sel.addEventListener('change', note);

  // ---------- the run: one stream ----------
  const STEPS = [
    ['L0', 'Request', 'Who asked, which check the server picked'],
    ['L1', 'Network', 'Headers, client hints, address'],
    ['L2', 'Sealed challenge', 'Signed, single use, hidden schedule'],
    ['L3', 'Browser probe', 'Automation flags, window, plugins'],
    ['L4', 'Response shape', 'Reaction lag, corrections, path'],
    ['L5', 'Live timing', 'Wall clock, signed live receipts'],
    ['L6', 'Binding', 'Same browser, no replay, no relay'],
    ['L7', 'Decision', 'Pass token, cap, or a block with a reason'],
    ['P2', 'Layer 2 identity', 'One identity, bypass family, decision'],
  ];
  const RANK = { info: 0, ok: 1, pass: 1, flag: 2, bypass: 3, block: 3 };
  const modal = $('runModal'), rail = $('rnRail'), term = $('rnTerm'), verdictEl = $('rnVerdict'), stepEl = $('rnStep'), titleEl = $('rnTitle');
  const GLYPH = '01#$%&@<>/\\|=+*';
  let run = null, rainStop = null;

  // text decode: random glyphs resolve left to right
  function decode(el, text, ms) {
    if (reduce) { el.textContent = text; return Promise.resolve(); }
    return new Promise(res => {
      const t0 = performance.now(), n = text.length;
      (function f(now) {
        const k = Math.min(1, (now - t0) / ms), done = Math.floor(k * n);
        let s = text.slice(0, done);
        for (let i = done; i < Math.min(n, done + 8); i++) s += text[i] === ' ' ? ' ' : GLYPH[Math.floor(Math.random() * GLYPH.length)];
        el.textContent = s + (k < 1 ? '' : '');
        if (k < 1) requestAnimationFrame(f); else { el.textContent = text; res(); }
      })(t0);
    });
  }
  // faint matrix rain behind the terminal
  function rain(cv) {
    const c = cv.getContext('2d'); let on = true;
    const fit = () => { cv.width = cv.clientWidth; cv.height = cv.clientHeight; };
    fit();
    const col = 16, cols = Math.ceil(cv.width / col), y = Array.from({ length: cols }, () => Math.random() * cv.height);
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#d4ff3a';
    (function f() {
      if (!on) return;
      c.fillStyle = 'rgba(0,0,0,.12)'; c.globalCompositeOperation = 'destination-out'; c.fillRect(0, 0, cv.width, cv.height); c.globalCompositeOperation = 'source-over';
      c.fillStyle = brand; c.font = '13px "JetBrains Mono", monospace';
      for (let i = 0; i < cols; i++) { c.fillText(GLYPH[Math.floor(Math.random() * GLYPH.length)], i * col, y[i]); y[i] = y[i] > cv.height + Math.random() * 400 ? 0 : y[i] + 14; }
      setTimeout(() => requestAnimationFrame(f), 70);
    })();
    return () => { on = false; };
  }

  function buildRail() { rail.innerHTML = STEPS.map((s, i) => '<i title="' + esc(s[0] + ' ' + s[1]) + '"></i>').join(''); }
  function railSet(i, cls) { const el = rail.children[i]; if (el) el.className = cls; }
  function addEl(cls, html) { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; const w = term.querySelector('.rn-wait'); w ? term.insertBefore(d, w) : term.appendChild(d); return d; }
  function toBottom() { term.scrollTop = term.scrollHeight; }
  const ICON = { ok: '&#10003;', pass: '&#10003;', flag: '!', block: '&times;', info: '&rsaquo;', bypass: '&times;' };

  async function play(my) {
    let cur = -1, waitEl = null; const groups = {};
    const setWait = txt => { if (!waitEl) { waitEl = document.createElement('div'); waitEl.className = 'rn-wait'; term.appendChild(waitEl); } waitEl.innerHTML = '<span class="rn-cur"></span> ' + esc(txt); toBottom(); };
    const clearWait = () => { if (waitEl) { waitEl.remove(); waitEl = null; } };
    while (run === my) {
      const ev = my.queue.shift();
      if (!ev) {
        if (my.done) break;
        if (Date.now() - my.t0 > 45000) { my.timedOut = true; break; }
        setWait(cur < 2 ? 'starting the attack' : cur < 8 ? 'the attacker is acting on the challenge' : 'merging packets into one identity');
        await sleep(140); continue;
      }
      clearWait();
      if (!groups[ev.idx]) {
        const g = document.createElement('div'); g.className = 'rn-g';
        g.innerHTML = '<div class="rn-h">' + esc(STEPS[ev.idx][0]) + ' &middot; ' + esc(STEPS[ev.idx][1]) + '</div>';
        const later = Object.keys(groups).map(Number).filter(k => k > ev.idx).sort((x, y) => x - y)[0];
        if (later != null) term.insertBefore(g, groups[later]); else { const w = term.querySelector('.rn-wait'); w ? term.insertBefore(g, w) : term.appendChild(g); }
        groups[ev.idx] = g;
      }
      if (ev.idx >= cur) {
        cur = ev.idx;
        stepEl.innerHTML = '<b>' + String(cur + 1).padStart(2, '0') + '/09</b> ' + esc(STEPS[cur][0]) + ' &middot; ' + esc(STEPS[cur][1]) + ' <span>' + esc(STEPS[cur][2]) + '</span>';
      }
      my.worst[ev.idx] = Math.max(my.worst[ev.idx] || 0, RANK[ev.level] ?? 0);
      railSet(ev.idx, my.worst[ev.idx] >= 3 ? 'bad' : my.worst[ev.idx] === 2 ? 'warn' : ev.idx === cur ? 'act' : 'ok');
      if (my.worst[ev.idx] >= 3 && (my.stopped == null || ev.idx < my.stopped.idx)) my.stopped = { idx: ev.idx, text: ev.text };
      const d = document.createElement('div'); d.className = 'rn-ln ' + ev.level; d.innerHTML = '<i>' + (ICON[ev.level] || '&rsaquo;') + '</i><span></span>';
      groups[ev.idx].appendChild(d);
      toBottom();
      await decode(d.querySelector('span'), ev.text, Math.min(700, 120 + ev.text.length * 7));
      if (ev.level === 'block' && !reduce) { d.classList.add('hit'); modal.querySelector('.rn-sheet').classList.add('shake'); setTimeout(() => modal.querySelector('.rn-sheet').classList.remove('shake'), 420); }
      await sleep(reduce ? 0 : 70);
    }
    clearWait();
    if (run !== my) return;
    for (let i = 0; i < STEPS.length; i++) if (my.worst[i] !== undefined) railSet(i, my.worst[i] >= 3 ? 'bad' : my.worst[i] === 2 ? 'warn' : 'ok');
    finish(my);
  }

  function finish(my) {
    const l2 = my.l2, l1 = my.verdict;
    const dec = l2 ? l2.decision : (l1 && l1.verdict === 'pass' ? 'allow' : 'block');
    const word = { allow: 'ALLOWED', step_up: 'STEP-UP', block: 'BLOCKED', slow: 'SLOWED', limit: 'LIMITED' }[dec] || 'DONE';
    const bad = dec === 'block', warn = dec === 'step_up' || dec === 'slow' || dec === 'limit';
    stepEl.innerHTML = '<b>RUN COMPLETE</b> <span>' + (l2 ? 'identity ' + esc(l2.subject) : '') + '</span>';
    const where = my.stopped ? '<div class="rn-where"><small>STOPPED AT</small><b>' + esc(STEPS[my.stopped.idx][0]) + ' &middot; ' + esc(STEPS[my.stopped.idx][1]) + '</b><code>' + esc(my.stopped.text) + '</code></div>' : (l1 && l1.verdict === 'pass' && l2 && l2.decision !== 'allow' ? '<div class="rn-where"><small>PASSED LAYER 1, CAUGHT BY LAYER 2</small><b>P2 &middot; Layer 2 identity</b><code>' + esc(l2.why) + '</code></div>' : '');
    verdictEl.innerHTML = '<div class="rn-vrow"><div class="rn-word ' + (bad ? 'bad' : warn ? 'warn' : 'ok') + '" data-t="' + word + '">' + word + '</div>' +
      (l2 ? '<div class="rn-who"><b>' + esc(l2.cls.replace(/_/g, ' ')) + '</b><span>' + Math.round(l2.conf * 100) + '% sure &middot; ' + l2.identities.ips + ' address' + (l2.identities.ips === 1 ? '' : 'es') + ' &middot; ' + l2.identities.uas + ' browser name' + (l2.identities.uas === 1 ? '' : 's') + '</span></div>' : '') +
      '<div class="rn-act"><button class="btn ghost" id="rnAgain">Run another</button><a class="btn accent" href="/layer2">Layer 2 analysis</a></div></div>' + where;
    verdictEl.classList.add('on');
    if (l2 && l2.subject) { if (bad || warn) setTimeout(() => openFail(l2.subject, where, my, bad), 1500); else showAnalytics(l2.subject); }
    $('rnAgain').onclick = () => { close(); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  }

  // layer 2 analytics, appended under the run
  async function showAnalytics(id) {
    let d; try { const r = await fetch('/api/live/analysis/' + encodeURIComponent(id), { cache: 'no-store' }); if (!r.ok) return; d = await r.json(); } catch { return; }
    if (!run) return;
    const bad = d.decision === 'block', warn = d.decision === 'step_up' || d.decision === 'slow';
    const ev = (d.evidence || []).slice(0, 8).map(e => '<tr><td class="mono">' + esc(e.layer) + '</td><td class="mono">' + esc(e.code) + '</td><td>' + esc(e.text || '') + '</td></tr>').join('');
    const el = document.createElement('div'); el.className = 'rn-an';
    el.innerHTML = '<div class="rn-h">P2 &middot; Layer 2 analytics</div>' +
      '<div class="rn-ankv"><div><small>Identity</small><b class="mono">' + esc(d.id) + '</b></div><div><small>Class</small><b>' + esc(d.cls.replace(/_/g, ' ')) + ' &middot; ' + Math.round(d.conf * 100) + '%</b></div><div><small>Decision</small><b class="' + (bad ? 'b' : warn ? 'w' : 'g') + '">' + esc(d.decision.replace('_', ' ')) + '</b></div><div><small>One client</small><b>' + d.identities.ips + ' address' + (d.identities.ips === 1 ? '' : 'es') + ', ' + d.identities.uas + ' browser name' + (d.identities.uas === 1 ? '' : 's') + '</b></div><div><small>Cost caused</small><b>$' + Number(d.usd || 0).toFixed(4) + '</b></div><div><small>Layer 1</small><b>' + d.challenges.passes + ' pass, ' + d.challenges.fails + ' fail</b></div></div>' +
      '<p class="rn-anwhy">' + esc(d.why) + '</p>' +
      (ev ? '<table class="rn-antbl"><thead><tr><th>Layer</th><th>Evidence</th><th>What it saw</th></tr></thead><tbody>' + ev + '</tbody></table>' : '') +
      '<a class="btn ghost sm" href="/layer2">Open the full layer 2 analysis</a>';
    term.appendChild(el); toBottom();
    return el;
  }
  // the failed-run screen: a moment of Uh-oh, then straight to the analysis page with this identity open
  function openFail(id, where, my, blocked) {
    if (run !== my) return;
    const sheet = modal.querySelector('.rn-sheet');
    const f = document.createElement('div'); f.className = 'rn-fail';
    f.innerHTML = '<div class="rn-oops" data-t="UH-OH">UH-OH</div>' +
      '<p class="rn-oopsp">' + (blocked ? 'That request failed.' : 'That request was held back.') + ' Opening the analysis...</p>' + where +
      '<div class="rn-go"><i></i></div>' +
      '<div class="rn-fail-act"><button class="btn ghost" id="rnRaw">Stay on the raw run</button><button class="btn ghost" id="rnAgain2">Run another</button><a class="btn accent" href="/layer2?open=' + encodeURIComponent(id) + '">Open the analysis now</a></div>';
    sheet.appendChild(f);
    const t = setTimeout(() => { location.href = '/layer2?open=' + encodeURIComponent(id); }, reduce ? 800 : 2600);
    f.querySelector('#rnRaw').onclick = () => { clearTimeout(t); f.remove(); };
    f.querySelector('#rnAgain2').onclick = () => { clearTimeout(t); close(); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  }

  function feed(e) {
    const idx = STEPS.findIndex(x => x[0] === e.layer);
    if (e.side === 'cm' && idx >= 0 && idx <= 7) {
      if (!run.sid) run.sid = e.sid;
      if (e.sid !== run.sid) return;
      run.queue.push({ idx, level: e.level === 'pass' ? 'ok' : e.level, text: e.text });
      if (e.final) run.verdict = { verdict: e.verdict, score: e.score };
    } else if (e.side === 'l2' && run.sid && e.sid === run.sid && e.final) {
      run.l2 = e.l2; run.queue.push({ idx: 8, level: e.level, text: e.text }); run.done = true;
    }
  }

  async function start() {
    const b = BOTS.find(x => x.id === sel.value); if (!b) return;
    const my = run = { label: b.label, queue: [], sid: null, verdict: null, l2: null, done: false, timedOut: false, worst: [], stopped: null, t0: Date.now() };
    buildRail(); term.innerHTML = ''; verdictEl.innerHTML = ''; verdictEl.classList.remove('on');
    titleEl.textContent = 'Attack run · ' + b.label.replace(/^Sim: /, '');
    stepEl.innerHTML = '<b>00/09</b> connecting <span>starting the attack</span>';
    modal.hidden = false; document.body.classList.add('th-lock');
    if (!reduce) rainStop = rain($('rnRain'));
    let since = 0;
    try { since = (await (await fetch('/api/live/feed?since=999999999', { cache: 'no-store' })).json()).seq || 0; } catch { /* ignore */ }
    const r = await post('/api/live/simulate', { bot: b.id });
    if (r.status !== 202) { my.queue.push({ idx: 0, level: 'flag', text: (r.body && r.body.reason) || 'Could not start that attacker. Try again in a moment.' }); my.done = true; }
    play(my);
    (async function poll() {
      if (run !== my || my.done) return;
      try {
        const j = await (await fetch('/api/live/feed?since=' + since, { cache: 'no-store' })).json();
        for (const e of j.events || []) { since = Math.max(since, e.seq); if (e.attacker === b.label && e.at >= my.t0 - 1500) feed(e); }
      } catch { /* keep trying */ }
      setTimeout(poll, 300);
    })();
  }
  function close() { modal.hidden = true; document.body.classList.remove('th-lock'); run = null; if (rainStop) { rainStop(); rainStop = null; } }
  const lvApp = $('lvapp');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (sel.value === 'person') {
      lvApp.hidden = false;
      const m = lvApp.querySelector('.lv-mode[data-lv-mode="human"]'), s = $('lvstart');
      if (m && s) { m.click(); s.click(); lvApp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return;
    }
    lvApp.hidden = true; start();
  });
  $('rnClose').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();
