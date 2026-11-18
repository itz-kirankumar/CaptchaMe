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
        const d = 'M' + x0 + ' ' + y0 + ' C' + c1x + ' ' + y0 + ' ' + c2x + ' ' + y1 + ' ' + x1 + ' ' + y1;
        const id = 'cv' + (side < 0 ? 'l' : 'r') + i;
        out += '<path id="' + id + '" d="' + d + '" style="animation-duration:' + (22 + i * 2) + 's"/>';
        if (!reduce) {
          const vi = i % 4 === 1;
          out += '<circle class="' + (vi ? 'vi' : 'sq') + '" r="' + (vi ? 3.2 : 2.4) + '"><animateMotion dur="' + (9 + (i * 1.7) % 7) + 's" begin="-' + (i * 1.3) + 's" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#' + id + '"/></animateMotion></circle>';
        }
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
    sel.innerHTML = BOTS.map(b => '<option value="' + esc(b.id) + '">' + esc(b.label.replace(/^Sim: /, '')) + '</option>').join('');
    note();
  })();
  function note() { const b = BOTS.find(x => x.id === sel.value); sug.innerHTML = b ? '<b>' + esc(b.label.replace(/^Sim: /, '')) + '</b> ' + esc(b.blurb) : 'Loading attackers...'; }
  sel.addEventListener('change', note);

  // ---------- the nine steps ----------
  const STEPS = [
    ['L0', 'Read the request', 'Who asked, and which check the server picked at random.'],
    ['L1', 'Read the network', 'Headers, client hints, header count and address.'],
    ['L2', 'Seal the challenge', 'Signed, single use, with a schedule only the server knows.'],
    ['L3', 'Probe the browser', 'Automation flags, window, plugins, languages.'],
    ['L4', 'Judge the response', 'Reaction lag, corrections and the path itself.'],
    ['L5', 'Check live timing', 'The wall clock and the signed live receipts.'],
    ['L6', 'Bind to one browser', 'Same browser, no replay, no relay.'],
    ['L7', 'Decide', 'Pass token and dollar cap, or a block with a reason.'],
    ['P2', 'Layer 2: who really was that?', 'Merge into one identity, name the bypass family, decide what comes next.'],
  ];
  const modal = $('runModal'), stepsEl = $('thSteps'), progEl = $('thProg'), listEl = $('thList'), mainEl = $('thMain'), statEl = $('thStat');
  const RANK = { info: 0, ok: 1, pass: 1, flag: 2, bypass: 3, block: 3 };
  let run = null;

  function buildHeader() {
    stepsEl.innerHTML = '<span class="th-logo"><svg width="22" height="22" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="#5b3cf5" stroke-opacity=".3" stroke-width="3"/><path d="M12.24 5.66A11 11 0 0 1 23.78 8.22" fill="none" stroke="#5b3cf5" stroke-width="3" stroke-linecap="round"/><circle cx="23.78" cy="8.22" r="3.4" fill="#5b3cf5"/></svg></span>' +
      STEPS.map(([, t], i) => '<span class="th-st" data-i="' + i + '"><button class="th-dot" data-go="' + i + '" aria-label="Step ' + (i + 1) + ': ' + esc(t) + '"><span class="n">' + (i + 1) + '</span><span class="lb">' + esc(t) + '</span></button></span>' + (i < STEPS.length - 1 ? '<span class="th-line"></span>' : '')).join('') +
      '<button class="th-x" id="thClose" aria-label="Close">&times;</button>';
    progEl.innerHTML = STEPS.map(() => '<i></i>').join('');
    $('thClose').onclick = close;
  }
  function stepState(i) {
    const s = run.steps[i];
    if (!s.lines.length) return '';
    const worst = Math.max(...s.lines.map(l => RANK[l.level] ?? 0));
    return worst >= 3 ? 'bad' : worst === 2 ? 'warn' : '';
  }
  function paint() {
    const sts = stepsEl.querySelectorAll('.th-st'), lines = stepsEl.querySelectorAll('.th-line'), segs = progEl.children;
    STEPS.forEach((_, i) => {
      const s = run.steps[i], done = s.done;
      sts[i].className = 'th-st' + (done ? ' done ' + stepState(i) : '') + (run.sel === i ? ' sel ' + (done ? stepState(i) : '') : '');
      if (lines[i]) lines[i].classList.toggle('fill', done);
      segs[i].className = done ? 'on' : (i === run.active ? 'act' : '');
    });
    // list
    const items = STEPS.map((st, i) => {
      const s = run.steps[i]; if (!s.shown) return '';
      const worst = s.lines.length ? s.lines.reduce((a, l) => (RANK[l.level] ?? 0) >= (RANK[a.level] ?? 0) ? l : a, s.lines[0]) : null;
      const mark = s.done ? '&#10003;' : '&middot;';
      return '<button class="th-li ' + stepState(i) + (run.sel === i ? ' sel' : '') + '" data-go="' + i + '"><span class="h"><b>' + mark + '</b>step ' + (i + 1) + ' &middot; ' + esc(st[1]) + '</span>' + (worst ? '<span class="s">' + esc(brief(worst.text)) + '</span>' : '') + '</button>';
    }).join('');
    listEl.innerHTML = items + (run.finished ? '' : '<div class="th-wait"><span class="th-spin"></span>' + esc(run.waitText) + '</div>');
    renderMain();
  }
  const brief = t => { t = String(t); return t.length > 96 ? t.slice(0, 94) + '...' : t; };
  const ICON = { ok: '&#10003;', pass: '&#10003;', flag: '!', block: '&times;', info: '&middot;', bypass: '&times;' };
  let mainFor = -1, mainCount = -1;
  function renderMain() {
    const i = run.sel, s = run.steps[i], st = STEPS[i];
    if (mainFor === i && mainCount === s.lines.length && !(run.finished && !run.rendered)) return;
    const same = mainFor === i, prevCount = same ? mainCount : 0; mainFor = i; mainCount = s.lines.length;
    const head = '<div class="at">Step ' + (i + 1) + ' of 9 &middot; read live at ' + new Date().toTimeString().slice(0, 8) + '</div><h2>' + esc(st[1]) + '</h2><p class="sub">' + esc(sumLine(i)) + '</p>';
    const badge = !s.lines.length ? '' : stepState(i) === 'bad' ? '<span class="th-badge bad">Flagged</span>' : stepState(i) === 'warn' ? '<span class="th-badge warn">Doubtful</span>' : '<span class="th-badge ok">&#10003; Clean</span>';
    let card = '<div class="th-card' + (same ? ' still' : '') + '"><div class="top"><span class="ttl">' + esc(st[0] === 'P2' ? 'Identity' : st[0] + ' ' + st[1]) + '</span>' + badge + '</div>' +
      '<div class="th-lines">' + (s.lines.length ? s.lines.map((l, k) => '<div class="th-ln ' + esc(l.level) + (k < prevCount ? ' still' : '') + '" style="animation-delay:' + (same ? 0 : Math.min(k, 14) * 45) + 'ms"><i>' + (ICON[l.level] || '&middot;') + '</i><span>' + esc(l.text) + '</span></div>').join('') : '<div class="th-wait"><span class="th-spin"></span>Waiting for this step. ' + esc(run.waitText) + '</div>') + '</div>';
    if (i === 7 && run.verdict) card += '<div class="th-kv"><div><small>Verdict</small><b>' + (run.verdict.verdict === 'pass' ? 'Pass' : 'Block') + '</b><span>score ' + run.verdict.score + '/100</span></div><div><small>Attacker</small><b>' + esc(run.label.replace(/^Sim: /, '')) + '</b><span>as labelled</span></div><div><small>Next</small><b>' + (run.verdict.verdict === 'pass' ? 'Layer 2 decides' : 'Refused') + '</b><span>' + (run.verdict.verdict === 'pass' ? 'a pass is not the end' : 'no token issued') + '</span></div></div>';
    if (i === 8 && run.l2) { const v = run.l2; card += '<div class="th-kv"><div><small>Class</small><b>' + esc(v.cls.replace(/_/g, ' ')) + '</b><span>' + Math.round(v.conf * 100) + '% sure</span></div><div><small>Decision</small><b>' + esc(v.decision.replace('_', ' ')) + '</b><span>' + esc(v.why) + '</span></div><div><small>One client</small><b>' + v.identities.ips + ' address' + (v.identities.ips === 1 ? '' : 'es') + '</b><span>' + v.identities.uas + ' browser name' + (v.identities.uas === 1 ? '' : 's') + ', ' + v.identities.merged + ' merged</span></div></div>'; }
    mainEl.innerHTML = head + card + '</div>';
    if (run.finished) run.rendered = true;
  }
  const sumLine = i => {
    const s = run.steps[i];
    if (!s.lines.length) return STEPS[i][2];
    if (i === 7 && run.verdict) return run.verdict.verdict === 'pass' ? 'Passed layer 1 with ' + run.verdict.score + '/100. Layer 2 still gets a say.' : 'Blocked with ' + run.verdict.score + '/100. ' + brief((run.verdict.reasons || [])[0] || '');
    if (i === 8 && run.l2) return run.l2.cls.replace(/_/g, ' ') + ' (' + Math.round(run.l2.conf * 100) + '%): ' + run.l2.why;
    return STEPS[i][2];
  };

  function feed(e) {
    const idx = STEPS.findIndex(x => x[0] === e.layer);
    if (e.side === 'cm' && idx >= 0 && idx <= 7) {
      if (!run.sid) run.sid = e.sid;
      if (e.sid !== run.sid) return;
      const s = run.steps[idx]; s.lines.push({ level: e.level === 'pass' ? 'ok' : e.level, text: e.text }); s.shown = true;
      if (e.final) { run.verdict = { verdict: e.verdict, score: e.score, reasons: e.reasons }; }
    } else if (e.side === 'l2' && run.sid && e.sid === run.sid && e.final) {
      run.l2 = e.l2; const s = run.steps[8]; s.lines.push({ level: e.level, text: e.text }); s.shown = true;
    }
  }
  async function reveal() {
    // play the steps in order so the stepper always feels alive, even when the server answers in a burst
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8], my = run;
    for (const i of order) {
      if (run !== my) return;
      const s = run.steps[i];
      while (!s.lines.length && !run.timedOut) { run.active = i; run.waitText = i <= 2 ? 'Starting the attack...' : i < 8 ? 'The attacker is acting on the challenge...' : 'Layer 2 is merging the packets...'; if (!run.userSel) run.sel = Math.min(i, run.sel === i ? i : run.sel); paint(); await sleep(250); }
      if (run.timedOut && !s.lines.length) { s.lines.push({ level: 'flag', text: 'No data arrived for this step before the run ended.' }); s.shown = true; }
      s.shown = true; if (!run.userSel) run.sel = i; run.active = i; paint();
      await sleep(reduce ? 0 : (i === 0 ? 450 : 650));
      s.done = true; paint();
    }
    run.finished = true; run.active = -1; run.sel = run.userSel ? run.sel : 8; mainFor = -1; paint();
    statEl.textContent = run.l2 ? 'Run complete. Identity ' + run.l2.subject + ' is ' + run.l2.cls.replace(/_/g, ' ') + ', ' + run.l2.decision.replace('_', ' ') + '.' : 'Run complete. Use the steps above to look back through it.';
    $('thAgain').hidden = false;
  }
  async function start() {
    const b = BOTS.find(x => x.id === sel.value); if (!b) return;
    const id = Date.now();
    run = { id, cur: id, label: b.label, steps: STEPS.map(() => ({ lines: [], done: false, shown: false })), sel: 0, active: 0, sid: null, verdict: null, l2: null, finished: false, waitText: 'Starting the attack...', userSel: false, timedOut: false };
    mainFor = -1; mainCount = -1;
    buildHeader(); statEl.textContent = 'Attacking as ' + b.label.replace(/^Sim: /, '') + '. Every line below is read live from the server.'; $('thAgain').hidden = true;
    modal.hidden = false; document.body.classList.add('th-lock'); paint();
    // remember where the feed is BEFORE the attack starts, so no early line is missed
    let since = 0;
    try { since = (await (await fetch('/api/live/feed?since=999999999', { cache: 'no-store' })).json()).seq || 0; } catch { /* ignore */ }
    const r = await post('/api/live/simulate', { bot: b.id });
    if (r.status !== 202) { statEl.textContent = (r.body && r.body.reason) || 'Could not start that attacker. Try again in a moment.'; run.steps[0].lines.push({ level: 'flag', text: statEl.textContent }); run.steps[0].shown = true; run.timedOut = true; }
    // poll the public live feed for this attacker
    const t0 = Date.now();
    reveal();
    (async function poll() {
      if (!run || run.id !== id) return;
      try {
        const j = await (await fetch('/api/live/feed?since=' + since, { cache: 'no-store' })).json();
        for (const e of j.events || []) { since = Math.max(since, e.seq); if (e.attacker === b.label && e.at >= id - 1500) feed(e); }
      } catch { /* keep trying */ }
      if (run.steps[8].lines.length || Date.now() - t0 > 40000) { if (!run.steps[8].lines.length) run.timedOut = true; return; }
      setTimeout(poll, 350);
    })();
  }
  function close() { modal.hidden = true; document.body.classList.remove('th-lock'); run = null; }
  form.addEventListener('submit', e => { e.preventDefault(); start(); });
  $('thAgain').addEventListener('click', () => { close(); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  modal.addEventListener('click', e => {
    if (e.target === modal) return close();
    const g = e.target.closest('[data-go]'); if (g && run) { const i = Number(g.dataset.go); if (run.steps[i].shown || i === run.active) { run.sel = i; run.userSel = !run.finished; mainFor = -1; paint(); } }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();
