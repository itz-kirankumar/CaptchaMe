'use strict';
// Experiment K: the invisible pass (lib/passive.js) on real typists.
//   Humans     : CMU Keystroke Dynamics Benchmark (Killourhy & Maxion 2009): 51 typists x 400 repetitions
//                of one password, hold time (H) and key-up -> key-down gap (UD) per key. Real people, real keyboards.
//   Adversaries: SYNTHETIC, generated here, ordered from naive to adaptive. They show where the rule stops
//                working; they are not evidence about real attackers.
// What this validates: the false-positive rate of the typing rules on real humans, and which typing
// attacks the rules do and do not stop. What it cannot validate: pointer, page-time and network rules, and
// form-length behaviour (the CMU sample is 11 keys; a real form gives the rules more to work with).
const fs = require('fs');
const path = require('path');
const passive = require('../../lib/passive');
const S = require('../lib/stats');
const Q = require('../lib/quality');

const PAGE_TIME_MS = 6000; // not in the dataset; any plausible fill time above the 1.2 s gate. Stated, not hidden.
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = r => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };

function load(file) {
  const [head, ...rows] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  const H = cols.map((c, i) => [c, i]).filter(([c]) => c.startsWith('H.')).map(([, i]) => i);
  const UD = cols.map((c, i) => [c, i]).filter(([c]) => c.startsWith('UD.')).map(([, i]) => i);
  return rows.map((line, n) => {
    const v = line.split(',');
    const hold = H.map(i => Number(v[i]) * 1000), gap = UD.map(i => Number(v[i]) * 1000);
    return { id: `${v[0]}:${v[1]}:${v[2]}`, subject: v[0], label: 'human', source: 'cmu', hold, gap, content: { s: v[0], hold, gap } };
  });
}

// What the widget would send for these timings (public/widget.js: f = keydown - previous keyup; first key has none).
const telemetry = (hold, gap, extra = {}) => ({
  fields: [{ keys: hold.map((d, i) => ({ d, f: i === 0 ? null : gap[i - 1] })), pasted: false, autofilled: false, chars: hold.length }],
  pointer: [], pointerType: 'mouse', timeOnPageMs: PAGE_TIME_MS, scrolls: 0, trustedSubmit: true, env: {}, ...extra,
});
const judge = tel => passive.scorePassive(tel, { score: 0, reasons: [] });

function run({ dataDir }) {
  const file = path.join(dataDir, 'cmu-mirror', 'keystroke.csv');
  if (!fs.existsSync(file)) return { skipped: 'CMU keystroke.csv not found at ' + file + ' (run validation/fetch.sh)' };
  const humans = load(file);

  const quality = Q.audit('cmu-keystroke', humans, [
    { name: 'wrong key count', drop: true, test: r => (r.hold.length !== 11 || r.gap.length !== 10 ? `hold ${r.hold.length} gap ${r.gap.length}` : null) },
    { name: 'non-finite timing', drop: true, test: r => ([...r.hold, ...r.gap].some(x => !Number.isFinite(x)) ? 'NaN/Infinity' : null) },
    { name: 'non-positive hold time', drop: true, test: r => (r.hold.some(x => x <= 0) ? 'hold <= 0' : null) },
    { name: 'implausible hold (>3 s)', drop: true, test: r => (r.hold.some(x => x >= 3000) ? 'hold >= 3000 ms' : null) },
  ]);
  const clean = quality.clean;
  const out = { quality: { ...quality, clean: undefined }, humans: {}, adversaries: {}, notes: [] };

  // ---- humans ----
  const verdicts = clean.map(r => ({ r, v: judge(telemetry(r.hold, r.gap)) }));
  const tier = t => verdicts.filter(x => x.v.tier === t).length;
  out.humans = {
    n: clean.length,
    pass: S.wilson(tier('pass'), clean.length),
    nudge: S.wilson(tier('nudge'), clean.length),
    challenge: S.wilson(tier('challenge'), clean.length),
    challengeByPerson: S.clusterCI(verdicts, x => x.r.subject, x => x.v.tier === 'challenge'), // honest interval: resamples the 51 people
    reasons: {},
    worstSubjects: S.byGroup(verdicts, x => x.r.subject, x => x.v.tier !== 'pass').slice(0, 5).map(g => ({ subject: g.group, notPassed: g.p, n: g.n })),
  };
  for (const x of verdicts) for (const why of x.v.reasons) { const k = why.replace(/[\d.]+/g, '#'); out.humans.reasons[k] = (out.humans.reasons[k] || 0) + 1; }
  // would a longer form change the answer? pool two repetitions as one 22-key form fill
  const r2 = rng(11); let pooled = 0, pooledN = 0;
  for (let i = 0; i < 2000; i++) {
    const a = clean[Math.floor(r2() * clean.length)], b = clean.filter(c => c.subject === a.subject)[Math.floor(r2() * 400)] || a;
    const hold = [...a.hold, ...b.hold], gap = [...a.gap, 800, ...b.gap];
    if (judge(telemetry(hold, gap)).tier === 'pass') pooled++; pooledN++;
  }
  out.humans.passWith22Keys = S.wilson(pooled, pooledN);

  // ---- adversaries (synthetic) ----
  const mu = i => S.mean(clean.map(r => r.hold[i])), sd = i => S.std(clean.map(r => r.hold[i]));
  const muG = i => S.mean(clean.map(r => r.gap[i])), sdG = i => S.std(clean.map(r => r.gap[i]));
  const r = rng(42), N = 2000;
  const gen = {
    'fixed timing (script)': () => telemetry(Array(11).fill(90), Array(10).fill(70)),
    'uniform random jitter': () => telemetry(Array.from({ length: 11 }, () => 60 + r() * 80), Array.from({ length: 10 }, () => 40 + r() * 210)),
    'instant fill, no keystrokes': () => ({ ...telemetry([], []), fields: [{ keys: [], pasted: false, autofilled: false, chars: 11 }] }),
    'form submitted by page script': () => telemetry(clean[0].hold, clean[0].gap, { trustedSubmit: false }),
    'headless browser (webdriver flag)': () => telemetry(clean[0].hold, clean[0].gap, { env: { webdriver: true } }),
    'fitted to human averages (adaptive)': () => telemetry(Array.from({ length: 11 }, (_, i) => Math.max(20, mu(i) + gauss(r) * sd(i))), Array.from({ length: 10 }, (_, i) => Math.max(5, muG(i) + gauss(r) * sdG(i)))),
    'replay of a real human sample (adaptive)': () => { const h = clean[Math.floor(r() * clean.length)]; return telemetry(h.hold, h.gap); },
  };
  for (const [name, make] of Object.entries(gen)) {
    const res = Array.from({ length: N }, () => judge(make()));
    const blocked = res.filter(x => x.tier !== 'pass').length, hard = res.filter(x => x.tier === 'challenge').length;
    out.adversaries[name] = { n: N, deniedInvisiblePass: S.wilson(blocked, N), sentToFullCheck: S.wilson(hard, N) };
  }
  out.notes.push(
    'Replay and "fitted to human averages" pass by design: a rule that reads timing shape cannot tell a copy of a human from a human. ' +
    'That is why the fair-share ledger exists, and why this layer must never be reported as stopping them.',
    `CMU is one 11-key password typed 400 times per person (practised, so unusually regular). Page time is assumed ${PAGE_TIME_MS} ms.`,
  );
  return out;
}

module.exports = { run };
