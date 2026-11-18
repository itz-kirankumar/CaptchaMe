/* CaptchaMe embeddable widget. One script tag adds a human check to any page:
   <script src="https://captchame.vercel.app/widget.js" data-site="YOUR_SITE_KEY"></script>
   On success the page gets a CustomEvent 'captchame:pass' with {pass_token, score, site};
   name a global callback in data-onpass to be called with the same detail. */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var site = s.getAttribute('data-site') || 'demo-site';
  var onpass = s.getAttribute('data-onpass');
  var origin = new URL(s.src).origin;
  var f = document.createElement('iframe');
  f.src = origin + '/check?embed=1&site=' + encodeURIComponent(site);
  f.title = 'CaptchaMe human check';
  f.setAttribute('allow', 'microphone');
  f.style.cssText = 'width:100%;max-width:640px;height:720px;border:0;border-radius:18px;background:#07080c;display:block;';
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== 'captchame:pass') return;
    var detail = { pass_token: e.data.pass_token, score: e.data.score, site: site };
    document.dispatchEvent(new CustomEvent('captchame:pass', { detail: detail }));
    if (onpass && typeof window[onpass] === 'function') window[onpass](detail);
  });
})();
