/*
 * Synthetic actors for the test suite, the attack demo and the in-browser dry
 * run. Human generators add the mess real people have; bot generators don't.
 * One file, loaded by Node (require) and by the browser (window.CMActors).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CMActors = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function gauss(rng) { return (rng() + rng() + rng() + rng() - 2) * 0.5; }
  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function targetAt(P, tms) {
    const t = tms / 1000;
    let px = P.px, py = P.py;
    for (const d of (P.darts || [])) { if (tms >= d.at) { px = d.px; py = d.py; } }
    return { x: 0.5 + P.ax * Math.sin(2 * Math.PI * P.fx * t + px), y: 0.5 + P.ay * Math.sin(2 * Math.PI * P.fy * t + py) };
  }

  // ---------- ring ----------
  // A person: reaction lag ~180 ms, wanders, constantly corrects.
  function humanRing(P, seed = 1) {
    const rng = mulberry(seed);
    const lag = 140 + rng() * 120;
    const samples = [];
    let wx = 0, wy = 0, cx = null, cy = null;
    for (let t = 0; t < P.durationMs; t += 16 + rng() * 6) {
      wx = wx * 0.95 + gauss(rng) * 0.004;
      wy = wy * 0.95 + gauss(rng) * 0.004;
      const g = targetAt(P, t - lag);
      if (cx === null) { cx = g.x; cy = g.y; }
      cx += (g.x - cx) * 0.25;
      cy += (g.y - cy) * 0.25;
      samples.push({ t: Math.round(t), x: +(cx + wx + gauss(rng) * 0.01).toFixed(4), y: +(cy + wy + gauss(rng) * 0.01).toFixed(4) });
    }
    return samples;
  }
  // A script: read the path from the challenge response and follows it perfectly.
  function scriptRing(P) {
    const samples = [];
    for (let t = 0; t < P.durationMs; t += 16) { const g = targetAt(P, t); samples.push({ t, x: +g.x.toFixed(4), y: +g.y.toFixed(4) }); }
    return samples;
  }
  // A look-think-act agent: re-aims every ~1.8 s, glides straight between aims.
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
  // Adaptive script: knows the params AND fakes human jitter. Its remaining
  // tells: it submits instantly (wall clock), its noise is iid, no embodiment.
  function adaptiveRing(P, seed = 9) {
    const rng = mulberry(seed);
    const samples = [];
    let lag = 150 + rng() * 100, wx = 0, wy = 0;
    for (let t = 0; t < P.durationMs; t += 14 + rng() * 9) {
      lag += (rng() - 0.5) * 12;
      wx = wx * 0.93 + gauss(rng) * 0.005;
      wy = wy * 0.93 + gauss(rng) * 0.005;
      const g = targetAt(P, Math.max(0, t - lag));
      samples.push({ t: Math.round(t), x: +(g.x + wx + gauss(rng) * 0.012).toFixed(4), y: +(g.y + wy + gauss(rng) * 0.012).toFixed(4) });
    }
    return samples;
  }

  // ---------- beat ----------
  function humanBeat(beats, seed = 2) { const rng = mulberry(seed); return beats.map(b => Math.round(b - 60 + gauss(rng) * 70)); }
  function scriptBeat(beats) { return beats.slice(); }

  // ---------- voice ----------
  function humanVoice(words, seed = 3) {
    const rng = mulberry(seed);
    let t = 0;
    const wordTimings = words.map((w, i) => { const promptStartMs = t; t += 1400 + i * 320; return { word: w, promptStartMs, onsetMs: Math.round(promptStartMs + 550 + rng() * 700) }; });
    return { wordTimings, transcript: words.join(' ') };
  }
  function botVoice(words) {
    let t = 0;
    const wordTimings = words.map(w => { const promptStartMs = t; t += 1600; return { word: w, promptStartMs, onsetMs: promptStartMs + 500 }; });
    return { wordTimings, transcript: words.join(' ') };
  }
  function ttsJitterVoice(words, seed = 7) {
    const rng = mulberry(seed);
    let t = 0;
    const wordTimings = words.map(w => { const promptStartMs = t; t += 1500 + rng() * 900; return { word: w, promptStartMs, onsetMs: Math.round(promptStartMs + 420 + rng() * 800) }; });
    return { wordTimings, transcript: words.join(' ') };
  }

  // ---------- reflex ----------
  function humanReflex(rounds, seed = 4) { const rng = mulberry(seed); return rounds.map(r => Math.round(r.at + 180 + rng() * 260)); }
  function scriptReflex(rounds) { return rounds.map(r => r.at + 40); }
  function agentReflex(rounds) { return rounds.map(r => r.at + 1350); }
  function adaptiveReflex(rounds, seed = 8) { const rng = mulberry(seed); return rounds.map(r => Math.round(r.at + 160 + rng() * 300)); }

  // ---------- pulse (dual task) ----------
  function humanPulse(P, seed = 6) { const rng = mulberry(seed); return { samples: humanRing(P, seed), clicks: P.flashes.map(f => Math.round(f + 190 + rng() * 270)) }; }
  function agentPulse(P) {
    const samples = agentRing(P);
    for (const s of samples) for (const f of P.flashes) if (s.t >= f && s.t <= f + 600) { s.x = +(s.x + 0.3).toFixed(4); s.y = +(s.y - 0.25).toFixed(4); }
    return { samples, clicks: P.flashes.map(f => f + 1300) };
  }
  function playbackPulse(P, seed = 6) { return { samples: adaptiveRing(P, seed), clicks: P.flashes.map(f => f + 210) }; }

  // ---------- clash (colour-word interference) ----------
  function clashResp(P, fn) { return P.trials.map((tr, i) => { const o = fn(tr, i); return o ? { i, t: Math.round(tr.at + o.rt), choice: o.choice } : null; }).filter(Boolean); }
  const other = (P, c) => P.colors.find(x => x !== c);
  function humanClash(P, seed = 41) {
    const rng = mulberry(seed);
    return clashResp(P, tr => {
      const inc = tr.word !== tr.ink;
      const rt = 520 + gauss(rng) * 300 + (inc ? 80 : 0);
      const slip = rng() < (inc ? 0.12 : 0.03);
      return { rt, choice: slip ? (inc ? tr.word : other(P, tr.ink)) : tr.ink };
    });
  }
  function scriptClash(P) { return clashResp(P, tr => ({ rt: 300, choice: tr.ink })); }
  function readerClash(P, seed = 42) { const rng = mulberry(seed); return clashResp(P, tr => ({ rt: 620 + gauss(rng) * 250, choice: tr.word })); }
  function adaptiveClash(P, seed = 43) { const rng = mulberry(seed); return clashResp(P, tr => ({ rt: 420 + rng() * 450, choice: tr.ink })); }
  function agentClash(P) { return clashResp(P, tr => ({ rt: 1900, choice: tr.ink })); }

  // ---------- targets (Fitts' law) ----------
  function targetsRun(P, opts) {
    const clicks = [], samples = [];
    let pos = { x: P.field.w / 2, y: P.field.h / 2 }, t = 0;
    P.targets.forEach((tg, i) => {
      const D = Math.hypot(tg.x - pos.x, tg.y - pos.y);
      const id = Math.log2(D / (2 * tg.r) + 1);
      const mt = Math.max(60, opts.mt(id, i));
      const click = opts.land(tg);
      if (opts.path) opts.path(pos, click, t, mt, samples);
      t += mt;
      clicks.push({ i, t: Math.round(t), x: +click.x.toFixed(1), y: +click.y.toFixed(1) });
      pos = click;
    });
    return { clicks, samples, pointerType: opts.pointerType || 'mouse' };
  }
  function humanTargets(P, seed = 51) {
    const rng = mulberry(seed);
    return targetsRun(P, {
      mt: id => 180 + 145 * id + gauss(rng) * 200,
      land: tg => { const a = rng() * Math.PI * 2, k = Math.min(0.95, Math.abs(gauss(rng)) * 1.6 + 0.05); return { x: tg.x + Math.cos(a) * tg.r * k, y: tg.y + Math.sin(a) * tg.r * k }; },
      path: (from, to, t0, mt, out) => {
        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len, curve = (rng() - 0.5) * 0.18 * len;
        for (let s = 16; s < mt; s += 15 + rng() * 4) {
          const u = s / mt, mj = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5, bow = Math.sin(Math.PI * u) * curve;
          out.push({ t: Math.round(t0 + s), x: +(from.x + dx * mj + nx * bow + gauss(rng) * 1.2).toFixed(1), y: +(from.y + dy * mj + ny * bow + gauss(rng) * 1.2).toFixed(1) });
        }
      },
    });
  }
  function scriptTargets(P) { return targetsRun(P, { mt: () => 300, land: tg => ({ x: tg.x, y: tg.y }) }); }
  function agentTargets(P, seed = 52) { const rng = mulberry(seed); return targetsRun(P, { mt: () => 2600 + rng() * 400, land: tg => ({ x: tg.x + tg.r * 0.06, y: tg.y }) }); }
  function adaptiveTargets(P, seed = 53) {
    const rng = mulberry(seed);
    return targetsRun(P, {
      mt: () => 250 + rng() * 300,
      land: tg => { const a = rng() * Math.PI * 2, k = 0.15 + rng() * 0.5; return { x: tg.x + Math.cos(a) * tg.r * k, y: tg.y + Math.sin(a) * tg.r * k }; },
      path: (from, to, t0, mt, out) => {
        for (let s = 16; s < mt; s += 16) { const u = s / mt; out.push({ t: Math.round(t0 + s), x: +(from.x + (to.x - from.x) * u + gauss(rng) * 0.6).toFixed(1), y: +(from.y + (to.y - from.y) * u + gauss(rng) * 0.6).toFixed(1) }); }
      },
    });
  }

  return {
    gauss, mulberry, targetAt,
    humanRing, scriptRing, agentRing, adaptiveRing,
    humanBeat, scriptBeat,
    humanVoice, botVoice, ttsJitterVoice,
    humanReflex, scriptReflex, agentReflex, adaptiveReflex,
    humanPulse, agentPulse, playbackPulse,
    humanClash, scriptClash, readerClash, adaptiveClash, agentClash,
    humanTargets, scriptTargets, agentTargets, adaptiveTargets,
  };
});
