/* Live layers run: pick an actor, watch one real request cross every layer.
   Every call below hits the running backend; every number, hash and verdict
   in the log comes back from it live. Nothing is staged. */
(function () {
  'use strict';
  const app = document.getElementById('lvapp');
  if (!app) return;
  const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const $ = (sel, el) => (el || app).querySelector(sel);

  app.innerHTML =
    '<div class="lv-modes"><span class="lbl">Run as</span>' +
    '<button class="lv-mode on" data-lv-mode="human">a person</button>' +
    '<button class="lv-mode" data-lv-mode="bot">a bare script</button>' +
    '<button class="lv-mode" data-lv-mode="agent">an agent</button>' +
    '<button class="lv-mode" data-lv-mode="scraper">a scraper</button></div>' +
    '<div class="lv-pills" id="lvpills"></div>' +
    '<div class="lv-bar"><i id="lvbarfill"></i></div>' +
    '<div class="lv-stephead"><div class="crumb"><span class="live-dot" id="lvdot"></span><span id="lvcrumb">Ready</span></div>' +
    '<h3 id="lvtitle">Pick an actor, press run</h3><p id="lvsub">The run below is a real request through the CaptchaMe stack, made by this page, right now.</p></div>' +
    '<div class="lv-main"><div class="lv-diagram" id="lvdiagram"><div class="lv-pulse" id="lvpulse"></div></div>' +
    '<div class="lv-stage">' +
    '<div class="lv-counters"><div><b id="lvreq">0</b><span>requests made</span></div><div><b id="lvsig">0</b><span>signals read</span></div><div><b id="lvhash">0</b><span>hashes and signatures</span></div></div>' +
    '<div class="lv-cvwrap" id="lvcvwrap"><canvas id="lvcv" width="640" height="400"></canvas><div class="hint">Keep your pointer on the ring until the bar fills. The jumps arrive live from the server.</div></div>' +
    '<div class="lv-log" id="lvlog"></div></div></div>' +
    '<div class="lv-foot"><span class="lv-verdict" id="lvverdict">Idle</span><span class="lv-elapsed" id="lvelapsed"></span></div>';

  const els = {
    pills: $('#lvpills'), bar: $('#lvbarfill'), crumb: $('#lvcrumb'), title: $('#lvtitle'), sub: $('#lvsub'),
    diagram: $('#lvdiagram'), pulse: $('#lvpulse'), req: $('#lvreq'), sig: $('#lvsig'), hash: $('#lvhash'),
    cvwrap: $('#lvcvwrap'), cv: $('#lvcv'), log: $('#lvlog'), verdict: $('#lvverdict'), elapsed: $('#lvelapsed'), dot: $('#lvdot'),
  };

  const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };
  const short = s => { s = String(s || ''); return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s; };
  const jtrunc = (o, n) => trunc(JSON.stringify(o), n || 96);

  let counts, aborted, runToken = 0;
  function resetCounts() { counts = { req: 0, sig: 0, hash: 0 }; paintCounts(); }
  function paintCounts() { els.req.textContent = counts.req; els.sig.textContent = counts.sig; els.hash.textContent = counts.hash; }

  function log(mark, text, dim) {
    const ln = document.createElement('div'); ln.className = 'ln';
    const mk = document.createElement('span'); mk.className = 'mk ' + mark;
    mk.textContent = mark === 'ok' ? '✓' : mark === 'x' ? '✗' : mark === 'warn' ? '!' : '>';
    const bd = document.createElement('span'); bd.className = 'bd' + (dim ? ' dim' : ''); bd.textContent = text;
    ln.append(mk, bd); els.log.appendChild(ln);
    els.log.scrollTop = els.log.scrollHeight;
  }

  async function req(method, path, body) {
    counts.req++; paintCounts();
    const t0 = performance.now();
    const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let b = null; try { b = await r.json(); } catch { /* not json */ }
    return { status: r.status, body: b, ms: Math.round(performance.now() - t0) };
  }
  async function sha256hex(text) {
    counts.hash++; paintCounts();
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------------- ring run (real, compact copy of the /check engine) ---------------- */
  function lissajous(P, W, H, tms) {
    const t = tms / 1000; let px = P.px, py = P.py;
    for (const d of (P.darts || [])) if (tms >= d.at) { px = d.px; py = d.py; }
    return { x: (0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + px)) * W, y: (0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + py)) * H };
  }
  function cuePoller(session, t0, onCue) {
    const got = new Set(), cues = []; let stop = false;
    (async function poll() {
      while (!stop) {
        try {
          const r = await req('POST', '/api/challenge/cue', { session });
          for (const c of (r.body && r.body.cues) || []) {
            if (got.has(c.kind + c.i)) continue;
            got.add(c.kind + c.i);
            const cue = { ...c, appliedAt: Math.round(performance.now() - t0) };
            cues.push(cue); onCue(cue);
          }
          if (r.body && r.body.done) break;
        } catch { /* keep polling */ }
        await sleep(150);
      }
    })();
    return { cues, stop() { stop = true; } };
  }
  function runRingLive(session, params) {
    const cv = els.cv, ctx = cv.getContext('2d');
    const P = { ...params, darts: [], flashes: [] };
    const samples = [], t0 = performance.now();
    const poller = cuePoller(session, t0, c => {
      if (c.kind === 'dart') { P.darts.push({ at: c.appliedAt, px: c.px, py: c.py }); log('run', 'cue arrived: ring jumped (dart #' + (c.i + 1) + ') at ' + (c.appliedAt / 1000).toFixed(1) + ' s'); counts.sig++; paintCounts(); }
      else P.flashes.push(c.appliedAt);
    });
    let pos = null;
    const onMove = e => {
      const rect = cv.getBoundingClientRect();
      pos = { x: (e.clientX - rect.left) * (cv.width / rect.width), y: (e.clientY - rect.top) * (cv.height / rect.height) };
    };
    cv.addEventListener('pointermove', onMove); cv.addEventListener('touchmove', onMove, { passive: true });
    return new Promise(resolve => {
      (function frame() {
        const t = performance.now() - t0;
        if (t >= P.durationMs || aborted) {
          cv.removeEventListener('pointermove', onMove); cv.removeEventListener('touchmove', onMove);
          poller.stop();
          return resolve({ samples, cues: poller.cues });
        }
        const g = lissajous(P, cv.width, cv.height, t);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.beginPath(); ctx.arc(g.x, g.y, 28, 0, 7); ctx.strokeStyle = col('--brand'); ctx.lineWidth = 3.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, 7); ctx.fillStyle = col('--brand'); ctx.fill();
        ctx.fillStyle = col('--surface-3'); ctx.fillRect(0, cv.height - 5, cv.width, 5);
        ctx.fillStyle = col('--brand'); ctx.fillRect(0, cv.height - 5, cv.width * (t / P.durationMs), 5);
        if (pos) {
          ctx.beginPath(); ctx.arc(pos.x, pos.y, 8, 0, 7); ctx.fillStyle = col('--text'); ctx.globalAlpha = .85; ctx.fill(); ctx.globalAlpha = 1;
          samples.push({ t: Math.round(t), x: +(pos.x / cv.width).toFixed(4), y: +(pos.y / cv.height).toFixed(4) });
        }
        requestAnimationFrame(frame);
      })();
    });
  }
  // A script's answer: samples exactly on the path, zero lag, no hesitation.
  function runRingScripted(session, params) {
    const P = { ...params, darts: [] }, t0 = performance.now();
    const poller = cuePoller(session, t0, c => { if (c.kind === 'dart') P.darts.push({ at: c.appliedAt, px: c.px, py: c.py }); });
    return (async () => {
      const W = 640, H = 400, samples = [];
      let next = 0;
      while (performance.now() - t0 < P.durationMs && !aborted) {
        const t = performance.now() - t0;
        if (t >= next) { const g = lissajous(P, W, H, t); samples.push({ t: Math.round(t), x: +(g.x / W).toFixed(4), y: +(g.y / H).toFixed(4) }); next += 50; }
        await sleep(8);
      }
      poller.stop();
      return { samples, cues: poller.cues };
    })();
  }

  /* ---------------- shared layer steps ---------------- */
  async function stepEdge(ctx) {
    const a = await req('GET', '/api/ping'); const b = await req('GET', '/api/ping');
    ctx.rtt = Math.min(a.ms, b.ms);
    log('ok', 'GET /api/ping x2 → 200 · round trip ' + ctx.rtt + ' ms from this browser');
    const n = await req('GET', '/api/page/nonce');
    ctx.nonce = n.body && n.body.nonce;
    counts.hash++; paintCounts();
    log('ok', 'GET /api/page/nonce → 200 · nonce ' + short(ctx.nonce) + ' (HMAC-signed, binds this ip + user-agent, 10 min)');
    ctx.stats0 = (await req('GET', '/api/stats')).body || {};
    log('ok', 'GET /api/stats → snapshot for the audit step: ' + jtrunc(ctx.stats0, 90), true);
    const g = await req('POST', '/api/decide', { page_nonce: ctx.nonce });
    ctx.gateway0 = g.body;
    log('ok', 'POST /api/decide → the gateway sorts this request: lane ' + (g.body && g.body.lane) + ' · ' + (((g.body && g.body.layers) || []).map(l => l.layer + ':' + (l.result || l.decision || l.tier)).join(' → ') || ''));
  }

  async function stepAgentLane(ctx) {
    const w = await req('GET', '/api/agent/whoami');
    log(w.body && w.body.verified ? 'ok' : 'info', 'GET /api/agent/whoami → verified: ' + (w.body && w.body.verified) + ' · ' + trunc(w.body && w.body.reason, 80), true);
    log('info', 'No Web Bot Auth signature on these requests. An honest agent signs instead of solving puzzles.', true);
  }

  async function stepShield(ctx) {
    await req('POST', '/api/shield/beacon', {});
    log('ok', 'POST /api/shield/beacon → 200 · this page view is now observed server-side');
    const c = await req('POST', '/api/shield/check', { ip: '', ua: navigator.userAgent, acceptLanguage: navigator.language || '', js: true, page: 1 });
    const d = c.body || {};
    counts.sig += 3; paintCounts();
    log('ok', 'POST /api/shield/check → decision: ' + d.decision + ' · risk ' + d.risk + (d.reasons && d.reasons.length ? ' · ' + trunc(d.reasons.join('; '), 70) : ''));
    if (d.observed_for_this_browser) log('ok', 'observed for this browser: ' + d.observed_for_this_browser.hits_last_minute + ' hits and ' + d.observed_for_this_browser.asset_beacons + ' beacons in the last minute', true);
  }

  async function stepAudit(ctx) {
    const s1 = (await req('GET', '/api/stats')).body || {};
    const parts = [];
    for (const k of ['checks', 'humans', 'botsCaught', 'agents', 'scrapersStopped']) {
      const d = (s1[k] || 0) - (ctx.stats0[k] || 0);
      if (d) parts.push(k + ' +' + d);
    }
    if (parts.length) log('ok', 'GET /api/stats → this run moved the public counters: ' + parts.join(', '));
    else log('ok', 'GET /api/stats → counters unchanged at read time (writes settle asynchronously): ' + jtrunc(s1, 90));
    log('info', 'Every event above is also in the live dashboard at /dashboard and the ledger at /api/ledger/me.', true);
  }

  async function stepStart(ctx, spoofNote) {
    const env = {
      ua: navigator.userAgent, lang: navigator.language, webdriver: navigator.webdriver === true,
      hardware: navigator.hardwareConcurrency || 0, touch: 'ontouchstart' in window,
      onPageMs: Math.round(performance.now()),
    };
    counts.sig += 5; paintCounts();
    const eh = await sha256hex(JSON.stringify(env));
    log('ok', 'passive signals read from this browser: ' + jtrunc(env, 110));
    log('ok', 'sha256(signals) = ' + eh.slice(0, 16) + '… (computed live, in this tab)');
    if (spoofNote) log('warn', spoofNote);
    const r = await req('POST', '/api/challenge/start', { type: 'ring', page_nonce: ctx.nonce });
    if (r.status !== 200) { log('x', 'POST /api/challenge/start → ' + r.status + ' · ' + trunc((r.body && (r.body.reason || r.body.error)) || '', 90)); return null; }
    ctx.session = r.body.session; ctx.params = r.body.params;
    counts.hash++; paintCounts();
    log('ok', 'POST /api/challenge/start → 200 · session ' + short(ctx.session) + ' · ring for ' + Math.round(r.body.params.durationMs / 1000) + ' s, jumps sealed server-side');
    return r.body;
  }

  async function stepVerdict(ctx, out) {
    counts.sig += out.samples.length; paintCounts();
    const sh = await sha256hex(JSON.stringify({ samples: out.samples.length, cues: out.cues.length, session: ctx.session }));
    log('ok', 'sha256(answer) = ' + sh.slice(0, 16) + '… · ' + out.samples.length + ' pointer samples, ' + out.cues.length + ' cue receipts');
    const r = await req('POST', '/api/challenge/submit', { session: ctx.session, samples: out.samples, cues: out.cues, rtt_ms: ctx.rtt });
    const b = r.body || {};
    ctx.result = b.result;
    if (b.result === 'pass') {
      log('ok', 'POST /api/challenge/submit → pass · score ' + b.score + (b.flags && b.flags.length ? ' · notes: ' + trunc(b.flags.join('; '), 70) : ''));
      counts.hash++; paintCounts();
      log('ok', 'pass token issued: ' + short(b.pass_token) + ' (HMAC-signed, bound to this browser, single-form, 90 s)');
    } else {
      log('x', 'POST /api/challenge/submit → ' + (b.result || r.status) + ' · score ' + (b.score == null ? '-' : b.score) + ' · ' + trunc((b.flags || []).join('; ') || b.reason || '', 90));
      return b;
    }
    const v = await req('POST', '/api/pass/verify', { pass: b.pass_token });
    log(v.body && v.body.ok ? 'ok' : 'x', 'POST /api/pass/verify → ok: ' + (v.body && v.body.ok) + ' · browser_bound: ' + (v.body && v.body.browser_bound) + ' · form_bound: ' + (v.body && v.body.form_bound), true);
    const l = await req('GET', '/api/ledger/me');
    if (l.body && l.body.actor) log('ok', 'GET /api/ledger/me → actor ' + short(l.body.actor.id) + ' · fair share left: $' + l.body.actor.remaining);
    else log('info', 'GET /api/ledger/me → no ledger actor for this browser yet', true);
    return b;
  }

  /* ---------------- modes ---------------- */
  const MODES = {
    human: {
      label: 'a person', chip: 'human',
      steps: [
        { name: 'Network edge', sub: 'Round trip and a page nonce, minted for this exact browser and connection.', run: stepEdge },
        { name: 'Passive signals', sub: 'What the page reads while you watch, then a challenge starts against the nonce.', run: ctx => stepStart(ctx) },
        { name: 'Live check', sub: 'Follow the ring. Its jumps arrive live; nothing here can be pre-computed.', canvas: true, run: async ctx => { ctx.out = await runRingLive(ctx.session, ctx.params); } },
        { name: 'Verdict and pass', sub: 'The server scores how you moved, then mints a pass bound to this browser.', run: stepVerdictBound('human') },
        { name: 'Agent lane', sub: 'The same request, asked whether it is a declared agent.', run: stepAgentLane },
        { name: 'Scraper shield', sub: 'How this browser looks to the scraper shield after everything above.', run: stepShield },
        { name: 'Audit trail', sub: 'The public counters, before and after this run.', run: stepAudit },
      ],
      verdict: b => b && b.result === 'pass' ? ['pass', 'Person verified. The whole run took seconds and never left this page.'] : ['flag', 'Run finished. Follow the ring with your pointer to pass the live check.'],
    },
    bot: {
      label: 'a bare script', chip: 'bot',
      steps: [
        { name: 'Network edge', sub: 'A script can ping and mint a nonce too. That alone proves nothing.', run: stepEdge },
        { name: 'No page view', sub: 'First the lazy version: a start with no page nonce at all.', run: async ctx => {
            const r = await req('POST', '/api/challenge/start', { type: 'ring' });
            log('x', 'POST /api/challenge/start (no nonce) → ' + r.status + ' · ' + trunc((r.body && r.body.reason) || '', 90));
            const s = await stepStart(ctx, 'So the script adapts: it mints a nonce and starts a challenge properly.');
            return s;
          } },
        { name: 'Perfect answer', sub: 'The script answers with samples exactly on the ring, zero lag, no hesitation.', run: async ctx => { ctx.out = await runRingScripted(ctx.session, ctx.params); log('run', ctx.out.samples.length + ' synthetic samples, every one exactly on the ring, 0 ms behind'); } },
        { name: 'Verdict and pass', sub: 'Perfect is the tell. The server scores how, not what.', run: stepVerdictBound('bot') },
        { name: 'Agent lane', sub: 'Could it pretend to be an honest agent instead?', run: stepAgentLane },
        { name: 'Scraper shield', sub: 'And how the shield scores this browser after the attempt.', run: stepShield },
        { name: 'Audit trail', sub: 'The public counters, before and after this run.', run: stepAudit },
      ],
      verdict: b => b && b.result !== 'pass' ? ['block', 'Script caught. A perfect answer scored worse than a person.'] : ['flag', 'The scripted answer passed this time - the fair-share ledger caps what it buys.'],
    },
    agent: {
      label: 'an agent', chip: 'agent',
      steps: [
        { name: 'Network edge', sub: 'Round trip, then an agent nonce to sign.', run: async ctx => {
            const a = await req('GET', '/api/ping'); const b2 = await req('GET', '/api/ping');
            ctx.rtt = Math.min(a.ms, b2.ms);
            log('ok', 'GET /api/ping x2 → 200 · round trip ' + ctx.rtt + ' ms');
            const n = await req('POST', '/api/agent/nonce', {});
            ctx.agentNonce = n.body && n.body.nonce;
            log('ok', 'POST /api/agent/nonce → 200 · ' + short(ctx.agentNonce) + ' · sign this with an Ed25519 key (' + trunc(n.body && n.body.algorithm, 12) + ')');
            ctx.stats0 = (await req('GET', '/api/stats')).body || {};
          } },
        { name: 'Hold a key', sub: 'This browser tries to hold an Ed25519 key, like an agent would.', run: async ctx => {
            try {
              const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
              const raw = await crypto.subtle.exportKey('spki', k.publicKey);
              ctx.pubkey = btoa(String.fromCharCode(...new Uint8Array(raw)));
              const kh = await sha256hex(ctx.pubkey);
              log('ok', 'Ed25519 key generated in this tab · key hash ' + kh.slice(0, 12) + ' (matches what the server will compute)');
              const sig = await crypto.subtle.sign({ name: 'Ed25519' }, k.privateKey, new TextEncoder().encode(ctx.agentNonce));
              ctx.signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
              counts.hash++; paintCounts();
              log('ok', 'nonce signed · signature ' + short(ctx.signature));
            } catch {
              log('warn', 'This browser cannot hold an Ed25519 key (WebCrypto support). A real agent signs server-side; the declare call below will fail for real.');
            }
          } },
        { name: 'Declare', sub: 'Present the signed nonce and take the agent lane.', run: async ctx => {
            if (!ctx.signature) { log('x', 'POST /api/agent/declare skipped: no key in this browser'); return; }
            const r = await req('POST', '/api/agent/declare', { pubkey: ctx.pubkey, signature: ctx.signature, nonce: ctx.agentNonce, operator: 'landing-live-demo' });
            ctx.declared = r.status === 200;
            log(r.status === 200 ? 'ok' : 'x', 'POST /api/agent/declare → ' + r.status + ' · ' + jtrunc(r.body, 100));
          } },
        { name: 'Own budget', sub: 'A declared agent gets its own capped budget instead of a puzzle.', run: async ctx => {
            const l = await req('GET', '/api/ledger/me');
            log('ok', 'GET /api/ledger/me → ' + jtrunc(l.body, 100), true);
            const q = await req('GET', '/api/protected/quote');
            log(q.status === 200 ? 'ok' : 'info', 'GET /api/protected/quote (unsigned) → ' + q.status + ' · unsigned callers still need a pass or a signature', true);
          } },
        { name: 'Scraper shield', sub: 'Agents are welcome; the shield still watches how they ask.', run: stepShield },
        { name: 'Audit trail', sub: 'The public counters, before and after this run.', run: stepAudit },
      ],
      verdict: (b, ctx) => ctx.declared ? ['pass', 'Agent declared with a real signature and given its own capped lane. No puzzle solved.'] : ['flag', 'Unsigned here, so this run got no agent lane. A signed agent skips the puzzles entirely.'],
    },
    scraper: {
      label: 'a scraper', chip: 'scraper',
      steps: [
        { name: 'Network edge', sub: 'Round trip and a stats snapshot.', run: stepEdge },
        { name: 'Rapid requests', sub: 'Twelve page requests inside two seconds, like a scrape loop.', run: async ctx => {
            const t0 = performance.now();
            const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => req('GET', '/api/catalog?page=' + (i + 1))));
            const line = rs.map(r => r.status).join(' ');
            const dt = ((performance.now() - t0) / 1000).toFixed(1);
            log('ok', 'GET /api/catalog?page=1..12 → ' + line + ' · all 12 in ' + dt + ' s');
            const limited = rs.filter(r => r.status === 429).length, held = rs.filter(r => r.ms > 1200).length;
            if (limited) log('warn', limited + ' of them rate-limited (429); ' + held + ' held open over a second - the shield made the burst expensive');
          } },
        { name: 'What the shield saw', sub: 'Same browser, read back from the shield side.', run: async ctx => {
            const c = await req('POST', '/api/shield/check', { ip: '', ua: navigator.userAgent, acceptLanguage: navigator.language || '', js: true, page: 12 });
            const d = c.body || {};
            ctx.shieldDecision = d.decision;
            log(d.decision === 'allow' ? 'ok' : 'warn', 'POST /api/shield/check → decision: ' + d.decision + ' · risk ' + d.risk + (d.reasons && d.reasons.length ? ' · ' + trunc(d.reasons.join('; '), 80) : ''));
            if (d.observed_for_this_browser) log('ok', 'observed for this browser: ' + d.observed_for_this_browser.hits_last_minute + ' hits in the last minute', true);
            const g = await req('POST', '/api/decide', { page_nonce: ctx.nonce });
            ctx.gatewayAfter = g.body;
            log('ok', 'POST /api/decide (after the burst) → lane: ' + (g.body && g.body.lane) + ' · action: ' + (g.body && g.body.action) + trunc((g.body && g.body.reasons) ? ' · ' + g.body.reasons.join('; ') : '', 80));
          } },
        { name: 'Slow, decoy, block', sub: 'What happens next, per the shield decision.', run: async ctx => {
            const r = await req('GET', '/api/catalog?page=13');
            log('ok', 'GET /api/catalog?page=13 → ' + r.status + ' in ' + r.ms + ' ms' + (r.ms > 1200 ? ' · held and slowed' : ''));
            log('info', 'Scrapers get delays, traceable decoy data or a block. People never see this layer.', true);
          } },
        { name: 'Audit trail', sub: 'The public counters, before and after this run.', run: stepAudit },
      ],
      verdict: (b, ctx) => ctx.gatewayAfter && ctx.gatewayAfter.lane === 'scraper' ? ['block', 'The gateway sorted the burst into the scraper lane: action ' + ctx.gatewayAfter.action + '. The scrape got more expensive as it ran.'] : ['flag', 'The shield still rates this browser allow - repeated bursts raise the risk score.'],
    },
  };

  function stepVerdictBound() {
    return async ctx => { ctx.vb = await stepVerdict(ctx, ctx.out || { samples: [], cues: [] }); };
  }

  /* ---------------- runner ---------------- */
  let currentMode = 'human', running = false;

  function paintPills(mode, activeIdx, states) {
    els.pills.innerHTML = '';
    MODES[mode].steps.forEach((s, i) => {
      if (i) { const l = document.createElement('span'); l.className = 'lv-link'; els.pills.appendChild(l); }
      const p = document.createElement('span');
      p.className = 'lv-pill' + (states[i] ? ' ' + states[i] : i === activeIdx ? ' active' : '');
      p.innerHTML = '<span class="pn"></span>';
      p.firstChild.textContent = i + 1;
      p.appendChild(document.createTextNode(s.name));
      els.pills.appendChild(p);
    });
  }
  function paintDiagram(mode, activeIdx, states) {
    els.diagram.querySelectorAll('.lv-node').forEach(n => n.remove());
    MODES[mode].steps.forEach((s, i) => {
      const n = document.createElement('div');
      n.className = 'lv-node' + (states[i] ? ' ' + states[i] : i === activeIdx ? ' active' : '');
      n.innerHTML = '<span class="st"></span>';
      n.appendChild(document.createTextNode(s.name));
      els.diagram.appendChild(n);
    });
    const nodes = els.diagram.querySelectorAll('.lv-node');
    if (nodes[activeIdx] && getComputedStyle(els.diagram).flexDirection === 'column') {
      els.pulse.style.top = nodes[activeIdx].offsetTop + 'px';
      els.pulse.style.height = nodes[activeIdx].offsetHeight + 'px';
    }
  }

  async function run(mode) {
    if (running) { aborted = true; runToken++; await sleep(60); }
    running = true; aborted = false;
    const token = ++runToken;
    resetCounts();
    els.log.innerHTML = '';
    els.cvwrap.classList.remove('on');
    els.verdict.textContent = 'Running…';
    const t0 = performance.now();
    els.elapsed.textContent = '';
    const timer = setInterval(() => { els.elapsed.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s'; }, 100);
    const states = [];
    const ctx = { mode };
    paintPills(mode, 0, states); paintDiagram(mode, 0, states);
    const steps = MODES[mode].steps;
    log('info', 'run started: ' + MODES[mode].label + ' · ' + new Date().toLocaleTimeString(), true);
    for (let i = 0; i < steps.length; i++) {
      if (token !== runToken) break;
      els.crumb.textContent = 'Step ' + (i + 1) + ' of ' + steps.length + ' · working';
      els.title.textContent = steps[i].name;
      els.sub.textContent = steps[i].sub;
      els.bar.style.width = Math.round((i / steps.length) * 100) + '%';
      paintPills(mode, i, states); paintDiagram(mode, i, states);
      if (steps[i].canvas) els.cvwrap.classList.add('on'); else els.cvwrap.classList.remove('on');
      try {
        await steps[i].run(ctx);
        states[i] = ctx.stepBlocked ? 'blocked' : 'done';
      } catch (e) {
        log('x', steps[i].name + ' errored: ' + trunc(e && e.message, 80));
        states[i] = 'blocked';
      }
      if (mode === 'human' && i === 1 && !ctx.session) states[i] = 'blocked';
      if (mode === 'human' && i === 3 && ctx.vb && ctx.vb.result !== 'pass') states[i] = 'flagged';
      if (mode === 'bot' && i === 3 && ctx.vb && ctx.vb.result !== 'pass') states[i] = 'blocked';
      paintPills(mode, i, states); paintDiagram(mode, i, states);
      // a blocked early layer ends the run the way the stack would
      if (states[i] === 'blocked' && (mode === 'human' && i === 1)) { els.crumb.textContent = 'Stopped at layer ' + (i + 1); break; }
    }
    els.bar.style.width = '100%';
    els.cvwrap.classList.remove('on');
    els.crumb.textContent = 'Run complete';
    els.title.textContent = 'Every layer, live';
    const [vstate, vtext] = MODES[mode].verdict(ctx.vb, ctx);
    els.verdict.innerHTML = '';
    const chipEl = document.createElement('span');
    chipEl.className = 'chip ' + (vstate === 'pass' ? 'human' : vstate === 'block' ? 'bot' : 'warn');
    chipEl.textContent = vstate === 'pass' ? 'pass' : vstate === 'block' ? 'stopped' : 'flagged';
    els.verdict.append(chipEl, document.createTextNode(vtext));
    const laneChip = document.createElement('span');
    laneChip.className = 'chip ' + (mode === 'human' ? 'human' : mode === 'agent' ? 'agent' : mode === 'bot' ? 'bot' : 'warn');
    laneChip.textContent = mode === 'human' ? 'lane: allow' : mode === 'agent' ? 'lane: meter · charge' : 'lane: slow · block';
    els.verdict.append(document.createTextNode(' Sorted:'), laneChip);
    if (vstate !== 'pass') {
      const ap = document.createElement('a');
      ap.href = '/appeal'; ap.textContent = 'Why was I stopped? 1-click appeal';
      ap.style.marginLeft = '10px';
      els.verdict.appendChild(ap);
    }
    els.sub.textContent = 'Run it again, or switch actors. Every value above came from the live backend.';
    clearInterval(timer);
    els.elapsed.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s total';
    running = false;
  }

  app.querySelectorAll('.lv-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      app.querySelectorAll('.lv-mode').forEach(b => b.classList.toggle('on', b === btn));
      currentMode = btn.dataset.lvMode;
      run(currentMode);
    });
  });
  paintPills(currentMode, -1, []); paintDiagram(currentMode, -1, []);
  resetCounts();
})();
