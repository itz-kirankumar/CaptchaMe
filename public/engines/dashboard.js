const KEY = new URLSearchParams(location.search).get('key') || 'demo-admin';
let since = 0;
async function pull() {
  try {
    const h = { 'X-Admin-Key': KEY };
    const [ev, ac, ap] = await Promise.all([
      fetch('/api/admin/events?since=' + since, { headers: h }).then(r => r.json()),
      fetch('/api/admin/actors', { headers: h }).then(r => r.json()),
      fetch('/api/admin/appeals', { headers: h }).then(r => r.json()),
    ]);
    if (ev.events) {
      const feed = document.getElementById('feed');
      for (const e of ev.events) {
        since = Math.max(since, e.seq);
        const d = document.createElement('div');
        const t = new Date(e.at).toLocaleTimeString();
        d.innerHTML = `<span class="tag ${e.type}">${e.type}</span>`;
        d.appendChild(document.createTextNode(t + '  ' + e.message));
        feed.prepend(d);
      }
    }
    if (ac.actors) {
      document.getElementById('actors').innerHTML = ac.actors.map(a =>
        `<tr><td><code>${a.id}</code></td><td>${a.kind}</td><td>$${a.spent.toFixed(2)}</td><td>$${a.granted.toFixed(2)}</td><td>$${a.remaining.toFixed(2)}</td><td>${a.blocked}</td></tr>`).join('') || '<tr><td colspan="6" class="note">No actors yet.</td></tr>';
      const s = ac.summary;
      document.getElementById('s-saved').textContent = '$' + s.estimatedSaved.toFixed(2);
      document.getElementById('s-blocked').textContent = s.blockedCalls;
      document.getElementById('s-actors').textContent = s.actors;
      document.getElementById('s-appeals').textContent = s.openAppeals;
    }
    if (ap.appeals) {
      document.getElementById('appeals').innerHTML = ap.appeals.length ? ap.appeals.map(a =>
        `<div><span class="tag appeal">#${a.id} ${a.status}</span><code>${a.actorId}</code> - ${a.message.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}` +
        (a.status === 'open' ? ` <button style="padding:4px 12px;font-size:12px" onclick="resolveAppeal(${a.id},'approve')">Approve +$1</button> <button class="ghost" style="padding:4px 12px;font-size:12px" onclick="resolveAppeal(${a.id},'deny')">Deny</button>` : '') +
        `</div>`).join('') : '<div class="note">No appeals yet.</div>';
    }
  } catch (e) { /* keep polling */ }
  setTimeout(pull, 1200);
}
async function resolveAppeal(id, action) {
  await fetch('/api/admin/appeal/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY }, body: JSON.stringify({ action }) });
}
pull();
