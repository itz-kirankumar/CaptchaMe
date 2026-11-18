/* CaptchaMe widget.
 *
 * Invisible mode (recommended): protect a form; most people never see a check.
 *   <script src="https://captchame.vercel.app/widget.js" data-form="#signup"></script>
 *   or in code:  CaptchaMe.protect(formElement, { onPass(token, info) {}, onDecision(d) {} })
 *   On submit the widget asks the server, using HOW the form was filled (key
 *   timings, never key values; paste and autofill; pointer path; time on page):
 *     pass      -> a hidden field gets a pass bound to this browser and to the
 *                  exact form contents, then the form submits as normal
 *     nudge     -> the submit button becomes "hold, release on green" (~1 s)
 *     challenge -> a full live check opens in an overlay (strong signals only)
 *
 * Visible mode (the earlier behaviour): a check box in the page.
 *   <script src="https://captchame.vercel.app/widget.js" data-site="your-site" data-onpass="fn"></script>
 */
(function () {
  'use strict';
  var s = document.currentScript;
  var ORIGIN = s ? new URL(s.src).origin : location.origin;

  var RTT = null, RTT_STARTED = false;
  function measureRtt() {
    if (RTT_STARTED) return Promise.resolve(RTT);
    RTT_STARTED = true;
    var ts = [];
    function once() { var t0 = performance.now(); return fetch(ORIGIN + '/api/ping', { cache: 'no-store' }).then(function () { ts.push(performance.now() - t0); }); }
    return once().then(once).then(function () { RTT = Math.round(Math.min.apply(null, ts)); return RTT; }).catch(function () { return null; });
  }

  // One page nonce per page view, shared by every protected form on the page.
  var CM_NONCE = null, CM_NONCE_FIELD = null, CM_NONCE_STARTED = false;
  function fetchNonce() {
    if (CM_NONCE_STARTED) return Promise.resolve(CM_NONCE);
    CM_NONCE_STARTED = true;
    return fetch(ORIGIN + '/api/page/nonce', { cache: 'no-store', credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.nonce) { CM_NONCE = d.nonce; CM_NONCE_FIELD = d.field || null; } return CM_NONCE; })
      .catch(function () { return null; });
  }

  function post(url, body) {
    if (url === '/api/challenge/start') {
      measureRtt();
      return fetchNonce().then(function () {
        return send(url, CM_NONCE ? Object.assign({}, body, { page_nonce: CM_NONCE }) : body);
      });
    }
    if (url === '/api/challenge/submit') {
      return measureRtt().then(function (rtt) { return send(url, rtt != null ? Object.assign({}, body, { rtt_ms: rtt }) : body); });
    }
    return send(url, body);
  }
  function send(url, b) {
    return fetch(ORIGIN + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      .then(function (r) { return r.json(); });
  }

  // Canonical form hash: SHA-256 of the sorted [name, value] pairs, ignoring the
  // pass field and file inputs. Your server computes the same over what it got.
  function formHash(form, field) {
    var pairs = [];
    new FormData(form).forEach(function (v, k) { if (k !== field && typeof v === 'string') pairs.push([k, v]); });
    pairs.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(pairs))).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  function protect(form, opts) {
    opts = opts || {};
    if (!form || form.__captchame) return;
    form.__captchame = true;
    // Per-session random field name, replaced by the server-issued one once the
    // page nonce arrives: extensions cannot hook a fixed captchame_pass input.
    var field = opts.field || 'cm_' + Math.random().toString(36).slice(2, 12);
    var pageNonce = null;
    var nonceReady = fetchNonce().then(function () { pageNonce = CM_NONCE; if (CM_NONCE_FIELD && !opts.field) field = CM_NONCE_FIELD; });
    var fields = new Map(), pointer = [], ptype = 'mouse', scrolls = 0, busy = false, submitter = null;

    function rec(el) {
      if (!fields.has(el)) fields.set(el, { keys: [], pasted: false, autofilled: false, down: {}, lastUp: null });
      return fields.get(el);
    }
    var isInput = function (el) { return el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button'; };
    form.addEventListener('keydown', function (e) { if (!e.isTrusted || !isInput(e.target) || e.repeat) return; rec(e.target).down[e.code] = performance.now(); }, true);
    form.addEventListener('keyup', function (e) {
      if (!isInput(e.target)) return;
      var r = rec(e.target), d = r.down[e.code];
      if (d == null) return;
      var now = performance.now();
      r.keys.push({ d: Math.round(now - d), f: r.lastUp == null ? null : Math.round(d - r.lastUp) });
      if (r.keys.length > 400) r.keys.shift();
      r.lastUp = now; delete r.down[e.code];
    }, true);
    form.addEventListener('paste', function (e) { if (isInput(e.target)) rec(e.target).pasted = true; }, true);
    form.addEventListener('input', function (e) {
      if (!e.isTrusted || !isInput(e.target)) return;
      var r = rec(e.target);
      if ((!e.inputType || e.inputType === 'insertReplacementText') && !Object.keys(r.down).length) r.autofilled = true;
    }, true);
    document.addEventListener('pointermove', function (e) {
      ptype = e.pointerType || ptype;
      pointer.push({ t: Math.round(e.timeStamp), x: Math.round(e.clientX), y: Math.round(e.clientY) });
      if (pointer.length > 400) pointer.shift();
    }, { passive: true });
    addEventListener('scroll', function () { scrolls++; }, { passive: true });
    form.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[type=submit],button:not([type])'); if (b) submitter = b; }, true);

    function telemetry(trusted) {
      var list = [];
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!isInput(el)) return;
        var r = fields.get(el) || { keys: [], pasted: false, autofilled: false };
        list.push({ keys: r.keys, pasted: r.pasted, autofilled: r.autofilled, chars: String(el.value || '').length });
      });
      return { timeOnPageMs: Math.round(performance.now()), fields: list, pointer: pointer.slice(-120), pointerType: ptype, scrolls: scrolls, trustedSubmit: trusted, env: { webdriver: navigator.webdriver === true } };
    }

    function finish(token, info) {
      var input = form.querySelector('input[name="' + field + '"]');
      if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = field; form.appendChild(input); }
      input.value = token;
      busy = false;
      if (typeof opts.onPass === 'function') opts.onPass(token, info);
      form.dispatchEvent(new CustomEvent('captchame:pass', { detail: { pass_token: token, info: info } }));
      if (opts.autoSubmit !== false) { form.__cmPassed = true; if (form.requestSubmit) form.requestSubmit(submitter || undefined); else form.submit(); }
    }

    form.addEventListener('submit', function (e) {
      if (form.__cmPassed) { form.__cmPassed = false; return; }
      e.preventDefault();
      if (busy) return;
      busy = true;
      var trusted = e.isTrusted;
      nonceReady.then(function () { return formHash(form, field); }).then(function (hash) {
        return post('/api/pass/silent', { telemetry: telemetry(trusted), form_hash: hash, page_nonce: pageNonce }).then(function (d) {
          if (typeof opts.onDecision === 'function') opts.onDecision(d);
          if (d.tier === 'pass') return finish(d.pass_token, d);
          if (d.tier === 'nudge') return nudge(d, hash);
          return stepUp(hash, d);
        });
      }).catch(function () { busy = false; stepUp(null, { reasons: ['could not reach the verification service'] }); });
    });

    // Rung 1b: hold the submit button, release when it turns green.
    function nudge(d, hash) {
      var btn = submitter || form.querySelector('[type=submit],button:not([type])');
      if (!btn) return stepUp(hash, d);
      var label = btn.textContent, bg = btn.style.background, col = btn.style.color;
      var note = document.createElement('div');
      note.setAttribute('role', 'status');
      note.style.cssText = 'font:13px/1.4 system-ui,sans-serif;margin-top:8px;opacity:.85';
      note.innerHTML = 'Quick check: hold the button, let go when it turns green. <a href="#" style="color:inherit">Use another way</a>';
      btn.insertAdjacentElement('afterend', note);
      btn.textContent = 'Hold to confirm';
      var pressAt = null, goShownAt = null, timer = null, done = false;
      function reset(msg) { clearTimeout(timer); pressAt = goShownAt = null; btn.style.background = bg; btn.style.color = col; btn.textContent = msg || 'Hold to confirm'; }
      function down(e) {
        if (done || pressAt !== null) return;
        if (e.type === 'keydown' && e.code !== 'Space' && e.code !== 'Enter') return;
        e.preventDefault();
        pressAt = performance.now();
        btn.textContent = 'Hold...';
        timer = setTimeout(function () {
          requestAnimationFrame(function (ts) { goShownAt = performance.now(); btn.style.background = '#2fd07a'; btn.style.color = '#04210f'; btn.textContent = 'Release'; });
        }, d.params.goAfterMs);
      }
      function up(e) {
        if (done || pressAt === null) return;
        if (e.type === 'keyup' && e.code !== 'Space' && e.code !== 'Enter') return;
        e.preventDefault();
        if (goShownAt === null) return reset('Too early: hold until it turns green');
        done = true;
        var body = { session: d.session, pressAt: Math.round(pressAt), goShownAt: Math.round(goShownAt), releaseAt: Math.round(performance.now()), trusted: e.isTrusted, page_nonce: pageNonce };
        cleanup();
        post('/api/pass/nudge', body).then(function (r) {
          if (typeof opts.onDecision === 'function') opts.onDecision(Object.assign({ step: 'nudge' }, r));
          if (r.tier === 'pass') finish(r.pass_token, r); else stepUp(hash, r);
        });
      }
      function block(e) { e.preventDefault(); e.stopPropagation(); }
      function cleanup() {
        btn.removeEventListener('pointerdown', down); btn.removeEventListener('pointerup', up); btn.removeEventListener('pointerleave', leave);
        btn.removeEventListener('keydown', down); btn.removeEventListener('keyup', up); btn.removeEventListener('click', block, true);
        note.remove(); reset(); btn.textContent = label;
      }
      function leave() { if (!done && pressAt !== null) reset('Keep holding until it turns green'); }
      btn.addEventListener('pointerdown', down); btn.addEventListener('pointerup', up); btn.addEventListener('pointerleave', leave);
      btn.addEventListener('keydown', down); btn.addEventListener('keyup', up); btn.addEventListener('click', block, true);
      note.querySelector('a').addEventListener('click', function (e) { e.preventDefault(); done = true; cleanup(); stepUp(hash, { reasons: ['visitor chose another way'] }); });
    }

    // Rung 3: a full live check in an overlay, only for strong signals.
    // Rendered inside a closed shadow root so page extensions cannot hook the
    // overlay's DOM or read the challenge iframe from outside.
    function stepUp(hash, d) {
      var host = document.createElement('div');
      document.body.appendChild(host);
      var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(5,6,10,.72);display:flex;align-items:center;justify-content:center;padding:16px';
      var box = document.createElement('div');
      box.style.cssText = 'position:relative;width:100%;max-width:680px';
      var close = document.createElement('button');
      close.type = 'button'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close the check');
      close.style.cssText = 'position:absolute;top:-38px;right:0;background:#fff;color:#111;border:0;border-radius:8px;padding:6px 12px;font:600 13px system-ui;cursor:pointer';
      var f = document.createElement('iframe');
      f.src = ORIGIN + '/check?embed=1&format=auto' + (hash ? '&form=' + hash : '');
      f.title = 'CaptchaMe check'; f.setAttribute('allow', 'microphone');
      f.style.cssText = 'width:100%;height:min(760px,86vh);border:0;border-radius:18px;background:#07080c;display:block';
      box.appendChild(close); box.appendChild(f); wrap.appendChild(box); root.appendChild(wrap);
      function onMsg(e) {
        if (e.origin !== ORIGIN || !e.data || e.data.type !== 'captchame:pass') return;
        removeEventListener('message', onMsg); host.remove();
        finish(e.data.pass_token, { tier: 'challenge-passed', score: e.data.score });
      }
      addEventListener('message', onMsg);
      close.onclick = function () { removeEventListener('message', onMsg); host.remove(); busy = false; };
      if (typeof opts.onStepUp === 'function') opts.onStepUp(d);
    }
  }

  window.CaptchaMe = { protect: protect, formHash: formHash, origin: ORIGIN };

  if (!s) return;
  var target = s.getAttribute('data-form');
  if (target) {
    var go = function () { var form = document.querySelector(target); if (form) protect(form, { field: s.getAttribute('data-field') || undefined, onPass: s.getAttribute('data-onpass') && window[s.getAttribute('data-onpass')] }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
    return;
  }

  // Visible mode: the check box in the page (needs data-site or data-mode="challenge";
  // a bare <script src="widget.js"> only exposes window.CaptchaMe).
  if (!s.hasAttribute('data-site') && s.getAttribute('data-mode') !== 'challenge') return;
  var site = s.getAttribute('data-site') || 'demo-site';
  var onpass = s.getAttribute('data-onpass');
  var fr = document.createElement('iframe');
  fr.src = ORIGIN + '/check?embed=1&site=' + encodeURIComponent(site);
  fr.title = 'CaptchaMe human check';
  fr.setAttribute('allow', 'microphone');
  fr.style.cssText = 'width:100%;max-width:640px;height:720px;border:0;border-radius:18px;background:#07080c;display:block;';
  s.parentNode.insertBefore(fr, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.type !== 'captchame:pass') return;
    var detail = { pass_token: e.data.pass_token, score: e.data.score, site: site };
    document.dispatchEvent(new CustomEvent('captchame:pass', { detail: detail }));
    if (onpass && typeof window[onpass] === 'function') window[onpass](detail);
  });
})();
