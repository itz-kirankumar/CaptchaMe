(function () {
  'use strict';
  const ta = document.getElementById('logText');
  if (!ta) return;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = n => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const COLOR = { person: '--human', search: '--agent', ai: '--appeal', script: '--bot', headless: '--bot', scraper: '--warn' };
  document.getElementById('origin').textContent = location.origin;

  document.getElementById('logFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 4e6) { document.getElementById('fileNote').textContent = 'That file is over 4 MB; the first 4 MB will be analysed.'; }
    const r = new FileReader();
    r.onload = () => { ta.value = String(r.result).slice(0, 4e6); if (f.size <= 4e6) document.getElementById('fileNote').textContent = f.name + ' loaded'; };
    r.readAsText(f.slice(0, 4e6));
  });

  function render(a) {
      document.getElementById('a-total').textContent = a.lines.toLocaleString();
      document.getElementById('a-share').textContent = Math.round(a.automated.share * 100) + '%';
      document.getElementById('a-cost').textContent = money(a.automated.costUsd);
      document.getElementById('a-month').textContent = a.automated.monthlyCostUsd == null ? 'needs 1 h+' : money(a.automated.monthlyCostUsd);
      const rows = a.classes.filter(c => c.requests).sort((x, y) => y.requests - x.requests);
      const max = Math.max(...rows.map(c => c.requests), 1);
      document.getElementById('a-classes').innerHTML = rows.map(c => '<div class="bar"><span class="lab">' + esc(c.label) + '</span><span class="trk"><i style="width:' + (100 * c.requests / max) + '%;background:var(' + COLOR[c.key] + ')"></i></span><span class="val">' + c.requests.toLocaleString() + '</span></div>').join('');
      document.getElementById('a-top').innerHTML = a.top.map(t => '<tr><td><code>' + esc(t.ip) + '</code><div class="small dim">' + esc(t.ua || 'no user agent') + '</div></td><td><span class="chip ' + (t.class === 'ai' || t.class === 'search' ? 'agent' : t.class === 'scraper' ? 'warn' : 'bot') + '">' + esc(t.label) + '</span></td><td class="mono">' + t.requests.toLocaleString() + '</td><td class="small">' + esc(t.reasons.join('; ')) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">No automated actors found.</td></tr>';
      document.getElementById('a-recs').innerHTML = a.recommendations.map(x => '<li>' + esc(x) + '</li>').join('') + '<li class="dim">Prices used: ' + money(a.assumptions.costPer1k) + ' per 1,000 requests and ' + money(a.assumptions.costPerGB) + ' per GB. ' + (a.skipped ? a.skipped.toLocaleString() + ' lines could not be read. ' : '') + (a.source && a.source.note ? esc(a.source.note) : '') + '</li>';
  }
  const prices = () => ({ costPer1k: document.getElementById('c1k').value, costPerGB: document.getElementById('cgb').value });

  document.getElementById('run').addEventListener('click', async e => {
    if (!ta.value.trim()) { document.getElementById('fileNote').textContent = 'Paste a log or upload a file first, or analyse this site’s live traffic.'; return; }
    e.target.disabled = true; e.target.textContent = 'Analysing...';
    try {
      const r = await fetch('/api/audit/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ log: ta.value, ...prices() }) });
      const a = await r.json();
      if (!r.ok) throw new Error(a.reason || r.status);
      render(a);
    } catch (err) {
      document.getElementById('fileNote').textContent = 'Audit failed: ' + err.message;
    }
    e.target.disabled = false; e.target.textContent = 'Run the audit';
  });

  // This server's own access log: every request it received since it started.
  document.getElementById('live').addEventListener('click', async e => {
    e.target.disabled = true;
    const note = document.getElementById('fileNote');
    try {
      const p = prices();
      const r = await window.CMAdmin.api('/api/audit/live?cost_per_1k=' + encodeURIComponent(p.costPer1k) + '&cost_per_gb=' + encodeURIComponent(p.costPerGB));
      const a = await r.json();
      if (!r.ok) throw new Error(a.reason || r.status);
      if (a.empty) note.textContent = 'No traffic recorded yet since the server started.';
      else { render(a); note.textContent = 'Live: ' + a.source.requests.toLocaleString() + ' requests since ' + new Date(a.source.since).toLocaleString(); }
    } catch (err) {
      if (!/admin key|forbidden/.test(err.message)) note.textContent = 'Audit failed: ' + err.message;
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    e.target.disabled = false;
  });
})();
