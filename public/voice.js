'use strict';
const wordBox = document.getElementById('wordBox');
const prog = document.getElementById('prog');
const statusEl = document.getElementById('status');
const out = document.getElementById('out');

const ENV = (() => { try { return { webdriver: navigator.webdriver === true, plugins: navigator.plugins ? navigator.plugins.length : 0, hardware: navigator.hardwareConcurrency || 0 }; } catch { return {}; } })();
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

document.getElementById('perm').addEventListener('click', async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    statusEl.textContent = 'Microphone allowed. You can start.';
  } catch (e) {
    statusEl.textContent = 'Microphone blocked: ' + e.message;
  }
});

document.getElementById('start').addEventListener('click', async () => {
  out.innerHTML = '';
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { statusEl.textContent = 'Microphone is required for this path: ' + e.message; return; }

  const r = await post('/api/challenge/start', { type: 'voice' });
  if (r.status !== 200) { statusEl.textContent = 'Could not start: ' + (r.body.reason || r.status); return; }
  const { words, cadence } = r.body.params;

  // speech recognition for the "what did they say" half
  let transcript = '';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (SR) {
    rec = new SR();
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => { for (const res of e.results) if (res.isFinal) transcript += ' ' + res[0].transcript; };
    try { rec.start(); } catch {}
  }

  // mic level for the "when did they answer" half
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);

  const t0 = performance.now();
  const wordTimings = [];
  let curWord = -1, promptStartMs = 0, onsetMs = null;

  function level() {
    an.getFloatTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function sample() {
    const t = performance.now() - t0;
    if (curWord >= 0 && onsetMs === null && level() > 0.03) onsetMs = t;
    if (curWord >= 0 && onsetMs === null && t - promptStartMs > 2600) onsetMs = t; // gave up waiting
    if (t < totalMs + 1500) requestAnimationFrame(sample);
  }

  let t = 800;
  const schedule = words.map((w, i) => { const at = t; t += cadence[i]; return { w, at }; });
  const totalMs = t;
  requestAnimationFrame(sample);

  for (let i = 0; i < schedule.length; i++) {
    const { w, at } = schedule[i];
    await new Promise(res => setTimeout(res, at - (performance.now() - t0)));
    curWord = i; promptStartMs = performance.now() - t0; onsetMs = null;
    wordBox.textContent = w;
    prog.style.width = ((i + 1) / words.length * 100) + '%';
    try {
      const u = new SpeechSynthesisUtterance(w); u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch {}
    // wait out the cadence window while the sampler hunts for the onset
    await new Promise(res => setTimeout(res, cadence[i]));
    wordTimings.push({ word: w, promptStartMs: Math.round(promptStartMs), onsetMs: onsetMs === null ? Math.round(promptStartMs + 2600) : Math.round(onsetMs) });
  }
  wordBox.textContent = 'Checking...';

  if (rec) { try { rec.stop(); } catch {} }
  await new Promise(res => setTimeout(res, 700)); // let final ASR results land
  stream.getTracks().forEach(tr => tr.stop());
  try { ac.close(); } catch {}

  const res = await post('/api/challenge/submit', {
    env: ENV,
    session: r.body.session,
    wordTimings,
    transcript: transcript.trim(),
  });
  const b = res.body;
  const d = document.createElement('div');
  if (b.result === 'pass') {
    d.className = 'result pass';
    d.textContent = `Passed (score ${b.score}). Your words matched and a live voice answered. $${b.budget_added.toFixed(2)} added to your allowance.`;
    out.appendChild(d);
    setTimeout(() => location.href = '/use.html', 1600);
  } else {
    d.className = 'result fail';
    d.textContent = `Not passed (score ${b.score}).\n${b.reason || ''}\n\nYou can retry here, or use the ring or beat path instead.`;
    out.appendChild(d);
  }
  wordBox.textContent = 'Press start when ready';
});
