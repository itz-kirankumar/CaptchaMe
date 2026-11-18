(function () {
  'use strict';
  const root = document.getElementById('kpis');
  if (!root) return;
  const admin = window.CMAdmin;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const events = [];
  let since = 0, saved = 0;

  // A "catch" is any event where automation was stopped.
  const isCatch = e => e.type === 'fail' || e.type === 'replay' || e.type === 'trap' || (e.type === 'scrape' && /block|decoy/.test(e.decision || ''));
  function bucketOf(e) {
    if (e.type === 'pass') return 'human';
    if (e.type === 'agent') return 'agent';
    if (e.type === 'scrape') return e.decision === 'allow' ? null : 'warn';
    if (e.type === 'arena') return 'appeal';
    if (e.type === 'fail' || e.type === 'replay' || e.type === 'trap') return 'bot';
    return null;
  }
  const norm = f => String(f).replace(/\d+(\.\d+)?/g, '#').split(/[:(]/)[0].trim().slice(0, 72);

  function bars(el, rows, emptyText) {
    if (!rows.length) { el.innerHTML = '<div class="empty">' + emptyText + '</div>'; return; }
    const max = Math.max(...rows.map(r => r.parts.reduce((a, p) => a + p.n, 0)));
    el.innerHTML = rows.map(r => {
      const total = r.parts.reduce((a, p) => a + p.n, 0);
      return '<div class="bar"><span class="lab" title="' + esc(r.label) + '">' + esc(r.label) + '</span><span class="trk">' + r.parts.map(p => '<i style="width:' + (100 * p.n / max) + '%;background:var(' + p.c + ')"></i>').join('') + '</span><span class="val">' + total + '</span></div>';
    }).join('');
  }

  function timeline() {
    const W = 760, Hh = 190, bins = 30, now = Date.now(), start = now - bins * 60000;
    const keys = ['human', 'bot', 'warn', 'agent', 'appeal'];
    const counts = Array.from({ length: bins }, () => ({ human: 0, bot: 0, warn: 0, agent: 0, appeal: 0 }));
    for (const e of events) {
      if (e.at < start) continue;
      const b = bucketOf(e);
      if (!b) continue;
      counts[Math.min(bins - 1, Math.floor((e.at - start) / 60000))][b]++;
    }
    const max = Math.max(4, ...counts.map(c => keys.reduce((a, k) => a + c[k], 0)));
    const bw = (W - 40) / bins;
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (Hh + 26) + '" role="img" aria-label="Events per minute over the last 30 minutes">';
    for (let g = 0; g <= 4; g++) { const y = 6 + (Hh - 6) * g / 4; s += '<line x1="36" x2="' + W + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--line)"/><text x="30" y="' + (y + 4) + '" text-anchor="end" style="fill:var(--faint);font:11px var(--font-mono)">' + Math.round(max * (1 - g / 4)) + '</text>'; }
    counts.forEach((c, i) => {
      let y = Hh;
      for (const k of keys) {
        if (!c[k]) continue;
        const h = (Hh - 6) * c[k] / max;
        y -= h;
        s += '<rect x="' + (40 + i * bw + 1.5) + '" y="' + y.toFixed(1) + '" width="' + (bw - 3).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" style="fill:var(--' + k + ')"><title>' + c[k] + ' ' + k + '</title></rect>';
      }
      if (i % 5 === 0) s += '<text x="' + (40 + i * bw) + '" y="' + (Hh + 18) + '" style="fill:var(--faint);font:11px var(--font-mono)">-' + (bins - i) + 'm</text>';
    });
    s += '<text x="' + (W - 2) + '" y="' + (Hh + 18) + '" text-anchor="end" style="fill:var(--faint);font:11px var(--font-mono)">now</text></svg>';
    document.getElementById('timeline').innerHTML = s;
  }

  function render() {
    const checks = events.filter(e => e.type === 'pass' || e.type === 'fail').length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('k-checks', checks);
    set('k-humans', events.filter(e => e.type === 'pass').length);
    set('k-bots', events.filter(e => e.type === 'fail' || e.type === 'replay' || e.type === 'trap').length);
    set('k-agents', events.filter(e => e.type === 'agent').length);
    set('k-scrape', events.filter(e => e.type === 'scrape' && /block|decoy/.test(e.decision || '')).length);
    set('k-saved', '$' + saved.toFixed(2));
    timeline();

    const fmt = {};
    for (const e of events) if ((e.type === 'pass' || e.type === 'fail') && e.lane) { fmt[e.lane] = fmt[e.lane] || { p: 0, f: 0 }; fmt[e.lane][e.type === 'pass' ? 'p' : 'f']++; }
    bars(document.getElementById('byFormat'), Object.entries(fmt).sort((a, b) => (b[1].p + b[1].f) - (a[1].p + a[1].f)).map(([k, v]) => ({ label: k, parts: [{ n: v.p, c: '--human' }, { n: v.f, c: '--bot' }] })), 'No checks yet.');

    const why = {};
    for (const e of events) {
      if (e.type === 'fail' && e.flags && e.flags.length) { const k = norm(e.flags[0]); why[k] = (why[k] || 0) + 1; }
      else if (e.type === 'replay') why['replayed session or relayed token'] = (why['replayed session or relayed token'] || 0) + 1;
      else if (e.type === 'trap') why['followed a link only a program can see'] = (why['followed a link only a program can see'] || 0) + 1;
    }
    bars(document.getElementById('byReason'), Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ label: k, parts: [{ n, c: '--bot' }] })), 'No catches yet.');

    const dec = { allow: 0, slow: 0, decoy: 0, block: 0, agent: 0 };
    for (const e of events) if (e.type === 'scrape' && e.decision in dec) dec[e.decision]++;
    const C = { allow: '--human', slow: '--warn', decoy: '--warn', block: '--bot', agent: '--agent' };
    bars(document.getElementById('byDecision'), Object.entries(dec).filter(([, n]) => n).map(([k, n]) => ({ label: k, parts: [{ n, c: C[k] }] })), 'No listing traffic yet.');

    const att = {};
    for (const e of events) {
      if (!e.attacker || e.attacker === 'unlabelled') continue;
      const a = att[e.attacker] = att[e.attacker] || { n: 0, through: 0, caught: 0 };
      if (e.type === 'pass' || e.type === 'agent' || (e.type === 'arena' && e.result === 'pass') || (e.type === 'scrape' && /allow|slow/.test(e.decision || ''))) { a.n++; a.through++; }
      else if (isCatch(e) || (e.type === 'arena' && e.result === 'fail')) { a.n++; a.caught++; }
    }
    const rows = Object.entries(att).sort((a, b) => b[1].n - a[1].n);
    if (rows.length) document.getElementById('byAttacker').innerHTML = rows.map(([k, v]) => '<tr><td><strong>' + esc(k) + '</strong></td><td class="mono">' + v.n + '</td><td class="mono">' + v.through + '</td><td class="mono">' + v.caught + '</td></tr>').join('');

    document.getElementById('feed').innerHTML = events.slice(-80).reverse().map(e => '<div><span class="tag ' + esc(e.type) + '">' + esc(e.type) + '</span>' + esc(new Date(e.at).toLocaleTimeString() + '  ' + e.message) + (e.attacker && e.attacker !== 'unlabelled' ? '<span class="who">[' + esc(e.attacker) + ']</span>' : '') + '</div>').join('') || '<div class="empty">No events yet. Try a check, the arena or the dry run.</div>';
  }

  async function pull() {
    if (!document.body.contains(root)) return;
    try {
      for (let guard = 0; guard < 40; guard++) {
        const ev = await (await admin.api('/api/admin/events?since=' + since)).json();
        const batch = ev.events || [];
        for (const e of batch) { if (e.seq > since) { since = e.seq; events.push(e); } }
        if (batch.length < 100) break;
      }
      if (events.length > 20000) events.splice(0, events.length - 20000);
      const ac = await (await admin.api('/api/admin/actors')).json();
      if (ac.summary) saved = ac.summary.estimatedSaved;
      render();
    } catch { /* keep polling */ }
    setTimeout(pull, 2000);
  }
  pull();
})();
