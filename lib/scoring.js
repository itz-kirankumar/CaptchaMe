'use strict';
// Server-side scoring for the live presence checks.
// Principle: judge the SHAPE of the response (lag distribution, corrections,
// jitter), never raw speed alone. Every check returns {score, flags, detail}.

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs) { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); }
function cv(xs) { const m = mean(xs); return m === 0 ? 0 : std(xs) / Math.abs(m); }

// ---------- Ring check ----------
// The target follows a Lissajous curve the server chose:
//   x(t) = 0.5 + ax*sin(2*pi*fx*t + px), y(t) = 0.5 + ay*sin(2*pi*fy*t + py)
// t in seconds, coordinates normalised 0..1 of the play field.
function ringTarget(params, tSec) {
  let px = params.px, py = params.py;
  const darts = params.darts || [];
  for (const d of darts) { if (tSec * 1000 >= d.at) { px = d.px; py = d.py; } }
  return {
    x: 0.5 + params.ax * Math.sin(2 * Math.PI * params.fx * tSec + px),
    y: 0.5 + params.ay * Math.sin(2 * Math.PI * params.fy * tSec + py),
  };
}

function scoreRing(params, samples) {
  const flags = [];
  if (!Array.isArray(samples) || samples.length < 40) {
    return { score: 0, flags: ['too few samples (a follower emits a steady stream)'], detail: {} };
  }
  if (samples.length > 2000) samples = samples.slice(0, 2000);

  // Best lag: shift samples by L and measure distance to the target curve.
  const lags = [];
  for (let L = 0; L <= 600; L += 10) lags.push(L);
  let best = { lag: 0, rmse: Infinity };
  const rmseByLag = [];
  for (const L of lags) {
    let sum = 0, n = 0;
    for (const s of samples) {
      const t = (s.t - L) / 1000;
      if (t < 0) continue;
      const tgt = ringTarget(params, t);
      sum += (s.x - tgt.x) ** 2 + (s.y - tgt.y) ** 2;
      n++;
    }
    const rmse = n ? Math.sqrt(sum / n) : Infinity;
    rmseByLag.push(rmse);
    if (rmse < best.rmse) best = { lag: L, rmse };
  }

  // Corrections: direction reversals of the tracking error over time.
  const errs = samples.map(s => {
    const t = (s.t - best.lag) / 1000;
    const tgt = ringTarget(params, Math.max(0, t));
    return { dx: s.x - tgt.x, dy: s.y - tgt.y };
  });
  let corrections = 0;
  for (let i = 2; i < errs.length; i++) {
    const v1x = errs[i - 1].dx - errs[i - 2].dx, v1y = errs[i - 1].dy - errs[i - 2].dy;
    const v2x = errs[i].dx - errs[i - 1].dx, v2y = errs[i].dy - errs[i - 1].dy;
    if (v1x * v2x + v1y * v2y < 0) corrections++;
  }

  // Sample interval regularity.
  const dts = []; for (let i = 1; i < samples.length; i++) dts.push(samples[i].t - samples[i - 1].t);
  const intervalCV = cv(dts);

  const normRmse = best.rmse; // in 0..1 field units
  const detail = { lagMs: best.lag, rmse: +normRmse.toFixed(4), corrections, intervalCV: +intervalCV.toFixed(3), samples: samples.length };

  // Hard flags (each is a machine signature, not a slowness penalty)
  if (best.lag <= 20 && normRmse < 0.01) flags.push('zero-lag perfect tracking: a script replaying the published path');
  if (normRmse < 0.004) flags.push('inhumanly perfect tracking (rmse ' + normRmse.toFixed(4) + ')');
  if (corrections === 0 && normRmse < 0.02) flags.push('no micro-corrections: humans continuously correct, agents glide');
  if (intervalCV < 0.02 && dts.length > 60) flags.push('synthetic sample clock (interval CV ' + intervalCV.toFixed(3) + ')');

  // Score
  let score = 100;
  // lag: humans sit roughly 80-350 ms behind a moving target
  if (best.lag < 40) score -= 55;
  else if (best.lag < 80) score -= 20;
  else if (best.lag > 500) score -= 25;
  // error magnitude: humans track loosely
  if (normRmse < 0.006) score -= 45;
  else if (normRmse > 0.25) score -= 40; // not really following
  // corrections: humans make small constant corrections
  const corrPerSec = corrections / ((samples[samples.length - 1].t - samples[0].t) / 1000 || 1);
  detail.correctionsPerSec = +corrPerSec.toFixed(2);
  if (corrPerSec < 0.3) score -= 30;
  // lag profile: a human's lag curve is smooth with one clear minimum;
  // reward a clear minimum.
  const sortedRmse = [...rmseByLag].sort((a, b) => a - b);
  if (sortedRmse[1] - sortedRmse[0] < 0.0005) { score -= 10; flags.push('flat lag profile (no natural reaction minimum)'); }

  // lag stability across the challenge: a person locks into a tracking
  // rhythm and holds it; a generator that random-walks its lag drifts.
  const third = Math.floor(samples.length / 3);
  const winLags = [];
  for (let w = 0; w < 3; w++) {
    const win = samples.slice(w * third, (w + 1) * third);
    let wb = { lag: 0, rmse: Infinity };
    for (let L = 0; L <= 600; L += 20) {
      let sum = 0, n = 0;
      for (const sm of win) {
        const t = (sm.t - L) / 1000;
        if (t < 0) continue;
        const tgt = ringTarget(params, t);
        sum += (sm.x - tgt.x) ** 2 + (sm.y - tgt.y) ** 2;
        n++;
      }
      const r = n ? Math.sqrt(sum / n) : Infinity;
      if (r < wb.rmse) wb = { lag: L, rmse: r };
    }
    winLags.push(wb.lag);
  }
  detail.windowLagsMs = winLags;
  detail.lagDriftMs = Math.round(Math.max(...winLags) - Math.min(...winLags));
  if (detail.lagDriftMs > 120) { score -= 35; flags.push('tracking rhythm drifts ' + detail.lagDriftMs + ' ms across the challenge: a random-walk lag, not a locked-in person'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags, detail };
}

// ---------- Beat check ----------
// Server chose beat onsets (ms). User taps along. Humans anticipate slightly
// (-30..-150 ms) with 25-90 ms spread. Scripts hit 0 ms with ~0 spread.
function scoreBeat(onsets, taps) {
  const flags = [];
  if (!Array.isArray(taps) || taps.length < Math.min(6, onsets.length - 2)) {
    return { score: 0, flags: ['too few taps'], detail: {} };
  }
  // Match each tap to nearest onset.
  const offsets = [];
  for (const tap of taps) {
    let bestD = Infinity;
    for (const o of onsets) { const d = tap - o; if (Math.abs(d) < Math.abs(bestD)) bestD = d; }
    if (Math.abs(bestD) < 400) offsets.push(bestD);
  }
  if (offsets.length < Math.min(5, onsets.length - 2)) {
    return { score: 10, flags: ['taps did not line up with the beat'], detail: { matched: offsets.length } };
  }
  const m = mean(offsets), s = std(offsets);
  const detail = { meanOffsetMs: +m.toFixed(1), stdMs: +s.toFixed(1), matched: offsets.length, beats: onsets.length };

  if (Math.abs(m) < 12 && s < 8) flags.push('machine-perfect timing (mean ' + m.toFixed(1) + ' ms, sd ' + s.toFixed(1) + ' ms)');
  if (s < 3) flags.push('near-zero timing spread: humans scatter by tens of ms');
  if (m > 300) flags.push('reacting long after each beat (scripted playback lag)');

  let score = 100;
  if (Math.abs(m) < 12 && s < 8) score -= 70;
  if (s < 10) score -= 40; else if (s > 140) score -= 35;
  if (m > 250) score -= 45; else if (m < -250) score -= 25;
  // humans anticipate: reward a small negative mean
  if (m <= 10 && m >= -180) score = Math.min(100, score + 5);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags, detail };
}

// ---------- Voice check ----------
// Server chose words and a cadence. Client reports, per word: promptStart (ms,
// client clock), speechOnset (ms), plus an ASR transcript of the whole run.
// Humans start repeating a word ~300-1500 ms after it begins, with natural
// spread. Playback scripts are uniform or impossibly fast.
function levRatio(a, b) {
  a = (a || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  b = (b || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

function scoreVoice(words, wordTimings, transcript) {
  const flags = [];
  const expected = words.join(' ');
  const hasTranscript = !!(transcript && transcript.trim());
  const sim = hasTranscript ? levRatio(expected, transcript) : null;
  const latencies = (wordTimings || []).map(w => w.onsetMs - w.promptStartMs).filter(x => Number.isFinite(x));
  const detail = { transcriptSimilarity: sim === null ? null : +sim.toFixed(2), latenciesMs: latencies.map(Math.round) };

  if (hasTranscript && sim < 0.55) flags.push('spoken words did not match the prompt (similarity ' + sim.toFixed(2) + ')');
  if (latencies.length < Math.min(3, words.length)) {
    return { score: (sim !== null && sim >= 0.8) ? 45 : 10, flags: flags.concat(['no usable voice timing captured']), detail };
  }
  const m = mean(latencies), s = std(latencies), c = cv(latencies);
  detail.meanLatencyMs = +m.toFixed(0); detail.latencyCV = +c.toFixed(3);

  if (m < 80) flags.push('speech started before a human could hear the word (' + m.toFixed(0) + ' ms)');
  if (c < 0.04 && latencies.length >= 3) flags.push('suspiciously uniform response latency (CV ' + c.toFixed(3) + '): playback, not a person');
  if (m > 4000) flags.push('responses far too slow for live presence');

  let score = 100;
  if (sim !== null && sim < 0.55) score -= 70; else if (sim !== null && sim < 0.75) score -= 25;
  if (m < 80) score -= 60;
  else if (m < 200) score -= 15;
  if (c < 0.04 && latencies.length >= 3) score -= 55;
  if (m > 4000) score -= 50;
  if (!hasTranscript) {
    // No speech recognition in this browser: timing alone can still pass,
    // but capped lower. The ledger bounds what a timing-only pass is worth.
    score = Math.min(score, 70);
    detail.note = 'no ASR transcript; scored on voice timing only';
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags, detail };
}

module.exports = { scoreRing, scoreBeat, scoreVoice, ringTarget };

// ---------- Reflex check ----------
// Five flashes at random gaps. Click within the window after each flash.
// A look-think-act agent's screenshot loop alone costs more than the window.
// A script that pre-computes clicks lands at 0 ms every round, which is the
// tell. Humans: 150-500 ms, scattered.
function scoreReflex(rounds, clicks) {
  // rounds: [{at, windowMs}] (ms, shared clock), clicks: [ms]
  const flags = [];
  const reactions = [];
  const used = new Set();
  for (const r of rounds) {
    let best = null, bi = -1;
    clicks.forEach((c, i) => {
      if (used.has(i)) return;
      const d = c - r.at;
      if (d >= -80 && d <= r.windowMs && (best === null || d < best)) { best = d; bi = i; }
    });
    if (bi >= 0) { used.add(bi); reactions.push(best); }
    else reactions.push(null);
  }
  const hits = reactions.filter(x => x !== null);
  const detail = { hits: hits.length, rounds: rounds.length, reactionsMs: reactions.map(x => x === null ? null : Math.round(x)) };
  if (hits.length < rounds.length - 1) {
    flags.push('missed ' + (rounds.length - hits.length) + ' of ' + rounds.length + ' flashes (the window is under a second)');
    return { score: Math.max(0, hits.length * 8), flags, detail };
  }
  const m = mean(hits), s = std(hits);
  detail.meanMs = +m.toFixed(0); detail.stdMs = +s.toFixed(1);

  if (hits.every(h => h < 80)) flags.push('clicked before a human could see every flash (all under 80 ms)');
  if (s < 6 && hits.length >= 4) flags.push('identical reaction time every round (sd ' + s.toFixed(1) + ' ms): a timer, not a person');
  if (m > 700) flags.push('reacted after ' + m.toFixed(0) + ' ms on average: a look-think-act loop, not a reflex');
  if (reactions.some(r => r !== null && r < 0)) flags.push('clicked before a flash appeared: knew the schedule');

  let score = 100;
  if (hits.every(h => h < 80)) score -= 75;
  if (s < 6 && hits.length >= 4) score -= 70;
  if (m > 700) score -= 60; else if (m > 500) score -= 25;
  if (reactions.some(r => r !== null && r < 0)) score -= 50;
  if (s > 200) score -= 15;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags, detail };
}

// ---------- Ring check with darts ----------
// Like scoreRing, but the target teleports at known times. A follower must
// re-acquire within reacquireMs of each dart. Humans recover in 200-600 ms
// with a visible swoop; scripts track the new phase instantly; step agents
// take seconds.
function scoreRingDarts(params, samples) {
  const base = scoreRing(params, samples);
  const darts = params.darts || [];
  if (!darts.length || !Array.isArray(samples) || !samples.length) return base;
  const flags = [...base.flags];
  const detail = { ...base.detail, dartRecoveryMs: [] };
  let penalty = 0;
  for (const d of darts) {
    // ignore darts too small to see: a "jump" under 0.12 field units can read
    // as instant recovery for a genuine human and as no jump at all
    const before = ringTarget({ ...params, darts: darts.filter(x => x.at < d.at) }, d.at / 1000 - 0.001);
    const after = ringTarget({ ...params, darts: [...darts.filter(x => x.at < d.at), d] }, d.at / 1000 + 0.001);
    const jump = Math.hypot(after.x - before.x, after.y - before.y);
    if (jump < 0.12) { detail.dartRecoveryMs.push('too small to judge'); continue; }
    // first sample after the dart that lands within 0.08 field units of target
    let recoveredAt = null;
    for (const s of samples) {
      if (s.t < d.at) continue;
      const tgt = ringTarget(params, s.t / 1000);
      const dist = Math.hypot(s.x - tgt.x, s.y - tgt.y);
      if (dist < 0.08) { recoveredAt = s.t; break; }
    }
    if (recoveredAt === null) {
      detail.dartRecoveryMs.push(null);
      penalty += 22;
      flags.push('never re-acquired the ring after it darted at ' + d.at + ' ms');
    } else {
      const rec = recoveredAt - d.at;
      detail.dartRecoveryMs.push(Math.round(rec));
      if (rec < 30) { penalty += 25; flags.push('tracked a teleporting target with zero reaction time (knew the darts)'); }
      else if (rec > (params.reacquireMs || 1200)) { penalty += 18; flags.push('took ' + Math.round(rec) + ' ms to re-acquire after a dart (agents re-aim in seconds)'); }
    }
  }
  const score = Math.max(0, base.score - penalty);
  return { score, flags, detail };
}

module.exports.scoreReflex = scoreReflex;
module.exports.scoreRingDarts = scoreRingDarts;


// ---------- Pulse check (dual-task, cross-signal consistency) ----------
// Follow the ring AND react to flashes on the SAME timeline. The hard part
// for an attacker is not either signal, it is the coupling: humans keep
// tracking through their reactions, scripts synthesize the two channels
// independently and break the correlation.
function scorePulse(params, samples, clicks) {
  const base = scoreRing(params, samples);
  const flags = [...base.flags];
  const detail = { ...base.detail };

  // reaction part: flashes are like reflex rounds
  const rounds = (params.flashes || []).map(at => ({ at, windowMs: params.flashWindowMs || 800 }));
  const re = scoreReflex(rounds, clicks || []);
  detail.reactionsMs = re.detail.reactionsMs;
  flags.push(...re.flags);

  // dual-task signature: tracking quality in the 600 ms after each flash
  detail.trackingThroughFlash = [];
  let collapseCount = 0;
  for (const at of params.flashes || []) {
    let sum = 0, n = 0;
    for (const sm of samples || []) {
      if (sm.t < at || sm.t > at + 600) continue;
      const tgt = ringTarget(params, (sm.t - (detail.lagMs || 0)) / 1000);
      sum += (sm.x - tgt.x) ** 2 + (sm.y - tgt.y) ** 2;
      n++;
    }
    if (n < 5) { detail.trackingThroughFlash.push(null); continue; }
    const rmse = Math.sqrt(sum / n);
    detail.trackingThroughFlash.push(+rmse.toFixed(3));
    const baseline = Math.max(0.05, (base.detail.rmse || 0.02) * 4);
    if (rmse > Math.max(0.14, baseline)) collapseCount++;
  }
  if (collapseCount > 0) flags.push('lost the target ' + collapseCount + 'x while reacting to a flash: one task at a time, like a step agent');

  let score = Math.round(0.4 * base.score + 0.6 * re.score);
  score -= collapseCount * 25;
  score = Math.max(0, Math.min(100, score));
  return { score, flags, detail };
}

module.exports.scorePulse = scorePulse;
