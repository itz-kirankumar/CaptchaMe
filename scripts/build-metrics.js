#!/usr/bin/env node
'use strict';
// Reads validation/results.json (made by `node validation/run.js`) and validation/MANIFEST.json, and writes
// app/evidence/data.json: rates, intervals, n and notes only. No raw records, no file names, no paths.
// The Evidence page reads only that file, at build time. It never reads validation/data (git-ignored).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const res = JSON.parse(fs.readFileSync(path.join(root, 'validation', 'results.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(root, 'validation', 'MANIFEST.json'), 'utf8'));
const E = res.experiments;

// a rate with its interval: { p, lo, hi, n, k }
const rate = (r) => (r ? { p: r.p, lo: r.lo, hi: r.hi, n: r.n, k: r.k, people: r.people } : null);
const dataset = (id) => { const d = man.datasets.find((x) => x.id === id); return d ? { name: d.name, size: d.size, status: d.status } : null; };

const typing = E.keystrokes, mouse = E.mouse, clash = E.stroop, agents = E.agents;
const worst = (typing.humans.worstSubjects || []).slice(0, 2).map((w) => ({ notPassed: w.notPassed, n: w.n }));
const adv = {};
for (const [name, v] of Object.entries(typing.adversaries)) adv[name] = { n: v.n, denied: rate(v.deniedInvisiblePass) };
const bots = {};
for (const [name, v] of Object.entries(mouse.passive.botsBySource)) bots[name] = { n: v.n, gotThrough: rate(v.slippedThroughAsInvisiblePass) };
const phone = (mouse.passive.humansBySource || []).find((s) => s.source === 'human_tel');
const cats = {};
for (const k of ['agent', 'ai-crawler', 'crawler', 'bot', 'human']) {
  const c = agents.byCategory[k];
  if (c) cats[k] = { n: c.n, flagged: rate(c.eitherFlags), shieldAlone: rate(c.shieldSlowsOrBlocks) };
}

const out = {
  generatedAt: res.generatedAt,
  typing: {
    dataset: { ...dataset('cmu-keystroke'), used: typing.quality.kept },
    humansPass: rate(typing.humans.pass),
    falseAlarm: rate(typing.humans.challenge),
    falseAlarmByPerson: rate(typing.humans.challengeByPerson),
    worstTypists: worst,
    adversaries: adv,
    notes: ['The adversaries are synthetic. They bound the rules; they are not evidence about real attackers.', 'One practised password, typed 400 times by each of 51 people.'],
  },
  pointer: {
    dataset: { name: mouse.quality.name, used: mouse.quality.kept, humans: mouse.passive.humans.n },
    humansPass: rate(mouse.passive.humans.invisiblePass),
    phone: phone ? { notPassed: phone.notInvisiblePass, lo: phone.ci[0], hi: phone.ci[1], n: phone.n } : null,
    bots,
    notes: mouse.notes || [],
  },
  clash: {
    dataset: { ...dataset('stroop'), name: 'Stroop trial data', used: clash.trialLevel.n, people: clash.trialLevel.participants },
    humansPass: rate(clash.sessions.humanPass),
    failByPerson: rate(clash.sessions.humanFailByPerson),
    rtMs: clash.trialLevel.rtMs,
    pastWindow: rate(clash.trialLevel.slowerThanWindow),
    windowMs: 1300,
    // The saved results file has no answer-window sweep. We show it only if a later run writes one.
    windowSweep: Array.isArray(clash.windowSweep) ? clash.windowSweep.map((w) => ({ windowMs: w.windowMs, humanPass: rate(w.humanPass) })) : null,
    notes: clash.notes || [],
  },
  identity: {
    dataset: { name: agents.quality.name, kept: agents.quality.kept, total: agents.quality.total },
    categories: cats,
    notes: agents.notes || [],
  },
  limits: [],
  missing: man.datasets.filter((d) => d.status === 'blocked-here' || d.status === 'gated').map((d) => ({ name: d.name, status: d.status, uses: d.uses || '' })),
};

// Limits: copied word for word from section 6 of docs/VALIDATION-PLAN.md.
const plan = fs.readFileSync(path.join(root, 'docs', 'VALIDATION-PLAN.md'), 'utf8');
const s6 = plan.split(/^## 6\./m)[1] || '';
out.limits = s6.split(/^## /m)[0].split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).replace(/\*\*/g, '').trim());

fs.mkdirSync(path.join(root, 'app', 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'app', 'evidence', 'data.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote app/evidence/data.json (generatedAt ' + out.generatedAt + ', ' + out.limits.length + ' limits, ' + out.missing.length + ' missing datasets)');
