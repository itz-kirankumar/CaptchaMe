'use strict';
// One command: audit every dataset, run every experiment, write validation/results.json and print a report.
//   node validation/run.js            (data from validation/data, or DATA_DIR=...)
// Experiments whose data is missing are skipped and say so; nothing is faked.
const fs = require('fs');
const path = require('path');
const S = require('./lib/stats');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const EXPS = [
  ['typing (invisible pass)', './exp/keystrokes'],
  ['pointer (human vs bot movement)', './exp/mouse'],
  ['client identity (agents, crawlers, humans)', './exp/agents'],
  ['colour clash (human calibration)', './exp/stroop'],
];
const out = { generatedAt: new Date().toISOString(), dataDir: path.basename(dataDir), experiments: {} };
const L = [];
const say = s => { L.push(s); console.log(s); };

for (const [title, mod] of EXPS) {
  say(`\n=== ${title} ===`);
  let r;
  try { r = require(mod).run({ dataDir }); } catch (e) { r = { skipped: 'crashed: ' + e.message }; }
  out.experiments[mod.replace('./exp/', '')] = r;
  if (r.skipped) { say('  SKIPPED: ' + r.skipped); continue; }
  const q = r.quality; say(`  data quality: ${q.total} records, ${q.dropped} dropped, duplicates ${(q.duplicateRate * 100).toFixed(2)}%, verdict ${q.verdict}`);
  for (const [k, v] of Object.entries(q.problems)) say(`    - ${k} (${v.count})`);
}

// ---- the report: only numbers that were measured, each with its interval ----
const k = out.experiments.keystrokes, m = out.experiments.mouse, a = out.experiments.agents, c = out.experiments.stroop;
say('\n================ RESULTS ================');
if (k && !k.skipped) {
  say('\nTyping, real humans (CMU, ' + k.humans.n + ' samples):');
  say('  invisible pass       ' + S.ci(k.humans.pass));
  say('  sent to full check   ' + S.ci(k.humans.challenge) + '   <- false alarms, all "every key held the same time"');
  say('     person-level CI   ' + S.ciCluster(k.humans.challengeByPerson) + '   (the honest one: 51 typists, not 20,400 independent trials)');
  say('  worst typists        ' + k.humans.worstSubjects.slice(0, 3).map(x => `${x.subject} ${S.pct(x.notPassed, 0)}`).join(', '));
  say('Typing, synthetic adversaries (denied the invisible pass):');
  for (const [n, v] of Object.entries(k.adversaries)) say('  ' + n.padEnd(44) + S.ci(v.deniedInvisiblePass));
}
if (m && !m.skipped) {
  say('\nPointer, real humans: invisible pass ' + S.ci(m.passive.humans.invisiblePass));
  for (const g of m.passive.humansBySource) say('  ' + g.source.padEnd(14) + 'not-invisible-pass ' + S.pct(g.notInvisiblePass).padStart(6) + '  n=' + g.n);
  say('Pointer, bot generators that got the invisible pass:');
  for (const [s, b] of Object.entries(m.passive.botsBySource)) say('  ' + s.padEnd(24) + S.ci(b.slippedThroughAsInvisiblePass));
  say('Feature separation (AUC; 0.5 = no signal), by generator:');
  for (const [f, o] of Object.entries(m.features)) say('  ' + f.padEnd(52) + Object.entries(o).map(([s, v]) => `${s.replace('bot_', '')}:${v.auc !== undefined ? v.auc : 'n/a'}`).join('  '));
}
if (a && !a.skipped) {
  say('\nClient identity (flagged as automated by shield or audit):');
  for (const [cat, v] of Object.entries(a.byCategory)) say('  ' + cat.padEnd(12) + 'n=' + String(v.n).padEnd(5) + S.ci(v.eitherFlags) + '   shield alone ' + S.pct(v.shieldSlowsOrBlocks.p));
}
if (c && !c.skipped) {
  say('\nColour clash on ' + c.trialLevel.n + ' real Stroop trials (' + c.trialLevel.participants + ' people):');
  say('  reaction time ms  ' + JSON.stringify(c.trialLevel.rtMs) + '   answer window 1300 ms');
  say('  trials past the window ' + S.ci(c.trialLevel.slowerThanWindow));
  say('  human sessions passing ' + S.ci(c.sessions.humanPass));
  say('     person-level fail rate ' + S.ciCluster(c.sessions.humanFailByPerson));
}

out.report = L.join('\n');
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, (key, v) => (key === 'clean' ? undefined : v), 2));
console.log('\nWrote validation/results.json');
