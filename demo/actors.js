'use strict';
// Synthetic actors for tests and the live attack demo.
// Human generators add the mess real people have; bot generators don't.

function gauss(rng) { return (rng() + rng() + rng() + rng() - 2) * 0.5; }
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function targetAt(P, tms) {
  const t = tms / 1000;
  let px = P.px, py = P.py;
  for (const d of (P.darts || [])) { if (tms >= d.at) { px = d.px; py = d.py; } }
  return {
    x: 0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + px),
    y: 0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + py),
  };
}

// A person: reaction lag ~180ms, wanders, constantly corrects.
function humanRing(P, seed = 1) {
  const rng = mulberry(seed);
  const lag = 140 + rng() * 120;
  const samples = [];
  let wx = 0, wy = 0; // slow wander
  let cx = null, cy = null; // carried position across darts
  for (let t = 0; t < P.durationMs; t += 16 + rng() * 6) {
    wx = wx * 0.95 + gauss(rng) * 0.004;
    wy = wy * 0.95 + gauss(rng) * 0.004;
    const g = targetAt(P, t - lag);
    if (cx === null) { cx = g.x; cy = g.y; }
    // people swoop toward the target, covering ~25%/tick: instant when close, visible recovery after a dart
    cx += (g.x - cx) * 0.25;
    cy += (g.y - cy) * 0.25;
    samples.push({ t: Math.round(t), x: +(cx + wx + gauss(rng) * 0.01).toFixed(4), y: +(cy + wy + gauss(rng) * 0.01).toFixed(4) });
  }
  return samples;
}

// A script: it read the path from the challenge response and follows it perfectly.
function scriptRing(P) {
  const samples = [];
  for (let t = 0; t < P.durationMs; t += 16) {
    const g = targetAt(P, t);
    samples.push({ t, x: +g.x.toFixed(4), y: +g.y.toFixed(4) });
  }
  return samples;
}

// A look-think-act agent: re-aims every ~1.8s, glides straight between aims, a second behind.
function agentRing(P) {
  const samples = [];
  const step = 1800;
  let aim = targetAt(P, 0), prev = aim;
  for (let t = 0; t < P.durationMs; t += 100) {
    if (t % step === 0) { prev = aim; aim = targetAt(P, t); }
    const k = (t % step) / step;
    samples.push({ t, x: +(prev.x + (aim.x - prev.x) * k).toFixed(4), y: +(prev.y + (aim.y - prev.y) * k).toFixed(4) });
  }
  return samples;
}

function humanBeat(beats, seed = 2) {
  const rng = mulberry(seed);
  return beats.map(b => Math.round(b - 60 + gauss(rng) * 70));
}
function scriptBeat(beats) { return beats.slice(); }

function humanVoice(words, seed = 3) {
  const rng = mulberry(seed);
  let t = 0;
  const wordTimings = words.map((w, i) => {
    const promptStartMs = t;
    t += 1400 + i * 320;
    return { word: w, promptStartMs, onsetMs: Math.round(promptStartMs + 550 + rng() * 700) };
  });
  return { wordTimings, transcript: words.join(' ') };
}
function botVoice(words) {
  let t = 0;
  const wordTimings = words.map((w, i) => { const promptStartMs = t; t += 1600; return { word: w, promptStartMs, onsetMs: promptStartMs + 500 }; });
  return { wordTimings, transcript: words.join(' ') };
}

// Reflex actors. rounds: [{at, windowMs}]
function humanReflex(rounds, seed = 4) {
  const rng = mulberry(seed);
  return rounds.map(r => Math.round(r.at + 180 + rng() * 260));
}
function scriptReflex(rounds) {
  return rounds.map(r => r.at + 40); // identical 40 ms every round: a timer
}
function agentReflex(rounds) {
  return rounds.map(r => r.at + 1350); // look-think-act loop: misses every sub-second window
}

// Adaptive script: knows the params AND fakes human jitter - lag, wander,
// noisy intervals. Its remaining tells: it submits instantly (wall clock),
// its noise is iid, and it has no embodiment. This is the strongest free
// scripted attacker we can build; the demo runs it honestly.
function adaptiveRing(P, seed = 9) {
  const rng = mulberry(seed);
  const samples = [];
  let lag = 150 + rng() * 100;
  let wx = 0, wy = 0;
  for (let t = 0; t < P.durationMs; t += 14 + rng() * 9) {
    lag += (rng() - 0.5) * 12;
    wx = wx * 0.93 + gauss(rng) * 0.005;
    wy = wy * 0.93 + gauss(rng) * 0.005;
    const g = targetAt(P, Math.max(0, t - lag));
    samples.push({ t: Math.round(t), x: +(g.x + wx + gauss(rng) * 0.012).toFixed(4), y: +(g.y + wy + gauss(rng) * 0.012).toFixed(4) });
  }
  return samples;
}
function adaptiveReflex(rounds, seed = 8) {
  const rng = mulberry(seed);
  return rounds.map(r => Math.round(r.at + 160 + rng() * 300));
}

// Pulse (dual-task) actors
function humanPulse(P, seed = 6) {
  const rng = mulberry(seed);
  const clicks = P.flashes.map(f => Math.round(f + 190 + rng() * 270));
  return { samples: humanRing(P, seed), clicks };
}
// step agent: reactions take 1.3s (miss the window) and tracking collapses after each flash
function agentPulse(P, seed = 6) {
  const samples = agentRing(P);
  for (const s of samples) {
    for (const f of P.flashes) {
      if (s.t >= f && s.t <= f + 600) { s.x = +(s.x + 0.3).toFixed(4); s.y = +(s.y - 0.25).toFixed(4); }
    }
  }
  return { samples, clicks: P.flashes.map(f => f + 1300) };
}
// wait-and-playback: full-duration, human-shaped samples, but channels
// synthesized independently: identical 210 ms reactions every flash
function playbackPulse(P, seed = 6) {
  return { samples: adaptiveRing(P, seed), clicks: P.flashes.map(f => f + 210) };
}
// TTS pipeline with added jitter: natural onset times, perfect transcript
function ttsJitterVoice(words, seed = 7) {
  const rng = mulberry(seed);
  let t = 0;
  const wordTimings = words.map((w, i) => {
    const promptStartMs = t;
    t += 1500 + rng() * 900;
    return { word: w, promptStartMs, onsetMs: Math.round(promptStartMs + 420 + rng() * 800) };
  });
  return { wordTimings, transcript: words.join(' ') };
}

module.exports = { humanRing, scriptRing, agentRing, humanBeat, scriptBeat, humanVoice, botVoice, humanReflex, scriptReflex, agentReflex, adaptiveRing, adaptiveReflex, humanPulse, agentPulse, playbackPulse, ttsJitterVoice };
