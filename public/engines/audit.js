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

  // A realistic mixed hour of traffic, generated here so the demo works without real logs.
  document.getElementById('sample').addEventListener('click', () => {
    const L = [], base = Date.UTC(2026, 10, 18, 10, 0, 0);
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const ts = ms => { const d = new Date(base + ms); return String(d.getUTCDate()).padStart(2, '0') + '/' + M[d.getUTCMonth()] + '/' + d.getUTCFullYear() + ':' + [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(x => String(x).padStart(2, '0')).join(':') + ' +0000'; };
    const line = (ip, ms, path, bytes, ua, status) => L.push(`${ip} - - [${ts(ms)}] "GET ${path} HTTP/1.1" ${status || 200} ${bytes} "-" "${ua}"`);
    const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';
    const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
    for (let p = 0; p < 60; p++) { const ip = '192.0.2.' + (10 + p), t0 = Math.random() * 3.2e6; for (let k = 0; k < 6; k++) { line(ip, t0 + k * 9000, ['/', '/products/' + (p % 40), '/static/app.css', '/static/app.js', '/img/hero.webp', '/cart'][k], 4000 + Math.floor(Math.random() * 30000), p % 3 ? CHROME : SAFARI); } }
    for (let k = 0; k < 400; k++) line('198.51.100.20', k * 2500, '/products?page=' + (k + 1), 5200, 'python-requests/2.32.3');
    for (let k = 0; k < 220; k++) line('198.51.100.77', k * 9000, '/products?page=' + ((k % 50) + 1), 5200, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/142.0 Safari/537.36');
    for (let k = 0; k < 300; k++) line('203.0.113.5', k * 11000, '/blog/post-' + (k % 120), 21000, 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)');
    for (let k = 0; k < 140; k++) line('203.0.113.66', k * 24000, '/docs/' + (k % 70), 18000, 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)');
    for (let k = 0; k < 90; k++) line('66.249.66.1', k * 38000, '/products/' + (k % 40), 9000, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    for (let k = 0; k < 260; k++) line('192.0.2.240', k * 800, '/catalog?page=' + (k + 1), 4000, CHROME);
    for (let k = 0; k < 30; k++) line('198.51.100.90', k * 60000, '/wp-login.php', 600, 'curl/8.9.1', 404);
    ta.value = L.sort(() => Math.random() - 0.5).join('\n');
    document.getElementById('fileNote').textContent = 'Sample: about ' + L.length.toLocaleString() + ' requests over an hour, made up for the demo';
  });

  document.getElementById('run').addEventListener('click', async e => {
    if (!ta.value.trim()) { document.getElementById('fileNote').textContent = 'Paste a log, upload a file or load the sample first.'; return; }
    e.target.disabled = true; e.target.textContent = 'Analysing...';
    try {
      const r = await fetch('/api/audit/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ log: ta.value, costPer1k: document.getElementById('c1k').value, costPerGB: document.getElementById('cgb').value }) });
      const a = await r.json();
      if (!r.ok) throw new Error(a.reason || r.status);
      document.getElementById('a-total').textContent = a.lines.toLocaleString();
      document.getElementById('a-share').textContent = Math.round(a.automated.share * 100) + '%';
      document.getElementById('a-cost').textContent = money(a.automated.costUsd);
      document.getElementById('a-month').textContent = a.automated.monthlyCostUsd == null ? 'needs 1 h+' : money(a.automated.monthlyCostUsd);
      const rows = a.classes.filter(c => c.requests).sort((x, y) => y.requests - x.requests);
      const max = Math.max(...rows.map(c => c.requests), 1);
      document.getElementById('a-classes').innerHTML = rows.map(c => '<div class="bar"><span class="lab">' + esc(c.label) + '</span><span class="trk"><i style="width:' + (100 * c.requests / max) + '%;background:var(' + COLOR[c.key] + ')"></i></span><span class="val">' + c.requests.toLocaleString() + '</span></div>').join('');
      document.getElementById('a-top').innerHTML = a.top.map(t => '<tr><td><code>' + esc(t.ip) + '</code><div class="small dim">' + esc(t.ua || 'no user agent') + '</div></td><td><span class="chip ' + (t.class === 'ai' || t.class === 'search' ? 'agent' : t.class === 'scraper' ? 'warn' : 'bot') + '">' + esc(t.label) + '</span></td><td class="mono">' + t.requests.toLocaleString() + '</td><td class="small">' + esc(t.reasons.join('; ')) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">No automated actors found.</td></tr>';
      document.getElementById('a-recs').innerHTML = a.recommendations.map(x => '<li>' + esc(x) + '</li>').join('') + '<li class="dim">Prices used: ' + money(a.assumptions.costPer1k) + ' per 1,000 requests and ' + money(a.assumptions.costPerGB) + ' per GB. ' + (a.skipped ? a.skipped.toLocaleString() + ' lines could not be read.' : '') + '</li>';
    } catch (err) {
      document.getElementById('fileNote').textContent = 'Audit failed: ' + err.message;
    }
    e.target.disabled = false; e.target.textContent = 'Run the audit';
  });
})();
