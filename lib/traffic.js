'use strict';
// This server's own access log, kept in memory: the last requests it received,
// in the JSON-lines shape the log audit reads. Lives on globalThis so the
// Next.js proxy (page and asset requests) and the API handler (API requests,
// with status and size) write to one buffer in the same process.
// Nothing here is written to disk; a restart starts it empty.

const MAX = Number(process.env.POP_TRAFFIC_MAX) || 20000;
const buf = globalThis.__captchameTraffic || (globalThis.__captchameTraffic = { rows: [], since: Date.now() });

function record(r) {
  buf.rows.push({
    ip: String(r.ip || '').slice(0, 64),
    time: new Date(r.t || Date.now()).toISOString(),
    method: String(r.method || 'GET').slice(0, 10),
    path: String(r.path || '/').slice(0, 300),
    status: r.status | 0,
    bytes: r.bytes | 0,
    ua: String(r.ua || '').slice(0, 300),
  });
  if (buf.rows.length > MAX) buf.rows.splice(0, buf.rows.length - MAX);
}
function lines() { return buf.rows.map(r => JSON.stringify(r)).join('\n'); }
function info() { return { requests: buf.rows.length, since: buf.since, max: MAX }; }
function reset() { buf.rows.length = 0; buf.since = Date.now(); }

module.exports = { record, lines, info, reset };
