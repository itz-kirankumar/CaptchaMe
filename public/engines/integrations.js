(function () {
  'use strict';
  const box = document.getElementById('snips');
  if (!box) return;
  box.querySelectorAll('[data-code]').forEach(c => { c.textContent = c.textContent.split('{ORIGIN}').join(location.origin); });
  box.addEventListener('click', async e => {
    const tab = e.target.closest('[data-snip]');
    if (tab) {
      const id = tab.getAttribute('data-snip');
      box.querySelectorAll('[data-snip]').forEach(b => b.classList.toggle('on', b === tab));
      box.querySelectorAll('[data-pane]').forEach(p => { p.style.display = p.getAttribute('data-pane') === id ? 'block' : 'none'; });
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const code = box.querySelector('[data-code="' + cp.getAttribute('data-copy') + '"]').textContent;
      try { await navigator.clipboard.writeText(code); cp.textContent = 'Copied'; } catch { cp.textContent = 'Select and copy'; }
      setTimeout(() => { cp.textContent = 'Copy'; }, 1400);
    }
  });
})();
