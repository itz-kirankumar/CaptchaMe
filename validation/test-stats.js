'use strict';
// Known-answer checks for the metrics library. If these are wrong, every reported number is wrong.
const assert = require('assert');
const S = require('./lib/stats');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  PASS', name); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m || ''} got ${a}, want ${b} +/- ${tol}`);

ok('AUC of perfectly separated scores is 1', () => assert.strictEqual(S.auc([5, 6, 7], [1, 2, 3]), 1));
ok('AUC of identical scores is 0.5', () => assert.strictEqual(S.auc([1, 1, 1], [1, 1, 1]), 0.5));
ok('AUC of reversed scores is 0', () => assert.strictEqual(S.auc([1, 2, 3], [5, 6, 7]), 0));
ok('AUC handles ties (half credit)', () => near(S.auc([1, 2], [1, 2]), 0.5, 1e-9));
ok('AUC matches the textbook example (0.6875)', () => near(S.auc([0.9, 0.8, 0.4, 0.3], [0.7, 0.5, 0.35, 0.2]), 0.6875, 1e-9)); // 11 of 16 bot/human pairs ranked correctly
ok('Wilson interval for 0/300 has upper bound near 1.3% (rule of three ~1%)', () => { const w = S.wilson(0, 300); near(w.hi, 0.0126, 0.0005); assert.strictEqual(w.lo, 0); });
ok('Wilson interval for 50/100 is symmetric around 0.5', () => { const w = S.wilson(50, 100); near((w.lo + w.hi) / 2, 0.5, 0.001); near(w.lo, 0.404, 0.002); });
ok('Wilson for n=0 is NaN, not a number', () => assert(Number.isNaN(S.wilson(0, 0).p)));
ok('samplesToClaim(1%) = 300 and (0.1%) = 3000', () => { assert.strictEqual(S.samplesToClaim(0.01), 300); assert.strictEqual(S.samplesToClaim(0.001), 3000); });
ok('claimable: 0/300 does not claim <=1% (needs the Wilson bound), 0/1000 does', () => { assert.strictEqual(S.claimable(0, 300, 0.01), false); assert.strictEqual(S.claimable(0, 1000, 0.01), true); });
ok('ROC: perfect separation gives AUC 1 and TPR@0%FPR 1', () => { const r = S.roc([5, 6, 7], [1, 2, 3]); assert.strictEqual(r.auc, 1); assert.strictEqual(r.tprAtFpr0, 1); });
ok('quantile median of 1..5 is 3', () => assert.strictEqual(S.quantile([5, 1, 4, 2, 3], 0.5), 3));
ok('cluster CI is wider than the naive CI when one cluster carries all the errors', () => {
  // 50 people x 100 samples; 2 people fail 50% of the time, the rest never
  const items = []; for (let p = 0; p < 50; p++) for (let i = 0; i < 100; i++) items.push({ p, bad: p < 2 && i < 50 });
  const naive = S.wilson(items.filter(x => x.bad).length, items.length);
  const clu = S.clusterCI(items, x => x.p, x => x.bad);
  assert(clu.hi - clu.lo > (naive.hi - naive.lo) * 2, `cluster width ${clu.hi - clu.lo} vs naive ${naive.hi - naive.lo}`);
  near(clu.p, naive.p, 1e-9);
});
ok('ECE is 0 for perfectly calibrated and large for confidently wrong', () => { assert(S.ece([[0.5, 1], [0.5, 0]]) < 1e-9); assert(S.ece([[0.95, 0], [0.95, 0]]) > 0.9); });
console.log(`${n} passed`);
