'use strict';
// Experiment M: pointer movement, human vs bot generators.
//   Humans : delbot-mouse human sessions (6 setups: 2 desktop PCs, trackpad, phone, VM, fast clicker)
//            + Balabit Mouse Dynamics Challenge (10 users, hours of real remote-desktop work, human only).
//   Bots   : delbot-mouse bot sessions: pynput (plain scripted), PyHuman, NaturalMouseMotion, and a trained GAN.
// Two things are measured:
//   1. what lib/passive.js (the invisible pass) does with a pointer-only session: invisible pass vs button check;
//   2. how well each candidate FEATURE separates bots from humans (AUC), including two we do not use today.
// Not measured: the live ring/pulse/targets tasks (no public data of people doing OUR tasks exists; see docs).
const fs = require('fs');
const path = require('path');
const passive = require('../../lib/passive');
const S = require('../lib/stats');
const Q = require('../lib/quality');

// ---- parsers ----
function parseDelbot(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const m = /^resolution:(\d+),(\d+)/.exec(lines[0] || '');
  const pts = [];
  for (const l of lines.slice(m ? 1 : 0)) {
    const [t, ev, x, y] = l.split(',');
    // Phone/touch sessions name events PressedTouch / MoveTouch / ReleasedTouch; release lines carry no position.
    const kind = /^Pressed/.test(ev) ? 'Pressed' : /^Move/.test(ev) ? 'Move' : null;
    if (!kind) continue;
    pts.push({ t: Number(t), ev: kind, x: Number(x), y: Number(y), touch: /Touch$/.test(ev) });
  }
  return { res: m ? [Number(m[1]), Number(m[2])] : null, pts };
}
function parseBalabit(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  const pts = lines.map(l => { const c = l.split(','); return { t: Number(c[1]) * 1000, ev: c[2] === 'NoButton' ? 'Move' : (c[3] === 'Pressed' ? 'Pressed' : 'Move'), x: Number(c[4]), y: Number(c[5]) }; });
  return { res: null, pts };
}

// ---- features, each = higher means "more bot-like" after the direction is chosen by the experiment ----
function speeds(pts) {
  const v = [];
  for (let i = 1; i < pts.length; i++) { const dt = pts[i].t - pts[i - 1].t; if (dt > 0 && dt < 200) v.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / dt); }
  return v;
}
const peakToMean = pts => { const v = speeds(pts); return v.length >= 6 && S.mean(v) > 0 ? Math.max(...v) / S.mean(v) : NaN; }; // the rule in lib/passive.js
const intervalCV = pts => { const d = []; for (let i = 1; i < pts.length; i++) d.push(pts[i].t - pts[i - 1].t); return d.length > 20 ? S.std(d) / S.mean(d) : NaN; }; // the rule in lib/scoring.js
const eventRate = pts => { const dur = (pts[pts.length - 1].t - pts[0].t) / 1000; return dur > 0.5 ? pts.length / dur : NaN; }; // the top feature in arXiv 2607.26935
function teleportClickRatio(all) { // clicks that arrive with no movement just before them
  let c = 0, tele = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i].ev !== 'Pressed') continue;
    c++;
    let moved = 0; for (let j = i - 1; j >= 0 && all[i].t - all[j].t < 120; j--) moved += Math.hypot(all[j + 1].x - all[j].x, all[j + 1].y - all[j].y);
    if (moved < 4) tele++;
  }
  return c >= 1 ? tele / c : NaN;
}
function straightness(all) { // approach path to the first click: path length / straight-line distance (1 = ruler-straight)
  const k = all.findIndex(p => p.ev === 'Pressed');
  if (k < 3) return NaN;
  let len = 0; for (let i = 1; i <= k; i++) len += Math.hypot(all[i].x - all[i - 1].x, all[i].y - all[i - 1].y);
  const d = Math.hypot(all[k].x - all[0].x, all[k].y - all[0].y);
  return d > 80 && len > 0 ? len / d : NaN;
}

const modalShare = xs => { const m = new Map(); for (const x of xs) { const k = +x.toFixed(6); m.set(k, (m.get(k) || 0) + 1); } return Math.max(...m.values()) / xs.length; };

const asTelemetry = pts => ({
  fields: [], pointer: pts.filter(p => p.ev !== 'Pressed').map(p => ({ t: p.t, x: p.x, y: p.y }))  .slice(-120), // the widget sends the last 120 samples (public/widget.js)
  pointerType: 'mouse', timeOnPageMs: 8000, scrolls: 0, trustedSubmit: true, env: {},
});

function loadAll(dataDir) {
  const recs = [];
  const root = path.join(dataDir, 'delbot-data');
  if (fs.existsSync(root)) {
    for (const dir of fs.readdirSync(root)) {
      const kind = dir.startsWith('circles_human') ? 'human' : dir.startsWith('circles_bot') ? 'bot' : null;
      if (!kind) continue;
      for (const f of fs.readdirSync(path.join(root, dir))) {
        const file = path.join(root, dir, f);
        let s; try { s = parseDelbot(file); } catch { s = { res: null, pts: [] }; }
        recs.push({ id: dir + '/' + f, label: kind, source: dir.replace('circles_', ''), group: dir, res: s.res, pts: s.pts, content: s.pts.map(p => [p.t, p.x, p.y]) });
      }
    }
  }
  const bb = path.join(dataDir, 'Mouse-Dynamics-Challenge', 'training_files');
  if (fs.existsSync(bb)) {
    for (const u of fs.readdirSync(bb)) for (const f of fs.readdirSync(path.join(bb, u))) {
      const s = parseBalabit(path.join(bb, u, f));
      recs.push({ id: 'balabit/' + u + '/' + f, label: 'human', source: 'balabit', group: 'balabit', res: null, pts: s.pts, content: s.pts.slice(0, 600).map(p => [p.t, p.x, p.y]) });
    }
  }
  return recs;
}

function run({ dataDir }) {
  const recs = loadAll(dataDir);
  if (!recs.length) return { skipped: 'no mouse data under ' + dataDir + ' (run validation/fetch.sh)' };

  const quality = Q.audit('mouse-sessions', recs, [
    // short sessions are NOT dropped: the crudest bots (teleporting pointer) produce the shortest sessions, and filtering on the attribute under test inflates the result
    { name: 'almost empty (<3 samples)', drop: true, test: r => (r.pts.length < 3 ? `${r.pts.length} samples` : null) },
    { name: 'short session (<25 samples), kept', drop: false, test: r => (r.pts.length < 25 ? '<25 samples' : null) },
    { name: 'non-finite value', drop: true, test: r => (r.pts.some(p => !Number.isFinite(p.t) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) ? 'NaN' : null) },
    { name: 'time goes backwards', drop: true, test: r => { for (let i = 1; i < r.pts.length; i++) if (r.pts[i].t < r.pts[i - 1].t) return 'at sample ' + i; return null; } },
    { name: 'no click in session', drop: false, test: r => (r.source !== 'balabit' && !r.pts.some(p => p.ev === 'Pressed') ? 'no Pressed event' : null) },
  ]);
  const clean = quality.clean;
  const out = { quality: { ...quality, clean: undefined }, shortcutRisk: {}, passive: {}, features: {}, notes: [] };

  // ---- shortcut audit: can a label be guessed from collection artefacts instead of movement? ----
  const resOf = r => (r.res ? r.res.join('x') : 'unknown');
  const cls = {}; for (const r of clean.filter(x => x.source !== 'balabit')) { (cls[r.label] ||= {})[resOf(r)] = ((cls[r.label] || {})[resOf(r)] || 0) + 1; }
  out.shortcutRisk.resolutionByClass = cls;
  const hr = new Set(Object.keys(cls.human || {})), br = new Set(Object.keys(cls.bot || {}));
  out.shortcutRisk.resolutionsOnlyInOneClass = [...hr].filter(x => !br.has(x)).length + [...br].filter(x => !hr.has(x)).length;
  out.shortcutRisk.sampleClockBySource = {};
  for (const src of [...new Set(clean.map(r => r.source))]) {
    const v = clean.filter(r => r.source === src).map(r => S.quantile(r.pts.slice(1).map((p, i) => p.t - r.pts[i].t).filter(d => d > 0), 0.5)).filter(Number.isFinite);
    out.shortcutRisk.sampleClockBySource[src] = +S.quantile(v, 0.5).toFixed(1);
  }

  // ---- what the invisible pass does with a pointer-only session ----
  const humans = clean.filter(r => r.label === 'human'), bots = clean.filter(r => r.label === 'bot');
  const verdict = r => passive.scorePassive(asTelemetry(r.pts), { score: 0, reasons: [] });
  const vh = humans.map(r => ({ r, v: verdict(r) }));
  out.passive.humans = { n: vh.length, invisiblePass: S.wilson(vh.filter(x => x.v.tier === 'pass').length, vh.length), buttonCheck: S.wilson(vh.filter(x => x.v.tier === 'nudge').length, vh.length), fullCheck: S.wilson(vh.filter(x => x.v.tier === 'challenge').length, vh.length) };
  out.passive.humansBySource = S.byGroup(vh, x => x.r.source, x => x.v.tier !== 'pass').map(g => ({ source: g.group, notInvisiblePass: g.p, ci: [g.lo, g.hi], n: g.n }));
  out.passive.botsBySource = {};
  for (const src of [...new Set(bots.map(r => r.source))]) {
    const vb = bots.filter(r => r.source === src).map(verdict);
    out.passive.botsBySource[src] = { n: vb.length, slippedThroughAsInvisiblePass: S.wilson(vb.filter(x => x.tier === 'pass').length, vb.length), gotButtonCheckOrWorse: S.wilson(vb.filter(x => x.tier !== 'pass').length, vb.length) };
  }

  // ---- feature separation: AUC bot-vs-human, per generator, direction chosen on the data (reported) ----
  const feats = {
    'peak/mean speed (used by passive.js)': r => peakToMean(r.pts.filter(p => p.ev !== 'Pressed').slice(-120)),
    'sample-interval CV (used by scoring.js)': r => intervalCV(r.pts),
    'event rate Hz (arXiv 2607.26935; NOT used)': r => eventRate(r.pts),
    'teleport-click ratio (arXiv 2607.26935; NOT used)': r => teleportClickRatio(r.pts),
    'path straightness (NOT used)': r => straightness(r.pts),
  };
  const humanDelbot = humans.filter(r => r.source !== 'balabit');
  for (const [name, f] of Object.entries(feats)) {
    out.features[name] = {};
    const hv = humanDelbot.map(f).filter(Number.isFinite);
    for (const src of [...new Set(bots.map(r => r.source))]) {
      const bv = bots.filter(r => r.source === src).map(f).filter(Number.isFinite);
      if (bv.length < 20 || hv.length < 20) { out.features[name][src] = { note: 'too few usable sessions', bots: bv.length, humans: hv.length }; continue; }
      const a = S.auc(bv, hv), flipped = a < 0.5;
      const bs = flipped ? bv.map(x => -x) : bv, hs = flipped ? hv.map(x => -x) : hv;
      const ci = S.bootstrap((b, h) => S.auc(b, h), bs, hs, 200);
      out.features[name][src] = { auc: +Math.max(a, 1 - a).toFixed(3), ci: [+ci.lo.toFixed(3), +ci.hi.toFixed(3)], botsAre: flipped ? 'LOWER' : 'HIGHER', nBots: bv.length, nHumans: hv.length };
    }
  }
  // the rule in lib/passive.js reads peak/mean >= 1.4 as "accelerated and braked, like a hand" and < 1.2 as "constant speed".
  // Show where each class actually sits relative to those two cut-offs, so the direction of the rule can be checked.
  const ratio = r => peakToMean(r.pts.filter(p => p.ev !== 'Pressed').slice(-120));
  const stat = rs => { const v = rs.map(ratio).filter(Number.isFinite); return { n: v.length, median: +S.quantile(v, 0.5).toFixed(2), shareBelow1_2: +(v.filter(x => x < 1.2).length / v.length).toFixed(3), shareAtLeast1_4: +(v.filter(x => x >= 1.4).length / v.length).toFixed(3) }; };
  out.ratioVsRule = { human: stat(humanDelbot) };
  for (const src of [...new Set(bots.map(r => r.source))]) out.ratioVsRule[src] = stat(bots.filter(r => r.source === src));
  // a feature that is constant across every session cannot separate anything; say so instead of printing AUC 0.5
  for (const [name, f] of Object.entries(feats)) {
    const all = clean.map(f).filter(Number.isFinite);
    if (all.length < 20) for (const k of Object.keys(out.features[name])) out.features[name][k] = { note: 'not computable here: only ' + all.length + ' sessions have the data this feature needs' };
    else if (modalShare(all) >= 0.95) for (const k of Object.keys(out.features[name])) out.features[name][k] = { note: 'constant on this data (each recording starts at the click, so there is no approach to measure)' };
  }
  out.notes.push(
    'Humans and bots were recorded on different machines and screen sizes; check shortcutRisk before trusting any AUC. A feature that separates only because of the sample clock tells you about the recorder, not the visitor.',
    'Balabit sessions are remote-desktop work, not a web task, so its pointer timing includes network jitter; it is used for the human-side rates only.',
  );
  return out;
}

module.exports = { run };
