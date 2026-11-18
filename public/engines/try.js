(function () {
  'use strict';
  const grid = document.getElementById('tryGrid');
  if (!grid) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  // A person is trying these by hand: the scoreboard should say so.
  document.cookie = 'cm_attacker=Human; Path=/; SameSite=Lax; Max-Age=86400';
  const isHuman = () => true;

  const CLASSIC = [['text', 'Distorted text'], ['math', 'Math'], ['grid', 'Image grid'], ['slider', 'Slider'], ['rotate', 'Rotate'], ['click', 'Click in order'], ['checkbox', 'Bare checkbox'], ['pow', 'Proof of work']];
  grid.innerHTML = CLASSIC.map(([t, name]) => '<div class="lr-card" data-type="' + t + '"><div class="lr-card-h"><b>' + name + '</b><span class="spacer"></span><button class="sm ghost" data-new title="Load a new one">New</button></div><div class="body"></div><div class="lr-res"></div></div>').join('');

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
  const all = () => Promise.all([...grid.querySelectorAll('.lr-card')].map(load));
  all();
  $('tryAll').addEventListener('click', async function () {
    this.disabled = true; const t = this.textContent; this.textContent = 'Loading...';
    await all(); $('tryCm').src = '/check?embed=1&fresh=' + Date.now(); $('tryPass').textContent = '';
    this.textContent = t; this.disabled = false;
  });
  $('tryCmNew').addEventListener('click', () => { $('tryCm').src = '/check?embed=1&fresh=' + Date.now(); $('tryPass').textContent = ''; });
  window.addEventListener('message', e => { if (e.data && e.data.type === 'captchame:pass') $('tryPass').textContent = 'CaptchaMe: passed (score ' + (e.data.score == null ? '?' : e.data.score) + ')'; });
})();
