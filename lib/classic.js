'use strict';
// Generic recreations of the classic captcha formats, for the arena. They are
// the familiar designs on purpose: the live demo points the same solvers that
// beat them in the wild (OCR, vision models, solver farms, browser agents) at
// these, then at CaptchaMe. They are not copies of any vendor's product.
// The answer never leaves the server; the session carries an HMAC of it.
const crypto = require('crypto');

const ri = n => crypto.randomInt(n);
const rf = () => crypto.randomInt(1e9) / 1e9;
const pick = arr => arr[ri(arr.length)];
const svgUrl = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function noiseLines(w, h, n, colors) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += `<path d="M${ri(w)} ${ri(h)} Q${ri(w)} ${ri(h)} ${ri(w)} ${ri(h)}" stroke="${pick(colors)}" stroke-width="${1 + rf() * 1.6}" fill="none" opacity=".75"/>`;
  }
  return s;
}
function dots(w, h, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${ri(w)}" cy="${ri(h)}" r="${(0.6 + rf() * 1.2).toFixed(1)}" fill="#555" opacity=".5"/>`;
  return s;
}

// ---------- distorted text ----------
function text() {
  const answer = Array.from({ length: 5 }, () => pick(CHARS)).join('');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="240" height="80"><rect width="240" height="80" fill="#efece4"/>`;
  s += noiseLines(240, 80, 5, ['#8a8478', '#6e7f8f', '#9a7b62']);
  [...answer].forEach((ch, i) => {
    const x = 26 + i * 42 + ri(8), y = 52 + ri(12) - 6, rot = ri(50) - 25, sk = ri(30) - 15, size = 32 + ri(9);
    s += `<text x="${x}" y="${y}" font-family="Georgia, 'Courier New', monospace" font-weight="700" font-size="${size}" fill="${pick(['#262626', '#4a3322', '#22344a'])}" transform="rotate(${rot} ${x} ${y}) skewX(${sk})">${ch}</text>`;
  });
  s += noiseLines(240, 80, 3, ['#3a3a3a', '#5b4a3a']) + dots(240, 80, 60) + '</svg>';
  return { params: { image: svgUrl(s), prompt: 'Type the characters you see', input: 'text' }, answer };
}

// ---------- image grid ----------
const SHAPES = ['circle', 'square', 'triangle', 'star'];
const FILLS = ['#e4572e', '#2e86de', '#27ae60', '#f39c12', '#8e44ad'];
function shape(kind, cx, cy, r, fill, rot) {
  if (kind === 'circle') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
  if (kind === 'square') return `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" rx="3" fill="${fill}" transform="rotate(${rot} ${cx} ${cy})"/>`;
  if (kind === 'triangle') return `<polygon points="${cx},${cy - r} ${cx + r * 0.95},${cy + r * 0.8} ${cx - r * 0.95},${cy + r * 0.8}" fill="${fill}" transform="rotate(${rot} ${cx} ${cy})"/>`;
  const pts = [];
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; pts.push((cx + Math.cos(a) * rr).toFixed(1) + ',' + (cy + Math.sin(a) * rr).toFixed(1)); }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" transform="rotate(${rot} ${cx} ${cy})"/>`;
}
function grid() {
  const want = pick(SHAPES);
  const nWant = 2 + ri(3);
  const cells = Array.from({ length: 9 }, (_, i) => (i < nWant ? want : pick(SHAPES.filter(s => s !== want))));
  for (let i = cells.length - 1; i > 0; i--) { const j = ri(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300"><rect width="300" height="300" fill="#ddd"/>`;
  cells.forEach((kind, i) => {
    const x = (i % 3) * 100, y = Math.floor(i / 3) * 100;
    s += `<rect x="${x + 2}" y="${y + 2}" width="96" height="96" fill="hsl(${ri(360)},25%,${82 + ri(10)}%)"/>`;
    s += shape(kind, x + 50 + ri(16) - 8, y + 50 + ri(16) - 8, 18 + ri(12), pick(FILLS), ri(60));
  });
  s += noiseLines(300, 300, 6, ['#ffffff', '#999999']) + '</svg>';
  const answer = cells.map((k, i) => (k === want ? i : -1)).filter(i => i >= 0).join(',');
  return { params: { image: svgUrl(s), prompt: 'Select every ' + want, input: 'grid' }, answer };
}

// ---------- math ----------
function math() {
  const op = pick(['+', '-', '×']);
  let a = 2 + ri(12), b = 1 + ri(9);
  if (op === '-' && b > a) [a, b] = [b, a];
  const answer = String(op === '+' ? a + b : op === '-' ? a - b : a * b);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="240" height="80"><rect width="240" height="80" fill="#eef1f4"/>`;
  s += noiseLines(240, 80, 4, ['#9aa7b4', '#b48f9a']);
  [String(a), op, String(b), '=', '?'].forEach((tok, i) => {
    const x = 26 + i * 44, y = 52 + ri(8) - 4;
    s += `<text x="${x}" y="${y}" font-family="Georgia, serif" font-weight="700" font-size="32" fill="#2a2f36" transform="rotate(${ri(24) - 12} ${x} ${y})">${tok}</text>`;
  });
  s += dots(240, 80, 30) + '</svg>';
  return { params: { image: svgUrl(s), prompt: 'Solve the sum', input: 'text' }, answer };
}

// ---------- slider puzzle ----------
function slider() {
  const notchX = 90 + ri(170), notchY = 30 + ri(60), size = 44;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 150" width="320" height="150"><rect width="320" height="150" fill="#cfd8dc"/>`;
  for (let i = 0; i < 18; i++) s += `<rect x="${ri(320)}" y="${ri(150)}" width="${20 + ri(70)}" height="${20 + ri(60)}" fill="${pick(['#90a4ae', '#a5d6a7', '#ffe082', '#ef9a9a', '#b39ddb'])}" opacity=".7" transform="rotate(${ri(40) - 20})"/>`;
  s += `<rect x="${notchX}" y="${notchY}" width="${size}" height="${size}" rx="6" fill="#000" opacity=".45" stroke="#fff" stroke-width="2"/></svg>`;
  return { params: { image: svgUrl(s), prompt: 'Drag the slider until the piece fills the gap', input: 'slider', width: 320, pieceY: notchY, pieceSize: size }, answer: String(notchX) };
}

// ---------- bare checkbox ----------
function checkbox() {
  return { params: { prompt: "Tick the box: I'm not a robot", input: 'checkbox' }, answer: 'checked' };
}

// ---------- rotate the picture upright ----------
function rotate() {
  const tilt = 30 + ri(11) * 30; // 30..330 degrees, never upright
  const scene = `<g transform="rotate(${tilt} 80 80)">
    <rect x="0" y="104" width="160" height="56" fill="#7cb342"/>
    <rect x="44" y="64" width="72" height="44" fill="#ffcc80" stroke="#6d4c41" stroke-width="3"/>
    <polygon points="36,66 80,30 124,66" fill="#d84315"/>
    <rect x="72" y="82" width="16" height="26" fill="#6d4c41"/>
    <circle cx="128" cy="26" r="11" fill="#fdd835"/></g>`;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160"><defs><clipPath id="c"><circle cx="80" cy="80" r="78"/></clipPath></defs><g clip-path="url(#c)"><rect width="160" height="160" fill="#90caf9"/>${scene}</g><circle cx="80" cy="80" r="78" fill="none" stroke="#455a64" stroke-width="3"/></svg>`;
  return { params: { image: svgUrl(s), prompt: 'Turn the picture upright', input: 'rotate' }, answer: '', secret: { need: (360 - tilt) % 360 } };
}

// ---------- click the shapes in order ----------
function click() {
  const pts = [];
  while (pts.length < 5) {
    const p = { x: 30 + ri(260), y: 30 + ri(140) };
    if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 58)) pts.push(p);
  }
  const used = ['circle', 'square', 'triangle', 'star', 'circle'].map((kind, i) => ({ kind, ...pts[i], fill: FILLS[i] }));
  const order = [3, 0, 2]; // star, circle, triangle
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200"><rect width="320" height="200" fill="#e8eaf0"/>`;
  s += noiseLines(320, 200, 6, ['#b0b6c6', '#c9b6b6']);
  used.forEach(u => { s += shape(u.kind, u.x, u.y, 19, u.fill, ri(40)); });
  s += '</svg>';
  return {
    params: { image: svgUrl(s), prompt: 'Click, in order: the star, the orange-red circle, the triangle', input: 'click', width: 320, height: 200 },
    answer: '', secret: { pts: order.map(i => ({ x: used[i].x, y: used[i].y })) },
  };
}

// ---------- proof of work (the ALTCHA / Friendly Captcha idea) ----------
function pow() {
  return { params: { prompt: 'Your browser computes a proof of work. No human involved at all.', input: 'pow', salt: crypto.randomBytes(12).toString('hex'), bits: 15 }, answer: '' };
}
function leadingZeroBits(buf) {
  let n = 0;
  for (const byte of buf) { if (byte === 0) { n += 8; continue; } n += Math.clz32(byte) - 24; break; }
  return n;
}

const MAKERS = { text, grid, math, slider, checkbox, rotate, click, pow };

function normalize(type, v) {
  if (type === 'grid') return String(v || '').split(',').map(x => parseInt(x, 10)).filter(Number.isFinite).sort((a, b) => a - b).join(',');
  if (type === 'slider') return String(Math.round(Number(v)));
  return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function make(type) { const m = MAKERS[type]; return m ? m() : null; }

// Returns {ok, reason}. `ah` is the HMAC the session carries; `hmac` is the
// server's keyed hash function, so this module never sees the secret.
function check(type, ah, input, extra, hmac, secret) {
  extra = extra || {};
  if (type === 'rotate') {
    const v = Number(input);
    if (!Number.isFinite(v) || !secret) return { ok: false, reason: 'no rotation sent' };
    const off = Math.abs(((v - secret.need) % 360 + 540) % 360 - 180);
    return off <= 15 ? { ok: true, reason: 'turned upright (within ' + Math.round(off) + ' degrees)' } : { ok: false, reason: 'still tilted by ' + Math.round(off) + ' degrees' };
  }
  if (type === 'click') {
    const pts = Array.isArray(input) ? input : [];
    if (!secret || pts.length !== secret.pts.length) return { ok: false, reason: 'expected ' + (secret ? secret.pts.length : 3) + ' clicks' };
    const ok = secret.pts.every((p, i) => pts[i] && Math.hypot(Number(pts[i].x) - p.x, Number(pts[i].y) - p.y) <= 22);
    return { ok, reason: ok ? 'clicked the right shapes in order' : 'wrong shape or wrong order' };
  }
  if (type === 'pow') {
    if (!extra.salt) return { ok: false, reason: 'no challenge' };
    const h = crypto.createHash('sha256').update(extra.salt + ':' + String(input)).digest();
    const z = leadingZeroBits(h);
    return z >= (extra.bits || 15) ? { ok: true, reason: 'valid proof of work (' + z + ' zero bits); any machine can do this' } : { ok: false, reason: 'invalid proof of work' };
  }
  if (type === 'slider') {
    // the answer hash covers the exact notch; accept any position within 6 px
    const v = Math.round(Number(input));
    if (!Number.isFinite(v)) return { ok: false, reason: 'no slider position sent' };
    for (let d = -6; d <= 6; d++) if (hmac(String(v + d)) === ah) return { ok: true, reason: 'piece placed within ' + Math.abs(d) + ' px' };
    return { ok: false, reason: 'piece did not land in the gap' };
  }
  if (type === 'checkbox') {
    // A bare checkbox can only look at crude signals. That is the point.
    if (extra.webdriver) return { ok: false, reason: 'browser reports automation control' };
    if ((extra.moves || 0) < 3) return { ok: false, reason: 'no mouse movement before the click' };
    if ((extra.elapsedMs || 0) < 600) return { ok: false, reason: 'ticked too fast' };
    return { ok: true, reason: 'ticked after some mouse movement' };
  }
  const ok = hmac(normalize(type, input)) === ah;
  return { ok, reason: ok ? 'answer correct' : 'answer wrong' };
}

module.exports = { make, check, normalize, TYPES: Object.keys(MAKERS) };
