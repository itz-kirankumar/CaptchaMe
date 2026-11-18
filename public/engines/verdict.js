'use strict';
// Shared verdict: a HUMAN / BOT stamp with the score and the reasons.
// Declared as global functions (safe to load more than once across pages).
function cmVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function verdict(outEl, res, opts) {
  opts = opts || {};
  const b = res.body || {};
  outEl.innerHTML = '';
  const pass = b.result === 'pass';
  const wrap = document.createElement('div');
  wrap.className = 'verdict ' + (pass ? 'vpass' : 'vfail');

  const stamp = document.createElement('div');
  stamp.className = 'stamp';
  stamp.textContent = pass ? 'HUMAN' : 'BOT';
  wrap.appendChild(stamp);

  const head = document.createElement('div');
  head.className = 'vhead';
  head.textContent = pass ? "You're good to go." : 'This did not look like a live person.';
  wrap.appendChild(head);

  const sc = document.createElement('div');
  sc.className = 'vscore';
  const score = Math.max(0, Math.min(100, b.score || 0));
  sc.innerHTML = '<span>humanness score</span><div class="vbar"><i style="width:' + score + '%"></i></div><b>' + (b.score == null ? 0 : b.score) + '/100</b>';
  wrap.appendChild(sc);

  let flags = (b.flags || []).slice(0, 4);
  if (!pass && !flags.length && b.reason) flags = [b.reason];
  if (!pass && flags.length) {
    const lab = document.createElement('div');
    lab.className = 'vwhylabel';
    lab.textContent = 'Why CaptchaMe called it:';
    wrap.appendChild(lab);
    const ul = document.createElement('ul');
    ul.className = 'vwhy';
    for (const f of flags) { const li = document.createElement('li'); li.textContent = f; ul.appendChild(li); }
    wrap.appendChild(ul);
  }

  const note = document.createElement('div');
  note.className = 'vnote';
  note.textContent = pass
    ? (typeof b.budget_added === 'number' ? '$' + b.budget_added.toFixed(2) + ' added to your allowance on the demo API.' : '')
    : (opts.failHint || 'You can retry, or use another path.');
  wrap.appendChild(note);

  if (opts.next !== false && !opts.embed) {
    const nx = document.createElement('div');
    nx.className = 'vnext';
    nx.innerHTML = pass
      ? '<a class="btn sm ghost" href="/arena">Now try to beat it in the arena</a><a class="btn sm ghost" href="/analytics">See it in analytics</a>'
      : '<a class="btn sm ghost" href="/voice">Use the voice path</a><a class="btn sm ghost" href="/appeal">Appeal</a>';
    wrap.appendChild(nx);
  }

  outEl.appendChild(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (pass && !opts.quiet) confettiBurst();
  return pass;
}

function confettiBurst() {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = innerWidth; c.height = innerHeight;
  document.body.appendChild(c);
  const x = c.getContext('2d');
  const colors = [cmVar('--human') || '#d4ff3a', cmVar('--agent') || '#3cd3ff', '#ffffff', cmVar('--appeal') || '#b197fc'];
  const parts = [];
  for (let i = 0; i < 130; i++) {
    parts.push({ x: innerWidth / 2 + (Math.random() - .5) * 240, y: innerHeight * 0.35, vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 4, s: Math.random() * 7 + 3, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3, col: colors[Math.random() * colors.length | 0] });
  }
  const t0 = performance.now();
  (function tick() {
    const el = performance.now() - t0;
    x.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += .35; p.r += p.vr;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.col; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); x.restore();
    }
    if (el < 2200) requestAnimationFrame(tick); else c.remove();
  })();
}
