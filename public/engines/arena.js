(function () {
  'use strict';
  const list = document.getElementById('classicList');
  if (!list) return;
  const PRESETS = ['Human', 'Buster', '2Captcha', 'CapSolver', 'NopeCHA', 'Computer-use agent', 'Comet', 'Claude in Chrome', 'Script'];
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

  // ---------- attacker label (cookie, so the embedded widget inherits it) ----------
  const getLabel = () => (document.cookie.match(/(?:^|; )cm_attacker=([^;]*)/) || [])[1];
  function setLabel(v) {
    const clean = String(v || '').replace(/[^\w .()+:-]/g, '').trim().slice(0, 40);
    document.cookie = 'cm_attacker=' + encodeURIComponent(clean) + '; Path=/; SameSite=Lax; Max-Age=86400';
    render();
  }
  const label = () => decodeURIComponent(getLabel() || '') || 'unlabelled';
  const isHuman = () => /human|person/i.test(label());
  function render() {
    document.getElementById('attackerNow').textContent = label();
    document.getElementById('pills').innerHTML = PRESETS.map(p => '<button class="pill' + (label() === p ? ' on' : '') + '" data-p="' + esc(p) + '">' + esc(p) + '</button>').join('');
  }
  document.getElementById('pills').addEventListener('click', e => { const p = e.target.closest('[data-p]'); if (p) setLabel(p.getAttribute('data-p')); });
  document.getElementById('attackerSet').addEventListener('click', () => setLabel(document.getElementById('attackerInput').value));
  document.getElementById('attackerInput').addEventListener('keydown', e => { if (e.key === 'Enter') setLabel(e.target.value); });
  if (!getLabel()) setLabel('Human'); else render();

  function result(el, r) {
    const ms = r.body && r.body.elapsedMs ? ' · ' + (r.body.elapsedMs / 1000).toFixed(1) + ' s' : '';
    if (r.status !== 200) { el.className = 'res'; el.textContent = (r.body && r.body.reason) || 'Error'; return; }
    if (r.body.ok) { el.className = 'res ' + (isHuman() ? 'no' : 'ok'); el.textContent = (isHuman() ? 'Passed: ' : 'Bypassed: this classic format let ' + label() + ' through. ') + r.body.reason + ms; }
    else { el.className = 'res'; el.textContent = 'Rejected: ' + r.body.reason + ms; }
  }

  // ---------- classic formats ----------
  const CLASSIC = [
    ['text', 'Distorted text'], ['grid', 'Image grid'], ['math', 'Math'], ['slider', 'Slider'],
    ['rotate', 'Rotate'], ['click', 'Click in order'], ['checkbox', 'Bare checkbox'], ['pow', 'Proof of work'],
  ];
  list.innerHTML = CLASSIC.map(([t, name]) => '<div class="cap" data-type="' + t + '"><div class="cap-head"><b>' + name + '</b><span class="spacer"></span><button class="sm ghost" data-new title="Load a fresh puzzle">Refresh</button></div><div class="body"></div><div class="res"></div></div>').join('');

  async function load(card) {
    const type = card.getAttribute('data-type');
    const body = card.querySelector('.body'), res = card.querySelector('.res');
    res.textContent = ''; res.className = 'res';
    const s = await post('/api/arena/start', { type });
    if (s.status !== 200) { body.innerHTML = '<p class="note">' + esc(s.body.reason || 'Could not load') + '</p>'; return; }
    const P = s.body.params, session = s.body.session;
    const verify = async (answer, extra) => result(res, await post('/api/arena/verify', { session, answer, extra }));
    const prompt = '<p class="note" style="margin:0 0 10px">' + esc(P.prompt) + '</p>';

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
      body.innerHTML = prompt + '<img alt="tilted picture" src="' + P.image + '" style="width:160px;border-radius:50%;transition:transform .05s"><input type="range" min="0" max="359" value="0" aria-label="rotation"><div class="answer"><button class="sm">Verify</button></div>';
      const img = body.querySelector('img'), range = body.querySelector('input');
      range.oninput = () => { img.style.transform = 'rotate(' + range.value + 'deg)'; };
      body.querySelector('.answer button').onclick = () => verify(Number(range.value));
    } else if (P.input === 'click') {
      body.innerHTML = prompt + '<div style="position:relative;width:320px;max-width:100%"><img alt="shapes to click" src="' + P.image + '" style="width:100%;cursor:crosshair"><div class="marks"></div></div><div class="answer"><button class="sm ghost" data-clear>Clear</button><button class="sm">Verify</button></div>';
      const img = body.querySelector('img'), marks = body.querySelector('.marks');
      let pts = [];
      img.onclick = e => {
        if (pts.length >= 3) return;
        const r = img.getBoundingClientRect(), k = P.width / r.width;
        pts.push({ x: Math.round((e.clientX - r.left) * k), y: Math.round((e.clientY - r.top) * k) });
        marks.insertAdjacentHTML('beforeend', '<span style="position:absolute;left:' + (e.clientX - r.left - 11) + 'px;top:' + (e.clientY - r.top - 11) + 'px;width:22px;height:22px;border-radius:50%;background:#2e86de;color:#fff;font:700 12px sans-serif;display:grid;place-items:center;pointer-events:none">' + pts.length + '</span>');
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
        res.className = 'res'; res.textContent = 'Computing...';
        const t0 = performance.now();
        const enc = new TextEncoder();
        for (let n = 0; n < 5e6; n++) {
          const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(P.salt + ':' + n)));
          let z = 0;
          for (const b of h) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
          if (z >= P.bits) { await verify(n); res.textContent += ' · computed in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s'; return; }
        }
      };
    }
  }
  list.addEventListener('click', e => { const b = e.target.closest('[data-new]'); if (b) load(b.closest('.cap')); });
  list.querySelectorAll('.cap').forEach(load);

  const refreshAll = document.getElementById('refreshAllCaptchas');
  refreshAll.addEventListener('click', async () => {
    if (refreshAll.disabled) return;
    refreshAll.disabled = true;
    const labelText = refreshAll.textContent;
    refreshAll.textContent = 'Loading fresh captchas...';

    await Promise.all(Array.from(list.querySelectorAll('.cap'), card => load(card)));

    const cmFrame = document.getElementById('cmFrame');
    cmFrame.src = '/check?embed=1&fresh=' + Date.now();

    refreshAll.textContent = 'All captchas refreshed';
    setTimeout(() => {
      refreshAll.textContent = labelText;
      refreshAll.disabled = false;
    }, 900);
  });

  // ---------- real vendor widgets (opt-in) ----------
  const VENDORS = [
    ['turnstile', 'Cloudflare Turnstile', 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', () => window.turnstile, (el, key, cb) => window.turnstile.render(el, { sitekey: key, callback: cb })],
    ['hcaptcha', 'hCaptcha', 'https://js.hcaptcha.com/1/api.js?render=explicit', () => window.hcaptcha, (el, key, cb) => window.hcaptcha.render(el, { sitekey: key, callback: cb })],
    ['recaptcha', 'Google reCAPTCHA v2', 'https://www.google.com/recaptcha/api.js?render=explicit', () => window.grecaptcha && window.grecaptcha.render, (el, key, cb) => window.grecaptcha.render(el, { sitekey: key, callback: cb })],
  ];
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const waitFor = (fn, ms = 8000) => new Promise((res, rej) => { const t0 = Date.now(); (function poll() { if (fn()) return res(); if (Date.now() - t0 > ms) return rej(new Error('timeout')); setTimeout(poll, 100); })(); });
  document.getElementById('loadVendors').addEventListener('click', async e => {
    e.target.disabled = true;
    const cfg = (await (await fetch('/api/arena/config')).json());
    const box = document.getElementById('vendorList');
    box.innerHTML = VENDORS.map(([id, name]) => '<div class="cap" data-v="' + id + '" style="margin-top:12px"><div class="cap-head"><b>' + name + '</b><span class="spacer"></span>' + (cfg[id].configured ? '<span class="chip">your key</span>' : '<span class="chip warn">not configured</span>') + '</div><div class="thirdparty-slot"></div><div class="res"></div></div>').join('');
    for (const [id, , src, ready, renderFn] of VENDORS) {
      const card = box.querySelector('[data-v="' + id + '"]'), slot = card.querySelector('.thirdparty-slot'), res = card.querySelector('.res');
      if (!cfg[id].configured) { res.innerHTML = '<p class="note small">No keys on this server, so there is nothing real to test. Set <code>' + esc(cfg[id].env) + '</code> and restart.</p>'; continue; }
      try {
        await loadScript(src);
        await waitFor(ready);
        renderFn(slot, cfg[id].siteKey, async token => result(res, await post('/api/arena/thirdparty', { provider: id, token })));
      } catch { res.textContent = 'Could not load this widget here (blocked or offline).'; }
    }
  });

  // ---------- scoreboard ----------
  async function scores() {
    const tbl = document.getElementById('matrix');
    if (!tbl) return;
    try {
      const { results } = await (await fetch('/api/arena/results', { cache: 'no-store' })).json();
      if (results && results.length) {
        const attackers = [...new Set(results.map(r => r.attacker))].sort();
        const formats = [...new Set(results.map(r => r.format))].sort((a, b) => (a.startsWith('captchame') ? 1 : 0) - (b.startsWith('captchame') ? 1 : 0) || a.localeCompare(b));
        const get = (f, a) => results.find(r => r.format === f && r.attacker === a);
        let html = '<thead><tr><th class="fmt">Format</th>' + attackers.map(a => '<th>' + esc(a) + '</th>').join('') + '</tr></thead><tbody>';
        for (const f of formats) {
          html += '<tr><td class="fmt"><span class="chip ' + (f.startsWith('captchame') ? 'human' : f.startsWith('classic') ? 'bot' : f === 'agent-lane' ? 'agent' : '') + '">' + esc(f) + '</span></td>';
          for (const a of attackers) {
            const r = get(f, a);
            if (!r) { html += '<td class="cell">-</td>'; continue; }
            const human = /human|person/i.test(a), n = r.pass + r.fail;
            const cls = r.pass === 0 ? 'f' : r.fail === 0 ? (human ? 'f' : 'p') : (human ? 'f' : 'm');
            html += '<td class="cell ' + cls + '">' + r.pass + '/' + n + ' passed</td>';
          }
          html += '</tr>';
        }
        tbl.innerHTML = html + '</tbody>';
      }
    } catch { /* keep polling */ }
    setTimeout(scores, 2500);
  }
  scores();
  document.getElementById('resetScores').addEventListener('click', async () => {
    if (!confirm('Reset the scoreboard, ledger, events and stats? Early-access requests are kept.')) return;
    let r; try { r = await window.CMAdmin.api('/api/admin/reset', { method: 'POST' }); } catch { return; }
    const b = await r.json().catch(() => ({}));
    if (!r.ok) alert(b.reason || 'Reset failed');
    document.getElementById('matrix').innerHTML = '<tbody><tr><td class="empty">No attempts yet. Pick an attacker and start.</td></tr></tbody>';
  });
})();
