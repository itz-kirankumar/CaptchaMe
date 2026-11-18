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
      (d.tier === 'nudge' ? '<p class="note">Hold the Create account button and let go when it turns green.</p>' : '') +
      (d.tier === 'challenge' ? '<p class="note">A live check opens in an overlay. Only traffic like this ever sees one.</p>' : '');
  }
  function passed(token, info) {
    out.insertAdjacentHTML('beforeend', '<div class="result pass" style="margin-top:12px">Pass <code>' + esc(token.slice(0, 18)) + '...</code> issued' + (info && info.tier === 'challenge-passed' ? ' after the live check' : '') + '. It works once, for 5 minutes, only from this browser and only for this exact form.</div>');
  }
  window.CaptchaMe.protect(form, { autoSubmit: false, onDecision: render, onPass: passed });

  document.getElementById('botFill').addEventListener('click', () => {
    out.innerHTML = '<p class="note">A script fills the fields and submits the form in one go...</p>';
    form.elements.name.value = 'Bot McBotface';
    form.elements.email.value = 'farm-' + Math.floor(Math.random() * 1e6) + '@mailinator.com';
    form.requestSubmit();
  });
})();
