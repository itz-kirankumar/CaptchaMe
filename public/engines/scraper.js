(function () {
  'use strict';
  const grid = document.getElementById('catalog');
  if (!grid) return;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // Prove this browser ran the page's JavaScript, and give it a stable visitor id.
  if (!/(?:^|; )cm_vid=/.test(document.cookie)) document.cookie = 'cm_vid=' + Math.random().toString(36).slice(2, 12) + '; Path=/; SameSite=Lax; Max-Age=86400';
  document.cookie = 'cm_js=1; Path=/; SameSite=Lax; Max-Age=86400';
  const cmd = document.getElementById('curlCmd');
  if (cmd) cmd.textContent = cmd.textContent.replace('http://localhost:3000', location.origin);

  let page = 1, pages = 1;
  function showMine(res, body) {
    const d = res.headers.get('x-captchame-shield') || (res.status === 429 ? 'block' : 'allow');
    const risk = +(res.headers.get('x-captchame-risk') || 0);
    const el = document.getElementById('myDecision');
    el.className = 'decision ' + d; el.textContent = d;
    document.getElementById('myRisk').textContent = risk;
    document.getElementById('myRiskMark').style.left = Math.min(98, risk) + '%';
    document.getElementById('myReasons').textContent = res.status === 429 ? (body.reason || 'Blocked') : (d === 'allow' ? 'Ran the page’s JavaScript, normal pace.' : 'Slowed or decoyed: see the shield log.');
  }
  const RES = { pass: 'human', allow: 'human', fail: 'bot', block: 'bot', slow: 'warn', decoy: 'warn' };
  async function loadPage() {
    const res = await fetch('/api/catalog?page=' + page, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    showMine(res, body);
    document.getElementById('pageNo').textContent = page;
    if (!res.ok) { grid.innerHTML = '<tr><td colspan="4" class="empty">' + esc(body.reason || 'Blocked') + '</td></tr>'; return; }
    pages = body.pages || 1;
    document.getElementById('pageCount').textContent = pages;
    grid.innerHTML = (body.items || []).length ? body.items.map(it =>
      '<tr><td class="mono small">' + esc(new Date(it.at).toLocaleTimeString()) + '</td><td>' + esc(it.summary) + '</td><td>' + (it.result ? '<span class="chip ' + (RES[it.result] || '') + '">' + esc(it.result) + '</span>' : '<span class="dim">-</span>') + '</td><td class="small">' + esc(it.tool || '') + '</td></tr>').join('')
      : '<tr><td colspan="4" class="empty">Nothing judged yet. Pass a check on the risk ladder page, or point a scraper here, and it appears.</td></tr>';
  }
  document.getElementById('prev').onclick = () => { if (page > 1) { page--; loadPage(); } };
  document.getElementById('next').onclick = () => { if (page < pages) { page++; loadPage(); } };
  loadPage();

  // Live shield log and visitor table (admin: they hold visitors' details).
  let since = 0;
  const seen = [];
  async function poll() {
    if (!document.body.contains(grid)) return;
    try {
      if (!window.CMAdmin.key()) {
        document.getElementById('shieldFeed').innerHTML = '<div class="empty">The shield log shows visitors&rsquo; details, so it needs the admin key. <button class="sm ghost" id="unlockShield">Unlock</button></div>';
        document.getElementById('unlockShield').onclick = () => { window.CMAdmin.gate(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        return; // polling resumes after the key is entered (the page reloads)
      }
      const [ev, st] = await Promise.all([
        window.CMAdmin.api('/api/admin/events?since=' + since, { gate: false }).then(r => r.json()),
        window.CMAdmin.api('/api/admin/shield', { gate: false }).then(r => r.json()),
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
    } catch { /* no key yet, or offline: keep polling */ }
    setTimeout(poll, 1500);
  }
  poll();
})();
