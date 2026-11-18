(function () {
  'use strict';
  const feed = document.getElementById('feed');
  if (!feed) return;
  const KEY = new URLSearchParams(location.search).get('key') || 'demo-admin';
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  let since = 0;
  async function pull() {
    if (!document.body.contains(feed)) return;
    try {
      const h = { 'X-Admin-Key': KEY };
      const [ev, ac, ap] = await Promise.all([
        fetch('/api/admin/events?since=' + since, { headers: h }).then(r => r.json()),
        fetch('/api/admin/actors', { headers: h }).then(r => r.json()),
        fetch('/api/admin/appeals', { headers: h }).then(r => r.json()),
      ]);
      for (const e of ev.events || []) {
        since = Math.max(since, e.seq);
        const d = document.createElement('div');
        d.innerHTML = '<span class="tag ' + esc(e.type) + '">' + esc(e.type) + '</span>';
        d.appendChild(document.createTextNode(new Date(e.at).toLocaleTimeString() + '  ' + e.message));
        if (e.attacker && e.attacker !== 'unlabelled') { const w = document.createElement('span'); w.className = 'who'; w.textContent = '[' + e.attacker + ']'; d.appendChild(w); }
        feed.prepend(d);
      }
      while (feed.children.length > 300) feed.lastChild.remove();
      if (ac.actors) {
        document.getElementById('actors').innerHTML = ac.actors.map(a => '<tr><td><code>' + esc(a.id) + '</code></td><td><span class="chip ' + (a.kind === 'agent' ? 'agent' : a.kind === 'human' ? 'human' : '') + '">' + esc(a.kind) + '</span></td><td class="mono">$' + a.spent.toFixed(2) + '</td><td class="mono">$' + a.granted.toFixed(2) + '</td><td class="mono">$' + a.remaining.toFixed(2) + '</td><td class="mono">' + a.blocked + '</td></tr>').join('') || '<tr><td colspan="6" class="empty">No actors yet.</td></tr>';
        const s = ac.summary;
        document.getElementById('s-saved').textContent = '$' + s.estimatedSaved.toFixed(2);
        document.getElementById('s-blocked').textContent = s.blockedCalls;
        document.getElementById('s-actors').textContent = s.actors;
        document.getElementById('s-appeals').textContent = s.openAppeals;
      }
      if (ap.appeals) {
        document.getElementById('appeals').innerHTML = ap.appeals.length ? ap.appeals.map(a =>
          '<div><span class="tag appeal">#' + a.id + ' ' + esc(a.status) + '</span><code>' + esc(a.actorId) + '</code> ' + esc(a.message) +
          (a.status === 'open' ? ' <button class="sm" data-ap="' + a.id + '" data-act="approve">Approve +$1</button> <button class="sm ghost" data-ap="' + a.id + '" data-act="deny">Deny</button>' : '') + '</div>').join('') : '<div class="empty">No appeals yet.</div>';
      }
    } catch { /* keep polling */ }
    setTimeout(pull, 1200);
  }
  document.getElementById('appeals').addEventListener('click', async e => {
    const b = e.target.closest('[data-ap]');
    if (!b) return;
    b.disabled = true;
    await fetch('/api/admin/appeal/' + b.dataset.ap, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY }, body: JSON.stringify({ action: b.dataset.act }) });
  });
  pull();
})();
