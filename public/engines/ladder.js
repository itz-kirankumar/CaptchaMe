(function () {
  'use strict';
  const form = document.getElementById('ladderForm');
  if (!form || !window.CaptchaMe || form.__captchame) return;
  const out = document.getElementById('ladderOut');
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const TIER = { pass: ['human', 'Invisible pass'], nudge: ['warn', 'One-second button check'], challenge: ['bot', 'Full check required'] };

  function render(d) {
    if (d.step === 'nudge') {
      out.innerHTML = d.tier === 'pass'
        ? '<span class="chip human">button check passed</span><p class="note">' + esc(d.reason) + '. Pass issued.</p>'
        : '<span class="chip bot">button check failed</span><p class="note">' + esc(d.reason) + '. Opening a full check.</p>';
      return;
    }
    const [cls, label] = TIER[d.tier] || ['', d.tier];
    const lines = (d.tier === 'pass' ? d.evidence : d.reasons) || [];
    const det = d.detail || {};
    out.innerHTML = '<span class="chip ' + cls + '">' + label + '</span>' +
      (lines.length ? '<ul class="small" style="margin-top:10px">' + lines.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      '<p class="note small mono">time on page ' + Math.round((det.timeOnPageMs || 0) / 100) / 10 + ' s · ' + (det.keys || 0) + ' key timings · ' + (det.pointerSamples || 0) + ' pointer samples · network risk ' + (det.networkRisk || 0) + '</p>' +
      (d.tier === 'nudge' ? '<p class="note">Hold the Request access button and let go when it turns green.</p>' : '') +
      (d.tier === 'challenge' ? '<p class="note">A live check opens in an overlay. Only traffic like this ever sees one.</p>' : '');
  }
  // With a pass in hand, send the form to our own server, which verifies the
  // pass (this browser, these exact values, one use) before saving anything.
  async function passed(token, info) {
    const body = { name: form.elements.name.value, email: form.elements.email.value, cm_pass: token };
    let r, b = {};
    try { r = await fetch('/api/early-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); b = await r.json().catch(() => ({})); } catch { b = { reason: 'Could not reach the server.' }; }
    const ok = r && r.ok;
    out.insertAdjacentHTML('beforeend', '<div class="result ' + (ok ? 'pass' : 'fail') + '" style="margin-top:12px">' +
      (ok ? esc(b.reason) + (info && info.tier === 'challenge-passed' ? ' (after the live check)' : '') : 'Not sent: ' + esc(b.reason || 'the server refused the pass')) + '</div>');
    if (ok) form.reset();
  }
  window.CaptchaMe.protect(form, { autoSubmit: false, onDecision: render, onPass: passed });
})();
