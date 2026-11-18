(function () {
  'use strict';
  // Admin views show live visitor data, so they need the server's admin key.
  // There is no default key. The key is kept for this browser tab only.
  const K = 'cm-admin-key';
  const get = () => { try { return sessionStorage.getItem(K) || ''; } catch { return ''; } };
  const set = v => { try { sessionStorage.setItem(K, v); } catch { /* private mode */ } };
  const del = () => { try { sessionStorage.removeItem(K); } catch { /* private mode */ } };
  const fromUrl = new URLSearchParams(location.search).get('key');
  if (fromUrl) {
    set(fromUrl);
    // keep the key out of the address bar, history and screenshots
    const u = new URL(location.href); u.searchParams.delete('key'); history.replaceState(null, '', u.pathname + u.search + u.hash);
  }

  function gate(wrong) {
    if (document.querySelector('.admingate')) return;
    const main = document.querySelector('main') || document.body;
    const box = document.createElement('div');
    box.className = 'card admingate';
    box.innerHTML = '<h2>Admin key needed</h2>' +
      '<p class="note">' + (wrong ? 'That key was not accepted. ' : '') + 'This view shows live visitor data. Use the server&rsquo;s <code>POP_ADMIN_KEY</code>; if it is not set, the server prints a key for the current run in its log when it starts.</p>' +
      '<form class="row"><input type="password" autocomplete="off" placeholder="admin key" aria-label="Admin key" required style="max-width:280px"><button type="submit">Unlock</button></form>';
    box.querySelector('form').addEventListener('submit', e => { e.preventDefault(); set(box.querySelector('input').value.trim()); location.reload(); });
    main.prepend(box);
  }
  // opts.gate === false: fail quietly instead of showing the key form
  async function api(url, opts = {}) {
    const { gate: useGate = true, ...rest } = opts;
    const k = get();
    if (!k) { if (useGate) gate(false); throw new Error('no admin key'); }
    const r = await fetch(url, { cache: 'no-store', ...rest, headers: { ...(rest.headers || {}), 'X-Admin-Key': k } });
    if (r.status === 403) { del(); if (useGate) gate(true); throw new Error('forbidden'); }
    return r;
  }
  window.CMAdmin = { api, key: get, gate };
})();
