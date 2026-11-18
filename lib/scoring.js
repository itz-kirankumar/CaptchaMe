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


// ---------- Clash check (colour-word interference) ----------
// A colour word ("RED") is shown in an ink ("BLUE"); the visitor picks the
// INK. People read automatically, so mismatched words slow them down a little
// and sometimes trip them up (the Stroop effect). Scripts that read the
// schedule answer at a fixed delay; agents that read the page text pick the
// WORD; look-think-act agents miss the 1.3 s window. Every result carries
// `hard` flags: machine signatures that fail the check outright.
function scoreClash(params, responses) {
  const flags = [], hard = [];
  const trials = (params && params.trials) || [];
  const win = (params && params.windowMs) || 1300;
  const resp = Array.isArray(responses) ? responses.slice(0, 60) : [];
  const rows = trials.map((tr, i) => {
    const r = resp.find(x => x && x.i === i && Number.isFinite(x.t));
    const cong = tr.word === tr.ink;
    if (!r) return { i, miss: true, cong };
    const rt = r.t - tr.at;
    return { i, rt, cong, late: rt > win, correct: r.choice === tr.ink, choseWord: !cong && r.choice === tr.word };
  });
  const early = rows.filter(r => !r.miss && r.rt < 0).length;
  const missed = rows.filter(r => r.miss || r.late).length;
  const hits = rows.filter(r => !r.miss && !r.late && r.rt >= 0);
  const rts = hits.map(r => r.rt);
  const detail = { trials: trials.length, answered: hits.length, missed, reactionsMs: rows.map(r => (r.miss ? null : Math.round(r.rt))) };

  if (early) hard.push('answered before the word appeared: it knew the schedule');
  if (missed >= 3) {
    hard.push('missed ' + missed + ' of ' + trials.length + ' words (each shows for ' + (win / 1000).toFixed(1) + ' s): a look-think-act loop');
    return { score: Math.max(0, hits.length * 6), flags: [...hard], hard, detail };
  }
  const m = mean(rts), s = std(rts);
  const correct = hits.filter(r => r.correct).length;
  const accuracy = hits.length ? correct / hits.length : 0;
  const inc = hits.filter(r => !r.cong), con = hits.filter(r => r.cong);
  const wordPicks = inc.filter(r => r.choseWord).length;
  const conAcc = con.length ? con.filter(r => r.correct).length / con.length : 0;
  const incOk = inc.filter(r => r.correct).map(r => r.rt), conOk = con.filter(r => r.correct).map(r => r.rt);
  const interference = incOk.length >= 2 && conOk.length >= 2 ? mean(incOk) - mean(conOk) : null;
  Object.assign(detail, { meanRtMs: Math.round(m), sdRtMs: +s.toFixed(1), accuracy: +accuracy.toFixed(2), interferenceMs: interference === null ? null : Math.round(interference) });

  if (rts.length >= 5 && rts.every(x => x < 180)) hard.push('answered every word in under 180 ms: faster than anyone can read');
  if (rts.length >= 5 && s < 20) hard.push('identical answer time on every word (sd ' + s.toFixed(1) + ' ms): a timer, not a reader');
  if (inc.length >= 3 && wordPicks / inc.length >= 0.75 && conAcc >= 0.75) {
    hard.push('picked the WORD, not the ink, on ' + wordPicks + ' of ' + inc.length + ' mismatched words: it read the page text instead of seeing the colour');
  }

  let score = 100;
  if (accuracy < 0.7) { score -= 35; flags.push('only ' + Math.round(accuracy * 100) + '% of answers matched the ink'); }
  if (rts.length >= 5 && cv(rts) < 0.08 && s >= 20) { score -= 30; flags.push('very uniform answer times (CV ' + cv(rts).toFixed(3) + ')'); }
  if (m > 1000) score -= 15;
  if (interference !== null && interference < 0 && accuracy === 1) score -= 10; // people usually slow down on mismatches
  if (hard.length) score = Math.min(score, 15);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags: [...hard, ...flags], hard, detail };
}

// ---------- Targets check (Fitts' law + path shape) ----------
// Targets of different sizes appear one at a time; click each. For a hand,
// movement time grows with log2(distance / width + 1) (Fitts' law), clicks
// scatter around the centre, and the pointer speeds up then brakes on the way.
// Scripts click dead-centre at a fixed delay and teleport; agents take seconds.
function scoreTargets(params, clicks, samples, pointerType) {
  const flags = [], hard = [];
  const T = (params && params.targets) || [];
  const cl = (Array.isArray(clicks) ? clicks : []).filter(c => c && [c.t, c.x, c.y].every(Number.isFinite)).slice(0, 80).sort((a, b) => a.t - b.t);
  const sm = (Array.isArray(samples) ? samples : []).filter(p => p && [p.t, p.x, p.y].every(Number.isFinite)).slice(0, 4000).sort((a, b) => a.t - b.t);
  const touch = pointerType === 'touch';
  const hitAt = new Array(T.length).fill(null);
  let misses = 0;
  for (const c of cl) {
    const tg = T[c.i];
    if (!tg) { misses++; continue; }
    const d = Math.hypot(c.x - tg.x, c.y - tg.y);
    if (d <= tg.r * 1.15 && !hitAt[c.i]) hitAt[c.i] = { t: c.t, x: c.x, y: c.y, off: d / tg.r };
    else misses++;
  }
  const hitCount = hitAt.filter(Boolean).length;
  const detail = { targets: T.length, hits: hitCount, misses };
  if (hitCount < T.length - 1) {
    flags.push('reached only ' + hitCount + ' of ' + T.length + ' targets');
    return { score: hitCount * 5, flags, hard, detail };
  }

  const rows = [];
  for (let i = 1; i < T.length; i++) {
    const a = hitAt[i - 1], b = hitAt[i];
    if (!a || !b) continue;
    const D = Math.hypot(T[i].x - a.x, T[i].y - a.y);
    rows.push({ i, mt: b.t - a.t, id: Math.log2(D / (2 * T[i].r) + 1), from: a.t, to: b.t });
  }
  const mts = rows.map(r => r.mt), ids = rows.map(r => r.id);
  const mx = mean(ids), my = mean(mts);
  let sxx = 0, sxy = 0, syy = 0;
  rows.forEach(r => { sxx += (r.id - mx) ** 2; sxy += (r.id - mx) * (r.mt - my); syy += (r.mt - my) ** 2; });
  const slope = sxx ? sxy / sxx : 0;
  const corr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  const offs = hitAt.filter(Boolean).map(h => h.off);
  const meanOff = mean(offs);
  Object.assign(detail, { meanMoveMs: Math.round(my), fittsSlopeMsPerBit: Math.round(slope), fittsCorr: +corr.toFixed(2), meanCentreOffset: +meanOff.toFixed(3), pointerType: pointerType || 'unknown' });

  // path shape between targets (mouse and pen only: touch has no hover path)
  if (!touch) {
    let teleports = 0, judged = 0;
    const ratios = [];
    for (const r of rows) {
      const seg = sm.filter(p => p.t > r.from && p.t < r.to);
      judged++;
      if (seg.length < 2) { teleports++; continue; }
      if (seg.length < 5) continue;
      const v = [];
      for (let k = 1; k < seg.length; k++) { const dt = seg[k].t - seg[k - 1].t; if (dt > 0) v.push(Math.hypot(seg[k].x - seg[k - 1].x, seg[k].y - seg[k - 1].y) / dt); }
      if (v.length >= 4 && mean(v) > 0) ratios.push(Math.max(...v) / mean(v));
    }
    detail.pathSegmentsWithoutTravel = teleports;
    if (judged && teleports / judged >= 0.6) hard.push('the cursor jumped onto ' + teleports + ' of ' + judged + ' targets without travelling: synthetic clicks');
    if (ratios.length >= 4) {
      const med = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
      detail.peakToMeanSpeed = +med.toFixed(2);
      if (med < 1.2) hard.push('the cursor moved at a perfectly constant speed between targets (peak/mean ' + med.toFixed(2) + '); a hand accelerates, then brakes');
      else if (med < 1.3) flags.push('the cursor moved at near-constant speed (peak/mean ' + med.toFixed(2) + '); hands accelerate, then brake');
    }
  }

  if (offs.length >= 6 && meanOff < 0.05) hard.push('clicked the exact centre of every target (mean offset ' + (meanOff * 100).toFixed(1) + '% of the radius): coordinates, not a hand');
  if (my < 150) hard.push('moved between targets in ' + Math.round(my) + ' ms on average: faster than a hand can travel');
  if (slope < 25 && mts.length >= 5 && cv(mts) < 0.1) hard.push('the same movement time for near and far, big and small targets: a fixed delay, not Fitts\' law');
  if (my > 2500) hard.push('took ' + Math.round(my) + ' ms per target: a look-think-act loop, not a hand');

  let score = 100;
  if (slope < 25) { score -= 30; flags.push('movement time barely depends on difficulty (slope ' + Math.round(slope) + ' ms/bit; people show roughly 80-250)'); }
  if (corr < 0.3) score -= 10;
  if (flags.some(f => /constant speed/.test(f))) score -= 25;
  if (misses > 3) score -= 15;
  if (hard.length) score = Math.min(score, 15);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags: [...hard, ...flags.filter(f => !hard.includes(f))], hard, detail };
}

module.exports.scoreClash = scoreClash;
module.exports.scoreTargets = scoreTargets;
