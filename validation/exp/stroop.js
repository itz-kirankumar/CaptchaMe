'use strict';
// Experiment C: the colour-clash check (scoreClash) on real Stroop trials.
//   Humans: erfanjaripour/stroop-interference processed data of an open OSF Stroop study: 81 participants,
//           ~48,500 trials with reaction time, condition and correctness.
// Real trials are regrouped into 8-trial sessions with the product's mix (4 congruent, 4 incongruent), laid out on the
// product's schedule (first word at 1300 ms, one every ~1600 ms, 1300 ms answer window), and judged by the real
// lib/scoring.js with the real server pass rule. The question this answers: does the check fit people, i.e. is the
// 1.3 s window and the uniformity/speed rules calibrated to how real humans actually respond?
// It cannot say anything about bots (this dataset has none); the bot side is covered by test/e2e.js and the adversary
// generators in the experiments that have data for them.
const fs = require('fs');
const path = require('path');
const scoring = require('../../lib/scoring');
const S = require('../lib/stats');
const Q = require('../lib/quality');

// The server's rule for "this flag is a machine signature". Read from server.js so this test cannot drift from it.
const serverSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const HARD_FLAG = (() => { const m = /result\.flags\.some\(f => (\/[^\n]+?\/)\.test\(f\)\)/.exec(serverSrc); return m ? eval(m[1]) : /$^/; })(); // eslint-disable-line no-eval
const passes = r => r.score >= 60 && !(r.hard && r.hard.length) && !r.flags.some(f => HARD_FLAG.test(f));

const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const shuffle = (xs, r) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function load(file) {
  const [head, ...rows] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const c = head.split(',');
  const ix = n => c.indexOf(n);
  return rows.map((line, n) => {
    const v = line.split(',');
    return { id: 'trial#' + n, subj: v[ix('subj')], cond: v[ix('condition')], correct: v[ix('correct')] === 'correct', rt: Number(v[ix('RT')]) * 1000, label: 'human', source: v[ix('subj')], content: [v[ix('subj')], v[ix('trial')], v[ix('time')], v[ix('RT')]] };
  });
}

function run({ dataDir }) {
  const file = path.join(dataDir, 'stroop-interference', 'data', 'processed', 'stroop-cleaned.csv');
  if (!fs.existsSync(file)) return { skipped: 'Stroop data not found at ' + file + ' (run validation/fetch.sh)' };
  const all = load(file);
  const quality = Q.audit('stroop-trials', all, [
    { name: 'unusable reaction time', drop: true, test: r => (!Number.isFinite(r.rt) || r.rt <= 0 ? 'RT not positive' : null) },
    { name: 'anticipation (<150 ms)', drop: false, test: r => (r.rt < 150 ? 'RT < 150 ms' : null) },
    { name: 'very slow (>4 s)', drop: false, test: r => (r.rt > 4000 ? 'RT > 4 s' : null) },
    { name: 'neutral trial (not used by the product)', drop: false, test: r => (r.cond !== 'congruent' && r.cond !== 'incongruent' ? r.cond : null) },
  ]);
  const trials = quality.clean.filter(r => r.cond === 'congruent' || r.cond === 'incongruent');
  const out = { quality: { ...quality, clean: undefined }, trialLevel: {}, sessions: {}, notes: [] };

  // ---- trial level: the number the 1.3 s window depends on ----
  const rts = trials.map(t => t.rt), ok = trials.filter(t => t.correct);
  out.trialLevel = {
    n: trials.length, participants: new Set(trials.map(t => t.subj)).size,
    rtMs: { p05: Math.round(S.quantile(rts, 0.05)), median: Math.round(S.quantile(rts, 0.5)), p95: Math.round(S.quantile(rts, 0.95)), p99: Math.round(S.quantile(rts, 0.99)) },
    slowerThanWindow: S.wilson(rts.filter(x => x > 1300).length, rts.length),
    fasterThan180: S.wilson(rts.filter(x => x < 180).length, rts.length),
    accuracy: S.wilson(trials.filter(t => t.correct).length, trials.length),
    interferenceMs: Math.round(S.mean(ok.filter(t => t.cond === 'incongruent').map(t => t.rt)) - S.mean(ok.filter(t => t.cond === 'congruent').map(t => t.rt))),
  };

  // ---- session level: real trials through the real scorer ----
  const r = rng(5), bySubj = new Map();
  for (const t of trials) (bySubj.get(t.subj) || bySubj.set(t.subj, []).get(t.subj)).push(t);
  const sessions = [];
  for (const [subj, ts] of bySubj) {
    const con = ts.filter(t => t.cond === 'congruent'), inc = ts.filter(t => t.cond === 'incongruent');
    if (con.length < 40 || inc.length < 40) continue;
    for (let k = 0; k < 30; k++) sessions.push({ subj, trials: shuffle([...shuffle(con, r).slice(0, 4), ...shuffle(inc, r).slice(0, 4)], r) });
  }
  const judgeAll = (win) => sessions.map(s => {
    let t = 1300;
    const prm = { colors: ['RED', 'BLUE'], windowMs: win, trials: s.trials.map(x => { const tr = { at: Math.round(t), word: x.cond === 'congruent' ? 'RED' : 'BLUE', ink: 'RED' }; t += 1450 + r() * 400; return tr; }) };
    // a wrong answer on a mismatched word is recorded as picking the word (the 2-colour reading of an error)
    const resp = s.trials.map((x, i) => ({ i, t: prm.trials[i].at + x.rt, choice: x.correct ? 'RED' : 'BLUE' }));
    return { s, res: scoring.scoreClash(prm, resp) };
  });
  const verdicts = judgeAll(1300);
  out.windowSweep = [1000, 1300, 1500, 1800, 2000, 2500].map(w => { const v = judgeAll(w); return { windowMs: w, humanPass: S.wilson(v.filter(x => passes(x.res)).length, v.length), missed3OrMore: S.wilson(v.filter(x => (x.res.detail.missed || 0) >= 3).length, v.length) }; });
  out.sessions = {
    n: verdicts.length, participants: new Set(verdicts.map(v => v.s.subj)).size,
    humanPass: S.wilson(verdicts.filter(v => passes(v.res)).length, verdicts.length),
    humanFailByPerson: S.clusterCI(verdicts, v => v.s.subj, v => !passes(v.res)),
    failReasons: {},
    worstParticipants: S.byGroup(verdicts, v => v.s.subj, v => !passes(v.res)).slice(0, 5).map(g => ({ subject: g.group, failRate: +g.p.toFixed(3), n: g.n })),
    medianScore: S.quantile(verdicts.map(v => v.res.score), 0.5),
  };
  for (const v of verdicts) if (!passes(v.res)) for (const f of v.res.flags.slice(0, 2)) { const k = f.replace(/[\d.]+/g, '#'); out.sessions.failReasons[k] = (out.sessions.failReasons[k] || 0) + 1; }
  // how many real people would miss 3+ words to the window: the "look-think-act" rule
  out.sessions.missed3OrMore = S.wilson(verdicts.filter(v => (v.res.detail.missed || 0) >= 3).length, verdicts.length);
  out.notes.push(
    'Reaction times here come from a keyboard task; the product asks for a click or tap, which adds pointing time. Treat the window result as a LOWER bound on human lateness.',
    'The Stroop task in this dataset has more than two colours; an error is mapped to "chose the word" for the two-colour product, which can only make humans look worse, never better.',
  );
  return out;
}

module.exports = { run, passes };
