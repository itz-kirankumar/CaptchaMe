'use strict';
// Live attack demo. Run against a running server while the dashboard is open:
//   node demo/bots.js http://localhost:3000
// Each attack is caught and shows up on the dashboard in real time.
const crypto = require('crypto');
const actors = require('./actors');
const BASE = process.argv[2] || 'http://localhost:3000';

async function post(path, body, headers = {}) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('Attacking', BASE, '- watch the dashboard\n');

  console.log('1. Script bot: read the ring path from the challenge and follow it perfectly');
  {
    const s = await post('/api/challenge/start', { type: 'ring' });
    const r = await post('/api/challenge/submit', { session: s.body.session, samples: actors.scriptRing(s.body.params) });
    console.log('   ->', r.body.result, '| score', r.body.score, '|', r.body.flags[0] || '');
  }
  await sleep(800);

  console.log('2. Look-think-act agent: re-aims every 1.8s, glides in straight lines');
  {
    const s = await post('/api/challenge/start', { type: 'ring' });
    const r = await post('/api/challenge/submit', { session: s.body.session, samples: actors.agentRing(s.body.params) });
    console.log('   ->', r.body.result, '| score', r.body.score, '|', r.body.flags[0] || '');
  }
  await sleep(800);

  console.log('3. Beat bot: taps at machine-perfect 0 ms');
  {
    const s = await post('/api/challenge/start', { type: 'beat' });
    const r = await post('/api/challenge/submit', { session: s.body.session, taps: actors.scriptBeat(s.body.params.beats) });
    console.log('   ->', r.body.result, '| score', r.body.score, '|', r.body.flags[0] || '');
  }
  await sleep(800);

  console.log('4. Voice playback bot: same 500 ms latency every word');
  {
    const s = await post('/api/challenge/start', { type: 'voice' });
    const r = await post('/api/challenge/submit', { session: s.body.session, ...actors.botVoice(s.body.params.words) });
    console.log('   ->', r.body.result, '| score', r.body.score, '|', r.body.flags[0] || '');
  }
  await sleep(800);

  console.log('5. Reflex script: clicks 40 ms after every flash, like a timer');
  {
    const s = await post('/api/challenge/start', { type: 'reflex' });
    const r = await post('/api/challenge/submit', { session: s.body.session, clicks: actors.scriptReflex(s.body.params.rounds) });
    console.log('   ->', r.body.result, '| score', r.body.score, '|', r.body.flags[0] || '');
  }
  await sleep(800);

  console.log('6. Slow agent on the flash check: reacts in 1.35 s, misses every window');
  {
    const s = await post('/api/challenge/start', { type: 'reflex' });
    const r = await post('/api/challenge/submit', { session: s.body.session, clicks: actors.agentReflex(s.body.params.rounds) });
    console.log('   ->', r.body.result, '| score', r.body.score, '|', r.body.flags[0] || '');
  }
  await sleep(800);

  console.log('7. DOM-reading agent: follows the hidden verification link only a program can see');
  {
    const r = await fetch(BASE + '/trap');
    console.log('   -> HTTP', r.status, '| logged as automated traffic on the dashboard');
  }
  await sleep(800);

  console.log('8. Replay attack: steal a finished session and answer it again');
  {
    const s = await post('/api/challenge/start', { type: 'beat' });
    await post('/api/challenge/submit', { session: s.body.session, taps: actors.humanBeat(s.body.params.beats, 5) });
    const r = await post('/api/challenge/submit', { session: s.body.session, taps: actors.humanBeat(s.body.params.beats, 5) });
    console.log('   -> HTTP', r.status, '|', r.body.reason);
  }
  await sleep(800);

  console.log('9. Scraper: hammer the protected API with no presence, no declaration');
  {
    const jar = [];
    for (let i = 0; i < 9; i++) {
      const headers = jar.length ? { Cookie: jar.join('; ') } : {};
      const r = await fetch(BASE + '/api/protected/quote', { headers });
      const sc = r.headers.get('set-cookie'); if (sc) jar.push(sc.split(';')[0]);
      if (r.status === 429) { const b = await r.json(); console.log('   -> capped after', i, 'calls |', b.reason.slice(0, 90) + '...'); break; }
    }
  }
  await sleep(800);

  console.log('10. The honest agent: declares with a signed key, no puzzle, own budget');
  {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const n = await post('/api/agent/nonce', {});
    const sig = crypto.sign(null, Buffer.from(n.body.nonce, 'utf8'), privateKey).toString('base64');
    const d = await post('/api/agent/declare', { pubkey: pub, signature: sig, nonce: n.body.nonce, operator: 'stage demo agent' });
    console.log('   ->', d.body.result, '| actor', d.body.actor, '| budget $' + d.body.budget.toFixed(2));
    for (let i = 0; i < 12; i++) {
      const r = await fetch(BASE + '/api/protected/quote', { headers: { Authorization: 'Bearer ' + d.body.agent_token } });
      const b = await r.json();
      if (r.status === 429) {
        console.log('   -> fair-share cap after', i, 'calls:', b.reason.slice(0, 80) + '...');
        const ap = await post('/api/appeal', { actor: d.body.actor, message: 'Demo agent asking nicely for a bigger allowance.' });
        console.log('   -> appeal filed, #' + ap.body.appeal_id, '(approve it live on the dashboard)');
        break;
      }
    }
  }
  console.log('\nDone. Every one of those is on the dashboard.');
})().catch(e => { console.error(e.message); process.exit(1); });
