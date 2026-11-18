(function () {
  'use strict';
  const feed = document.getElementById('feed');
  if (!feed) return;
  const admin = window.CMAdmin;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  let since = 0;
  async function pull() {
    if (!document.body.contains(feed)) return;
    try {
      const [ev, ac, ap, su] = await Promise.all([
        admin.api('/api/admin/events?since=' + since).then(r => r.json()),
        admin.api('/api/admin/actors').then(r => r.json()),
        admin.api('/api/admin/appeals').then(r => r.json()),
        admin.api('/api/admin/signups').then(r => r.json()),
      ]);
      if (su.signups) {
        document.getElementById('s-signups').textContent = su.signups.length;
        document.getElementById('signups').innerHTML = su.signups.length ? su.signups.slice(0, 100).map(x => '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.email) + '</td><td>' + esc(x.via || '') + '</td><td class="mono">' + esc(new Date(x.at).toLocaleString()) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">No requests yet. They arrive from the form on the risk ladder page.</td></tr>';
      }
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
    await admin.api('/api/admin/appeal/' + b.dataset.ap, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: b.dataset.act }) }).catch(() => {});
  });
  pull();
})();
