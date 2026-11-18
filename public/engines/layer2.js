(function () {
  'use strict';
  const ids = document.getElementById('l2ids');
  if (!ids || !window.CMAdmin) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = n => '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2));
  const CHIP = { human: 'human', declared_agent: 'agent', llm_agent: 'bot', solver_service: 'bot', scripted_bot: 'bot', automation_browser: 'bot', human_mimic: 'warn', scraper: 'warn', unknown: '' };
  const LABEL = { human: 'human', declared_agent: 'declared agent', llm_agent: 'LLM agent', solver_service: 'solver service', scripted_bot: 'scripted bot', automation_browser: 'automation browser', human_mimic: 'human mimic', scraper: 'scraper', unknown: 'unknown' };
  const DEC = { allow: 'pass', step_up: 'warn', slow: 'warn', limit: 'warn', block: 'fail' };
  const FAMS = ['script', 'automation', 'solver', 'llm', 'mimic', 'scraper'];
  const FAM_LABEL = { script: 'script', automation: 'automation', solver: 'solver service', llm: 'LLM agent', mimic: 'mimic', scraper: 'scraper' };
  let open = null;

  const chip = (cls) => '<span class="chip ' + (CHIP[cls] || '') + '">' + esc(LABEL[cls] || cls) + '</span>';
  // The key is picked up silently when the server runs on this machine. Without it the page shows the demo attackers.
  async function get(url) { try { const r = await CMAdmin.api(url, { gate: false }); return r.json(); } catch { const r = await fetch(url, { cache: 'no-store' }); return r.json(); } }

  function render(o) {
    $('k-mode').textContent = o.mode;
    $('k-packets').textContent = o.packets;
    $('k-ids').textContent = o.identities;
    $('k-merges').textContent = o.merges;
    $('k-bots').textContent = money(o.usd.onBots);
    $('k-spend').textContent = money(o.bypass.attackerSpendUsd);
    $('k-pages').textContent = o.scraping.catalogPagesTouched;
    $('k-hits').textContent = o.scraping.hits;
    $('k-decoy').textContent = o.scraping.decoysServed;
    $('k-canary').textContent = o.scraping.canariesPlanted;
    $('k-rival').textContent = o.bypass.rivalSolved;
    $('k-l1b').textContent = o.bypass.layer1Blocked;
    $('k-l1p').textContent = o.bypass.layer1Passed;

    ids.innerHTML = o.top.length ? o.top.map(s => {
      const ev = s.top.map(e => '<span class="mono small">' + esc(e.layer) + ' ' + esc(e.code) + '</span>').join('<br>');
      return '<tr class="l2row" data-id="' + esc(s.id) + '" tabindex="0" style="cursor:pointer"><td class="mono">' + esc(s.id) + '</td><td>' + chip(s.cls) + '<div class="note small" style="margin:2px 0 0">' + Math.round(s.conf * 100) + '%</div></td>' +
        '<td><span class="chip ' + (DEC[s.decision] || '') + '">' + esc(s.decision.replace('_', ' ')) + '</span></td>' +
        '<td class="small">' + s.identities.ips + ' address' + (s.identities.ips === 1 ? '' : 'es') + '<br>' + s.identities.uas + ' browser name' + (s.identities.uas === 1 ? '' : 's') + '<br>' + (s.attackers.map(a => esc(a.replace(/^Sim: /, ''))).join(', ') || '-') + '</td>' +
        '<td class="mono small">' + s.challenges.passes + ' pass<br>' + s.challenges.fails + ' fail</td>' +
        '<td class="mono small">' + s.scrape.hits + ' req<br>' + s.scrape.pages + ' pages</td><td class="mono">' + money(s.usd + s.protectedUsd) + '</td><td>' + ev + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">Waiting for packets. Open the live room and press an attacker.</td></tr>';

    // heat grid
    $('l2mh').innerHTML = '<th>Layer</th>' + FAMS.map(f => '<th>' + esc(FAM_LABEL[f]) + '</th>').join('');
    const max = Math.max(1, ...Object.values(o.matrix).flatMap(r => Object.values(r)));
    const LNAME = { L1: 'L1 network', L2: 'L2 sealed', L3: 'L3 browser', L4: 'L4 shape', L5: 'L5 timing', L6: 'L6 binding', L7: 'L7 decision' };
    $('l2m').innerHTML = Object.keys(o.matrix).map(l => '<tr><td class="mono small">' + LNAME[l] + '</td>' + FAMS.map(f => { const n = o.matrix[l][f]; const a = n ? Math.min(0.85, 0.12 + 0.73 * n / max) : 0; return '<td class="mono" style="text-align:center;background:color-mix(in srgb, var(--bot) ' + Math.round(a * 100) + '%, transparent)">' + (n || '') + '</td>'; }).join('') + '</tr>').join('');

    // cost by class
    const tot = Math.max(1e-9, ...o.classes.map(c => c.usd));
    $('l2cls').innerHTML = o.classes.filter(c => c.count).map(c => '<div class="bar"><span class="lab">' + esc(LABEL[c.cls] || c.cls) + ' (' + c.count + ')</span><span class="trk"><i style="width:' + Math.max(2, Math.round(100 * c.usd / tot)) + '%;background:var(--' + (c.cls === 'human' ? 'human' : c.cls === 'declared_agent' ? 'agent' : c.cls === 'human_mimic' || c.cls === 'scraper' ? 'warn' : 'bot') + ')"></i></span><span class="val">' + money(c.usd) + '</span></div>').join('') || '<div class="empty">No traffic yet.</div>';

    const sc = Object.entries(o.scraping.byClass);
    $('l2scr').innerHTML = sc.length ? sc.map(([c, v]) => '<tr><td>' + chip(c) + '</td><td class="mono">' + v.identities + '</td><td class="mono">' + v.hits + '</td><td class="mono">' + v.pages + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">No scraping seen yet.</td></tr>';

    const rv = Object.entries(o.bypass.rivalBeaten).sort((a, b) => b[1] - a[1]);
    $('l2riv').innerHTML = rv.length ? rv.map(([t, n]) => '<div class="bar"><span class="lab">' + esc(t) + '</span><span class="trk"><i style="width:' + Math.max(4, Math.round(100 * n / rv[0][1])) + '%;background:var(--bot)"></i></span><span class="val">' + n + 'x</span></div>').join('') : '<div class="empty">No rival captcha beaten yet.</div>';

    $('l2merged').innerHTML = o.merged.length ? o.merged.map(m => '<div><b class="mono">' + esc(m.id) + '</b> ' + chip(m.cls) + ' ' + m.merged + ' identit' + (m.merged === 1 ? 'y' : 'ies') + ' folded in: ' + m.ips + ' addresses, ' + m.uas + ' browser names, ' + m.signatures + ' client signature' + (m.signatures === 1 ? '' : 's') + '<span class="who">' + esc(m.log.join(' | ')) + '</span></div>').join('') : '<div class="empty">None yet.</div>';
  }

  async function showDetail(id) {
    open = id;
    const d = await get('/api/layer2/subject/' + encodeURIComponent(id));
    const box = $('l2detail'); box.hidden = false;
    box.innerHTML = '<div class="row"><h2 style="margin:0">' + esc(d.id) + '</h2>' + chip(d.cls) + '<span class="chip ' + (DEC[d.decision] || '') + '">' + esc(d.decision.replace('_', ' ')) + '</span><span class="spacer"></span><button class="sm ghost" id="l2close">Close</button></div>' +
      '<p class="note">' + esc(d.why) + ' &middot; confidence ' + Math.round(d.conf * 100) + '%</p>' +
      '<div class="grid g2"><div><h3>Evidence, by layer</h3><div class="feed">' + (d.evidence.map(e => '<div><b class="mono">' + esc(e.layer) + '</b> <b>' + esc(e.code) + '</b> <span class="dim">&times;' + e.count + ' &middot; weight ' + e.weight + ' &middot; ' + esc(e.family) + '</span><span class="who">' + esc(e.text || '') + '</span></div>').join('') || '<div class="empty">No evidence.</div>') + '</div></div>' +
      '<div><h3>One client, many labels</h3><div class="feed"><div><b>Addresses</b> <span class="who">' + d.identities.ips + ' distinct; networks: ' + d.ips.map(i => esc(i.ip) + ' x' + i.n).join(', ') + '</span></div><div><b>Browser names</b>' + d.userAgents.map(u => '<span class="who">' + esc(u.ua) + ' x' + u.n + '</span>').join('') + '</div><div><b>Client signatures</b> <span class="who">' + d.signatures.map(s => esc(s.ns) + ' x' + s.n).join(', ') + '</span></div><div><b>Links used</b> <span class="who">' + Object.entries(d.links).map(([k, v]) => esc(k) + ':' + v).join('  ') + '</span></div><div><b>How it was merged</b>' + (d.mergeLog.length ? d.mergeLog.map(m => '<span class="who">' + esc(m) + '</span>').join('') : '<span class="who">never merged; a single set of links</span>') + '</div></div></div></div>' +
      '<h3 style="margin-top:16px">Timeline</h3><div class="feed">' + d.timeline.slice().reverse().map(t => '<div><span class="mono dim">' + new Date(t.t).toTimeString().slice(0, 8) + '</span> <b>' + esc(t.kind) + '</b> ' + esc(t.note || '') + '</div>').join('') + '</div>';
    $('l2close').onclick = () => { open = null; box.hidden = true; };
  }

  ids.addEventListener('click', e => { const r = e.target.closest('[data-id]'); if (r) showDetail(r.dataset.id).catch(() => {}); });
  ids.addEventListener('keydown', e => { if (e.key === 'Enter') { const r = e.target.closest('[data-id]'); if (r) showDetail(r.dataset.id).catch(() => {}); } });
  $('l2reset').addEventListener('click', async () => { try { await CMAdmin.api('/api/layer2/reset', { method: 'POST', gate: false }); } catch { /* only with a key */ } open = null; $('l2detail').hidden = true; tick(); });

  async function tick() {
    try { render(await get('/api/layer2/overview')); if (open) showDetail(open).catch(() => { open = null; $('l2detail').hidden = true; }); } catch { /* gate shown by CMAdmin, or server restarting */ }
  }
  const want = new URLSearchParams(location.search).get('open');
  if (want) setTimeout(() => showDetail(want).then(() => { const b = $('l2detail'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }).catch(() => {}), 700);
  tick(); setInterval(() => { if (!document.hidden) tick(); }, 1500);
})();
