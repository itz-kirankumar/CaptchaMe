(function () {
  'use strict';
const wordBox = document.getElementById('wordBox');
const prog = document.getElementById('prog');
const statusEl = document.getElementById('status');
const out = document.getElementById('out');

const ENV = (() => { try { return { webdriver: navigator.webdriver === true, plugins: navigator.plugins ? navigator.plugins.length : 0, hardware: navigator.hardwareConcurrency || 0 }; } catch { return {}; } })();
let RTT = null, RTT_STARTED = false;
async function measureRtt() {
  if (RTT_STARTED) return RTT;
  RTT_STARTED = true;
  try {
    const ts = [];
    for (let i = 0; i < 2; i++) { const t0 = performance.now(); await fetch('/api/ping', { cache: 'no-store' }); ts.push(performance.now() - t0); }
    RTT = Math.round(Math.min.apply(null, ts));
  } catch { RTT = null; }
  return RTT;
}

async function post(url, body) {
  if (url === '/api/challenge/start') measureRtt();
  if (url === '/api/challenge/submit') {
    const rtt = await measureRtt();
    if (rtt != null) body = { ...body, rtt_ms: rtt };
  }
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

  // record the whole check so the server can transcribe it (Sarvam), with the
  // browser's own speech recognition as the fallback
  let recorder = null, chunks = [];
  try {
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.start(500);
  } catch {}

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

  // prefer the server-side Sarvam transcript; fall back to Web Speech
  let engine = rec ? 'web-speech' : 'none';
  if (recorder && recorder.state !== 'inactive') {
    try {
      const blob = await new Promise(res2 => { recorder.onstop = () => res2(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })); recorder.stop(); });
      if (blob.size > 500) {
        const b64 = await new Promise(res2 => { const fr = new FileReader(); fr.onload = () => res2(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
        statusEl.textContent = 'Transcribing...';
        const stt = await post('/api/voice/stt', { session: r.body.session, audio: b64, mime: blob.type });
        if (stt.status === 200 && stt.body.transcript) { transcript = ' ' + stt.body.transcript; engine = 'sarvam'; }
      }
    } catch {}
  }
  stream.getTracks().forEach(tr => tr.stop());
  try { ac.close(); } catch {}

  const res = await post('/api/challenge/submit', {
    env: ENV,
    session: r.body.session,
    wordTimings,
    transcript: transcript.trim(),
  });
  statusEl.textContent = engine === 'sarvam' ? 'Transcribed by Sarvam on the server.' : 'Transcribed in your browser.';
  verdict(out, res, { failHint: 'You can retry here, or use a pointer format instead.' });
  wordBox.textContent = 'Press start when ready';
});
})();
