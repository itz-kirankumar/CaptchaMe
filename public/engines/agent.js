'use strict';
const log = document.getElementById('log');
function line(text, cls) {
  const d = document.createElement('div');
  if (cls) d.innerHTML = `<span class="tag ${cls}">${cls}</span>`;
  d.appendChild(document.createTextNode(text));
  log.appendChild(d);
}
function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }

document.getElementById('run').addEventListener('click', async () => {
  log.innerHTML = '';
  try {
    line('Generating Ed25519 keypair...', 'agent');
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pub = b64(await crypto.subtle.exportKey('spki', kp.publicKey));

    const n = await (await fetch('/api/agent/nonce', { method: 'POST' })).json();
    line('Got nonce, signing...', 'agent');
    const sig = b64(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(n.nonce)));

    const d = await (await fetch('/api/agent/declare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: pub, signature: sig, nonce: n.nonce, operator: 'browser demo agent' }),
    })).json();
    if (d.result !== 'declared') return line('Declaration failed: ' + (d.reason || 'unknown'), 'fail');
    line(`Declared as ${d.actor}. Budget: $${d.budget.toFixed(2)}. No puzzle solved, no human faked.`, 'pass');

    for (let i = 0; i < 30; i++) {
      const r = await fetch('/api/protected/quote', { headers: { Authorization: 'Bearer ' + d.agent_token } });
      const b = await r.json();
      if (r.status === 429) {
        line(`Cap hit: ${b.reason}`, 'blocked');
        line(`Appeal offered at ${b.appeal_url} - a human reviews it. That is the deal.`, 'appeal');
        break;
      }
      if (!r.ok) { line(`Stopped: ${b.reason || r.status}`, 'fail'); break; }
      line(`Call ${i + 1}: served, $${b.remaining.toFixed(2)} left`, 'call');
      await new Promise(res => setTimeout(res, 250));
    }
  } catch (e) { line('Error: ' + e.message, 'fail'); }
});
