'use strict';
// Metrics for judging a bot check. Convention everywhere: a HIGHER score means "more likely a bot".
// Every rate is reported with a confidence interval, and a rate measured on too few samples says so
// instead of printing a confident-looking number.

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const std = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

// Wilson score interval: honest at 0 and at n for small samples, where the textbook interval is not.
function wilson(k, n, z = 1.96) {
  if (!n) return { p: NaN, lo: NaN, hi: NaN, n: 0, k: 0 };
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n, k };
}

// Smallest n that can support "error rate <= target" at 95% confidence with zero observed errors
// (rule of three: upper bound ~ 3/n). Use it to decide whether a validation set is big enough to claim a number.
const samplesToClaim = target => Math.ceil(3 / target);
const claimable = (k, n, target) => wilson(k, n).hi <= target;

// AUC by the rank-sum (Mann-Whitney) identity: P(score(bot) > score(human)), ties count half.
function auc(botScores, humanScores) {
  const n1 = botScores.length, n0 = humanScores.length;
  if (!n1 || !n0) return NaN;
  const all = [...botScores.map(s => [s, 1]), ...humanScores.map(s => [s, 0])].sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j < all.length && all[j][0] === all[i][0]) j++;
    const r = (i + 1 + j) / 2; // average rank of the tie group
    for (let t = i; t < j; t++) if (all[t][1] === 1) rankSum += r;
    i = j;
  }
  return (rankSum - n1 * (n1 + 1) / 2) / (n1 * n0);
}

// Operating points: sweep thresholds, return TPR at fixed FPRs and the equal error rate.
function roc(botScores, humanScores) {
  const th = [...new Set([...botScores, ...humanScores])].sort((a, b) => b - a);
  const pts = [{ thr: Infinity, fpr: 0, tpr: 0 }];
  for (const t of th) {
    pts.push({ thr: t, tpr: botScores.filter(s => s >= t).length / botScores.length, fpr: humanScores.filter(s => s >= t).length / humanScores.length });
  }
  const tprAtFpr = f => Math.max(...pts.filter(p => p.fpr <= f).map(p => p.tpr));
  let eer = NaN, best = Infinity;
  for (const p of pts) { const d = Math.abs(p.fpr - (1 - p.tpr)); if (d < best) { best = d; eer = (p.fpr + (1 - p.tpr)) / 2; } }
  return { auc: auc(botScores, humanScores), eer, tprAtFpr1: tprAtFpr(0.01), tprAtFpr5: tprAtFpr(0.05), tprAtFpr0: tprAtFpr(0) };
}

// d-prime: separation of the two score distributions in standard deviations. >2 is a comfortable gap.
function dprime(botScores, humanScores) {
  const s = Math.sqrt((std(botScores) ** 2 + std(humanScores) ** 2) / 2);
  return s === 0 ? Infinity : (mean(botScores) - mean(humanScores)) / s;
}

// Bootstrap CI for any statistic of (bots, humans), resampling both groups. Deterministic (seeded).
function bootstrap(stat, bots, humans, B = 300, seed = 7) {
  let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const draw = xs => xs.map(() => xs[Math.floor(rnd() * xs.length)]);
  const v = []; for (let i = 0; i < B; i++) v.push(stat(draw(bots), draw(humans)));
  v.sort((a, b) => a - b);
  return { lo: v[Math.floor(B * 0.025)], hi: v[Math.floor(B * 0.975)] };
}

// Calibration: bin a "probability of bot" against what actually happened. ECE near 0 = honest scores.
function ece(pairs, bins = 10) {
  const b = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const [p, y] of pairs) { const i = Math.min(bins - 1, Math.floor(p * bins)); b[i].n++; b[i].p += p; b[i].y += y; }
  const N = pairs.length || 1;
  return b.reduce((e, x) => e + (x.n ? (x.n / N) * Math.abs(x.p / x.n - x.y / x.n) : 0), 0);
}

// Worst group: the same rate, split by a group label (device, user, source). The product is only as fair as its worst group.
function byGroup(items, groupOf, hit) {
  const g = new Map();
  for (const it of items) { const k = groupOf(it); const r = g.get(k) || { k: 0, n: 0 }; r.n++; if (hit(it)) r.k++; g.set(k, r); }
  return [...g.entries()].map(([group, r]) => ({ group, ...wilson(r.k, r.n) })).sort((a, b) => b.p - a.p);
}

// Repeated samples from the same person are not independent, so a rate over 20,000 samples from 51 people is
// really a rate over ~51 people. Resample PEOPLE (clusters), not samples. Use this wherever a person id exists.
function clusterCI(items, groupOf, hit, B = 1000, seed = 3) {
  const g = new Map();
  for (const it of items) { const k = groupOf(it); const r = g.get(k) || { k: 0, n: 0 }; r.n++; if (hit(it)) r.k++; g.set(k, r); }
  const cl = [...g.values()], K = cl.length;
  let st = seed; const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
  const est = []; for (let b = 0; b < B; b++) { let k = 0, n = 0; for (let i = 0; i < K; i++) { const c = cl[Math.floor(rnd() * K)]; k += c.k; n += c.n; } est.push(k / n); }
  est.sort((x, y) => x - y);
  const kk = cl.reduce((a, c) => a + c.k, 0), nn = cl.reduce((a, c) => a + c.n, 0);
  return { p: kk / nn, lo: est[Math.floor(B * 0.025)], hi: est[Math.floor(B * 0.975)], people: K, n: nn, k: kk };
}
const ciCluster = w => `${pct(w.p)} [${pct(w.lo)}, ${pct(w.hi)}] across ${w.people} people`;

const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : 'n/a');
const ci = w => `${pct(w.p)} [${pct(w.lo)}, ${pct(w.hi)}] (${w.k}/${w.n})`;

module.exports = { mean, std, quantile, wilson, clusterCI, ciCluster, samplesToClaim, claimable, auc, roc, dprime, bootstrap, ece, byGroup, pct, ci };
