(function () {
  'use strict';
  const grid = document.getElementById('catalog');
  if (!grid) return;
  const KEY = new URLSearchParams(location.search).get('key') || 'demo-admin';
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // Prove this browser ran the page's JavaScript, and give it a stable visitor id.
  if (!/(?:^|; )cm_vid=/.test(document.cookie)) document.cookie = 'cm_vid=' + Math.random().toString(36).slice(2, 12) + '; Path=/; SameSite=Lax; Max-Age=86400';
  document.cookie = 'cm_js=1; Path=/; SameSite=Lax; Max-Age=86400';
  const cmd = document.getElementById('curlCmd');
  if (cmd) cmd.textContent = cmd.textContent.replace('http://localhost:3000', location.origin);

  let page = 1;
  function showMine(res, body) {
    const d = res.headers.get('x-captchame-shield') || (res.status === 429 ? 'block' : 'allow');
    const risk = +(res.headers.get('x-captchame-risk') || 0);
    const el = document.getElementById('myDecision');
    el.className = 'decision ' + d; el.textContent = d;
    document.getElementById('myRisk').textContent = risk;
    document.getElementById('myRiskMark').style.left = Math.min(98, risk) + '%';
    document.getElementById('myReasons').textContent = res.status === 429 ? (body.reason || 'Blocked') : (d === 'allow' ? 'Ran the page’s JavaScript, normal pace.' : 'Slowed or decoyed: see the shield log.');
  }
  async function loadPage() {
    const res = await fetch('/api/catalog?page=' + page, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    // Tell the shield this browser really loaded the page (its JS and assets).
    // The server scores this observed beacon, not a caller-supplied flag.
    fetch('/api/shield/beacon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    showMine(res, body);
    document.getElementById('pageNo').textContent = page;
    if (!res.ok) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + esc(body.reason || 'Blocked') + '</div>'; return; }
    grid.innerHTML = body.items.map(it => {
      const hue = (parseInt(it.sku.replace(/\D/g, ''), 10) * 47) % 360;
      return '<div class="book' + (/CANARY/.test(it.sku) ? ' canary' : '') + '"><div class="cover" style="background:linear-gradient(135deg,hsl(' + hue + ',55%,45%),hsl(' + ((hue + 60) % 360) + ',55%,30%))"></div><b>' + esc(it.title) + '</b><div class="meta"><span>' + esc(it.author) + '</span><span class="mono">$' + it.price.toFixed(2) + '</span></div></div>';
    }).join('');
  }
  document.getElementById('prev').onclick = () => { if (page > 1) { page--; loadPage(); } };
  document.getElementById('next').onclick = () => { if (page < 50) { page++; loadPage(); } };
  loadPage();

  // One-click scraper: no cookies, sequential pages, as fast as it can go.
  const log = document.getElementById('burstLog');
  function line(cls, text) { const d = document.createElement('div'); d.innerHTML = '<span class="tag ' + cls + '">' + cls + '</span>'; d.appendChild(document.createTextNode(text)); log.prepend(d); }
  document.getElementById('burst').onclick = async e => {
    e.target.disabled = true; log.innerHTML = '';
    for (let p = 1; p <= 15; p++) {
      const r = await fetch('/api/catalog?page=' + p, { credentials: 'omit', cache: 'no-store', headers: { 'X-CM-Attacker': 'Simulated scraper' } });
      const d = r.headers.get('x-captchame-shield') || '?';
      const b = await r.json().catch(() => ({}));
      line(d === 'allow' ? 'pass' : d === 'block' ? 'fail' : 'scrape', 'page ' + p + ' -> ' + r.status + ' ' + d.toUpperCase() + (b.canary ? ' (canary ' + b.canary + ')' : '') + (r.status === 429 ? ': ' + (b.reason || '').slice(0, 90) : ''));
    }
    e.target.disabled = false;
  };
  document.getElementById('trapBtn').onclick = async () => {
    const r = await fetch('/api/catalog/item/trap-collectors', { credentials: 'omit', headers: { 'X-CM-Attacker': 'Simulated DOM reader' } });
    const b = await r.json().catch(() => ({}));
    line('fail', 'hidden link -> ' + r.status + ': ' + (b.reason || '').slice(0, 110));
  };

  // Live shield log and visitor table.
  let since = 0;
  const seen = [];
  async function poll() {
    if (!document.body.contains(grid)) return;
    try {
      const h = { 'X-Admin-Key': KEY };
      const [ev, st] = await Promise.all([
        fetch('/api/admin/events?since=' + since, { headers: h }).then(r => r.json()),
        fetch('/api/admin/shield', { headers: h }).then(r => r.json()),
      ]);
      for (const e of ev.events || []) {
        since = Math.max(since, e.seq);
        if (e.lane === 'shield' || e.type === 'scrape') seen.unshift(e);
      }
      if (seen.length) {
        document.getElementById('shieldFeed').innerHTML = seen.slice(0, 60).map(e => '<div><span class="tag ' + (e.decision === 'allow' ? 'pass' : e.decision === 'block' || e.type === 'trap' ? 'fail' : 'scrape') + '">' + esc(e.decision || e.type) + '</span>' + esc(new Date(e.at).toLocaleTimeString() + '  ' + e.message) + '</div>').join('');
      }
      if (st.actors && st.actors.length) {
        document.getElementById('shieldActors').innerHTML = st.actors.slice(0, 14).map(a => '<tr><td><code>' + esc(a.key) + '</code><div class="small dim">' + esc(a.ua || 'no user agent') + '</div></td><td class="mono">' + a.score + '</td><td><span class="decision ' + a.decision + '">' + a.decision + '</span></td><td class="mono">' + a.requestsLastMinute + '</td></tr>').join('');
      }
    } catch { /* keep polling */ }
    setTimeout(poll, 1500);
  }
  poll();
})();
