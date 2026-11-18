'use strict';
// Data-quality audit for a dataset of labelled records. A number computed on dirty data is worse than no
// number, so every experiment runs this first and prints what it found. Nothing is silently dropped:
// records that fail a check are counted, reported by reason, and excluded from the metrics only if the check says so.
const crypto = require('crypto');

const digest = x => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');

// records: [{ id, label, source, group?, content }]   content is whatever identifies the record's data
// checks:  [{ name, drop: bool, test(record) -> reason string | null }]
function audit(name, records, checks = []) {
  const seen = new Map(), dupes = [];
  const problems = {}, drop = new Set();
  const bySource = {}, byLabel = {};
  for (const r of records) {
    bySource[r.source] = (bySource[r.source] || 0) + 1;
    byLabel[r.label] = (byLabel[r.label] || 0) + 1;
    const h = digest(r.content);
    if (seen.has(h)) { dupes.push([r.id, seen.get(h)]); (problems['exact duplicate of another record'] ||= []).push(r.id); drop.add(r.id); }
    else seen.set(h, r.id);
    for (const c of checks) {
      const why = c.test(r);
      if (why) { (problems[c.name + ': ' + why] ||= []).push(r.id); if (c.drop) drop.add(r.id); }
    }
  }
  const labelsHashed = new Map();
  // cross-label leakage: identical content labelled both ways is a labelling error, not noise
  for (const r of records) { const h = digest(r.content); const l = labelsHashed.get(h); if (l !== undefined && l !== r.label) (problems['same content with two different labels'] ||= []).push(r.id); labelsHashed.set(h, r.label); }
  const kept = records.filter(r => !drop.has(r.id));
  const minority = Math.min(...Object.values(byLabel)) / records.length;
  return {
    name, total: records.length, kept: kept.length, dropped: records.length - kept.length,
    byLabel, bySource, duplicateRate: dupes.length / (records.length || 1),
    minorityShare: records.length ? minority : NaN,
    problems: Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, { count: v.length, examples: v.slice(0, 3) }])),
    clean: kept,
    verdict: records.length === 0 ? 'EMPTY' : (records.length - kept.length) / records.length > 0.05 ? 'DIRTY (>5% dropped)' : dupes.length ? 'OK after dedupe' : 'OK',
  };
}

const report = a => {
  const lines = [`  quality[${a.name}]: ${a.total} records, ${a.kept} kept, ${a.dropped} dropped, duplicates ${(a.duplicateRate * 100).toFixed(2)}%, verdict ${a.verdict}`];
  lines.push('    labels: ' + JSON.stringify(a.byLabel) + '   sources: ' + JSON.stringify(a.bySource));
  for (const [k, v] of Object.entries(a.problems)) lines.push(`    - ${k} (${v.count}), e.g. ${v.examples.join(', ')}`);
  return lines.join('\n');
};

module.exports = { audit, report, digest };
