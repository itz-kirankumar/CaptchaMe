'use strict';
// Experiment A: who is this client? CaptchaMe's own client-identity rules on labelled real user agents.
//   Agents / AI crawlers / crawlers / bots : mintlify/agent-traffic (MIT): 98 curated entries, 135 real example
//                                            user agents, each labelled agent | ai-crawler | crawler | bot.
//   Crawlers (large)                       : monperrus/crawler-user-agents: ~2,100 real crawler user agents.
//   Humans (control)                       : microlinkhq/top-user-agents: current real browser user agents.
// Two detectors are scored, each as "did it call this client something other than a person?":
//   shield : lib/shield.networkRisk (score >= 30 = the shield slows it; >= 55 = treated as automated)
//   audit  : lib/audit.analyze (the zero-install bot-cost report's class for the client)
// Headers other than User-Agent are set to what a real browser sends, so this isolates the UA rule.
// What this validates: identity claims. What it cannot: bots that lie about who they are (see the honest-agent gap
// in docs/VALIDATION-PLAN.md) and agents that run inside a person's own browser, which are invisible at HTTP level.
const fs = require('fs');
const path = require('path');
const shield = require('../../lib/shield');
const audit = require('../../lib/audit');
const S = require('../lib/stats');
const Q = require('../lib/quality');

const json = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function load(dataDir) {
  const recs = []; let n = 0; // ids must be unique: a collision makes the quality audit drop innocent records
  const mint = json(path.join(dataDir, 'agent-traffic', 'data', 'agents.json')) || [];
  for (const e of mint) for (const ua of e.examples || []) recs.push({ id: 'mint#' + (n++), label: e.category, source: 'mintlify/' + e.kind, group: e.category, ua, operator: e.operator, content: ua });
  const crawl = json(path.join(dataDir, 'crawler-user-agents', 'crawler-user-agents.json')) || [];
  for (const e of crawl) for (const ua of e.instances || []) recs.push({ id: 'crawl#' + (n++), label: 'crawler', source: 'monperrus', group: 'crawler-large', ua, content: ua });
  const top = json(path.join(dataDir, 'top-user-agents', 'src', 'index.json')) || [];
  for (const ua of top) recs.push({ id: 'human#' + (n++), label: 'human', source: 'microlink', group: 'human', ua, content: ua });
  return recs;
}

const shieldScore = ua => shield.networkRisk({ ua, acceptLanguage: 'en-US,en;q=0.9', secFetch: true }).score;
function auditClass(ua) {
  const r = audit.analyze(JSON.stringify({ ip: '203.0.113.9', time: new Date().toISOString(), method: 'GET', path: '/docs/page', status: 200, bytes: 4000, ua }), {});
  const hit = (r.classes || []).find(c => c.requests > 0);
  return hit ? hit.key : 'unknown';
}

function run({ dataDir }) {
  const recs = load(dataDir);
  if (!recs.length) return { skipped: 'no user-agent data under ' + dataDir + ' (run validation/fetch.sh)' };
  const quality = Q.audit('user-agents', recs, [
    { name: 'empty user agent', drop: true, test: r => (!r.ua || !r.ua.trim() ? 'empty' : null) },
    { name: 'a crawler list entry that is a full browser string', drop: false, test: r => (r.label === 'crawler' && /^Mozilla\/5\.0 \(.*\) AppleWebKit.*Safari\/[\d.]+$/.test(r.ua) ? 'browser-shaped' : null) },
  ]);
  // The same string may appear in two sources with different labels; keep it only where a human list does not contain it.
  const humanSet = new Set(quality.clean.filter(r => r.label === 'human').map(r => r.ua));
  const clean = quality.clean.filter(r => r.label === 'human' || !humanSet.has(r.ua));
  const out = { quality: { ...quality, clean: undefined }, byCategory: {}, notes: [] };

  for (const r of clean) { r.shield = shieldScore(r.ua); r.audit = auditClass(r.ua); }
  const flagged = r => r.shield >= 30 || r.audit !== 'person';
  const cats = [...new Set(clean.map(r => r.label))];
  for (const c of cats) {
    const g = clean.filter(r => r.label === c);
    out.byCategory[c] = {
      n: g.length,
      shieldSlowsOrBlocks: S.wilson(g.filter(r => r.shield >= 30).length, g.length),
      auditCallsItAutomated: S.wilson(g.filter(r => r.audit !== 'person').length, g.length),
      eitherFlags: S.wilson(g.filter(flagged).length, g.length),
      calledAPerson: S.wilson(g.filter(r => !flagged(r)).length, g.length),
      missedExamples: g.filter(r => !flagged(r)).slice(0, 4).map(r => r.ua.slice(0, 70)),
    };
  }
  // the agent categories broken down by kind: the agent lane exists because these will not look like bots
  out.agentKinds = {};
  for (const r of clean.filter(x => x.label === 'agent')) { const k = r.source.split('/')[1]; const o = (out.agentKinds[k] ||= { n: 0, missed: 0 }); o.n++; if (!flagged(r)) o.missed++; }
  out.notes.push(
    'A UA string is a claim, not evidence. This measures only how well CaptchaMe recognises what a client SAYS it is. A bot that says "Chrome" is invisible here.',
    'Agents that run in a person\'s own Chrome (Atlas, Comet, Claude in Chrome) are indistinguishable from that person at the HTTP level (stated by mintlify/agent-traffic itself).',
  );
  return out;
}

module.exports = { run };
