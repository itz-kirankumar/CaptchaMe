'use strict';
// Rung 1 of the risk ladder: the invisible pass.
// While a visitor fills in a form, the widget records HOW they filled it, never
// what they typed: key-hold and gap timings (no key values), paste and autofill
// flags, the pointer path, time on page, and whether the submit was a real
// event. Most people pass here without seeing anything. Mild doubt gets a
// one-second button check (rung 1b); strong machine signals get a full check.
// Password managers and paste are normal: they lead to a nudge, never a block.

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

function clean(tel) {
  tel = tel && typeof tel === 'object' ? tel : {};
  const fields = (Array.isArray(tel.fields) ? tel.fields : []).slice(0, 40).map(f => ({
    keys: (Array.isArray(f && f.keys) ? f.keys : []).slice(0, 400).map(k => ({ d: num(k && k.d), f: num(k && k.f) })).filter(k => k.d !== null && k.d >= 0 && k.d < 3000),
    pasted: !!(f && f.pasted), autofilled: !!(f && f.autofilled), chars: Math.max(0, Math.min(10000, num(f && f.chars) || 0)),
  }));
  const pointer = (Array.isArray(tel.pointer) ? tel.pointer : []).slice(-400).filter(p => p && [p.t, p.x, p.y].every(Number.isFinite));
  return {
    fields, pointer, pointerType: String(tel.pointerType || 'mouse').slice(0, 10),
    timeOnPageMs: num(tel.timeOnPageMs) || 0, scrolls: num(tel.scrolls) || 0,
    trustedSubmit: tel.trustedSubmit !== false, env: tel.env || {},
  };
}

// net: { score, reasons } from shield.networkRisk for this request
function scorePassive(raw, net) {
  const t = clean(raw);
  const hard = [], doubt = [], evidence = [];
  const keys = t.fields.flatMap(f => f.keys);
  const dwell = keys.map(k => k.d);
  const flights = keys.map(k => k.f).filter(x => x !== null && x >= 0 && x < 5000);
  const filled = t.fields.filter(f => f.chars > 0);
  const typedFields = filled.filter(f => f.keys.length >= Math.min(3, f.chars));
  const assisted = filled.filter(f => f.pasted || f.autofilled);
  const detail = { timeOnPageMs: Math.round(t.timeOnPageMs), keys: keys.length, fieldsFilled: filled.length, fieldsTyped: typedFields.length, fieldsAssisted: assisted.length, pointerSamples: t.pointer.length, networkRisk: net ? net.score : 0 };

  // ---- strong machine signals: go straight to a full check
  if (t.env.webdriver === true) hard.push('the browser reports it is under automation control');
  if (!t.trustedSubmit) hard.push('the form was submitted by page script, not by a person');
  if (net && net.score >= 55) hard.push('the connection looks automated: ' + net.reasons.slice(0, 2).join('; '));
  if (t.timeOnPageMs > 0 && t.timeOnPageMs < 1200) hard.push('submitted ' + Math.round(t.timeOnPageMs) + ' ms after the page loaded');
  if (dwell.length >= 8 && std(dwell) < 6) hard.push('every key was held for the same time (sd ' + std(dwell).toFixed(1) + ' ms)');
  if (flights.length >= 8 && flights.every(f => f < 15)) hard.push('keys arrived faster than fingers can move');
  if (filled.length && !keys.length && !assisted.length && t.pointer.length < 3) hard.push('fields were filled with no typing, pasting, autofill or pointer: programmatic input');

  // ---- doubt: a quick button check, never a block
  if (net && net.score >= 30 && net.score < 55) doubt.push('the connection is unusual: ' + net.reasons[0]);
  if (filled.length && assisted.length === filled.length && t.pointer.length < 5) doubt.push('no typing or pointer movement to judge (autofill or paste)');
  if (keys.length < 3 && t.pointer.length < 5) doubt.push('too little interaction to judge');
  let ratio = null;
  if (t.pointerType !== 'touch' && t.pointer.length >= 8) {
    const v = [];
    for (let i = 1; i < t.pointer.length; i++) { const dt = t.pointer[i].t - t.pointer[i - 1].t; if (dt > 0 && dt < 200) v.push(Math.hypot(t.pointer[i].x - t.pointer[i - 1].x, t.pointer[i].y - t.pointer[i - 1].y) / dt); }
    if (v.length >= 6 && mean(v) > 0) {
      ratio = Math.max(...v) / mean(v);
      detail.pointerPeakToMean = +ratio.toFixed(2);
      if (ratio < 1.2) doubt.push('the pointer moved at a constant speed');
    }
  }

  // ---- positive evidence of a person
  if (dwell.length >= 6 && std(dwell) >= 12) evidence.push('natural variation in how long keys are held (sd ' + Math.round(std(dwell)) + ' ms)');
  if (flights.length >= 6 && std(flights) >= 25) evidence.push('irregular gaps between keystrokes, like a person typing');
  if (ratio !== null && ratio >= 1.4) evidence.push('the pointer accelerated and braked on its way');
  if (t.pointerType === 'touch' && t.timeOnPageMs >= 2500 && (keys.length >= 3 || t.scrolls > 0)) evidence.push('touch session with normal pacing');
  if (!evidence.length && assisted.length && t.timeOnPageMs >= 2500 && t.pointer.length >= 5) evidence.push('normal pacing with autofill');

  let tier, score = 100;
  if (hard.length) { tier = 'challenge'; score = 10; }
  else if (doubt.length || !evidence.length) { tier = 'nudge'; score = 55; }
  else tier = 'pass';
  return { tier, score, reasons: hard.length ? hard : doubt.length ? doubt : (evidence.length ? [] : ['not enough evidence yet']), evidence: tier === 'pass' ? evidence : [], detail };
}

// Rung 1b: hold the submit button, release when it turns green.
// One reaction to a go signal: people release 150-700 ms after it; a script
// watching the page releases at once; a look-think-act agent misses the window.
function scoreNudge(params, r) {
  const press = num(r && r.pressAt), go = num(r && r.goShownAt), rel = num(r && r.releaseAt);
  if ([press, go, rel].some(x => x === null)) return { ok: false, reason: 'the button check was not completed' };
  if (r.trusted === false) return { ok: false, reason: 'the button was pressed by page script' };
  const wait = go - press, rt = rel - go;
  if (Math.abs(wait - params.goAfterMs) > 250) return { ok: false, reason: 'the go signal timing does not match this check' };
  if (rel < go) return { ok: false, reason: 'released before the button turned green' };
  if (rt < 120) return { ok: false, reason: 'released ' + Math.round(rt) + ' ms after the go signal: faster than a person can react' };
  if (rt > 900) return { ok: false, reason: 'released ' + Math.round(rt) + ' ms after the go signal: too slow for a live reaction' };
  return { ok: true, reason: 'released ' + Math.round(rt) + ' ms after the go signal', rtMs: Math.round(rt) };
}

module.exports = { scorePassive, scoreNudge };
