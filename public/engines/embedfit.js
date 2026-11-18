(function () {
  'use strict';
  // Embedded CaptchaMe checks report their height; grow the matching iframe
  // so the play field is never hidden behind an inner scrollbar.
  if (window.__cmEmbedFit) return;
  window.__cmEmbedFit = true;
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || d.type !== 'captchame:height' || !(d.height > 0)) return;
    for (const f of document.querySelectorAll('iframe')) {
      if (f.contentWindow === e.source) f.style.height = Math.min(Math.max(d.height + 2, 320), 2400) + 'px';
    }
  });
})();
