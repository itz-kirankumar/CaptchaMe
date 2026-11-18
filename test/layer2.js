'use strict';
// Layer 2 end to end: real server, real HTTP, built-in attackers. Each attacker is judged by what layer 2
// concludes about it, never by what it claims to be.
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const actors = require('./actors');
const simbots = require('../lib/simbots');

const PORT = 3600 + Math.floor(Math.random() * 300);
const ADMIN = 'l2-test-admin';
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, p, body, headers = {}) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const h = { ...headers };
    if (data) { h['content-type'] = 'application/json'; h['content-length'] = data.length; }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(c).toString('utf8')); } catch { /* not json */ } resolve({ status: res.statusCode, body: j, headers: res.headers }); });
    });
    r.on('error', () => resolve({ status: 0, body: {} }));
    if (data) r.write(data);
    r.end();
  });
}
const chromeV = (ua) => (/Chrome\/(\d+)/.exec(ua) || [])[1] || '142';
const browserHeaders = (ua, ip, extra = {}) => ({
  'user-agent': ua, accept: '*/*', 'accept-language': 'en-US,en;q=0.9', 'accept-encoding': 'gzip, deflate, br', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty',
  'sec-ch-ua': `"Chromium";v="${chromeV(ua)}", "Google Chrome";v="${chromeV(ua)}", "Not_A Brand";v="99"`, 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'x-forwarded-for': ip, ...extra,
});
const UA_A = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
async function collectCues(start, hdr) {
  const P = start.body.params, want = P.dartCount || P.flashCount || 0, got = new Map(), t0 = Date.now();
  while (got.size < want && Date.now() - t0 < P.durationMs + 2000) {
    const c = await req('POST', '/api/challenge/cue', { session: start.body.session }, hdr);
    for (const cue of (c.body && c.body.cues) || []) if (!got.has(cue.i)) got.set(cue.i, { ...cue, appliedAt: cue.srv });
    await sleep(120);
  }
  const cues = [...got.values()].sort((a, b) => a.i - b.i);
  return { cues, live: { ...P, darts: cues.map((c) => ({ at: c.appliedAt, px: c.px, py: c.py })) } };
}
// A person-shaped ring run. waitFrac 1.05 = performs the whole challenge; 0.78 = answers early with the same samples.
async function humanRun(hdr, env, seed, waitFrac) {
  const start = await req('POST', '/api/challenge/start', { type: 'ring' }, hdr);
  const t0 = Date.now(), c = await collectCues(start, hdr);
  const samples = actors.humanRing(c.live, seed);
  await sleep(Math.max(0, waitFrac * start.body.params.durationMs - (Date.now() - t0)));
  return req('POST', '/api/challenge/submit', { session: start.body.session, samples, cues: c.cues, env }, hdr);
}
const overview = async () => (await req('GET', '/api/layer2/overview', null, { 'x-admin-key': ADMIN })).body;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), POP_ADMIN_KEY: ADMIN, POP_RATE_PER_MIN: '4000', POP_ACTIVE_GRACE_MS: '800', LAYER2_MODE: 'enforce' }, stdio: 'pipe' });
  await new Promise((res) => srv.stdout.once('data', res));
  try {
    console.log('\n== layer 2 is admin-only ==');
    check('overview refuses a caller without the admin key', (await req('GET', '/api/layer2/overview')).status === 403);

    console.log('\n== attackers (all at once, ~16 s) ==');
    const attackers = ['script', 'farm', 'headless', 'agent', 'adaptive', 'scraper', 'rotator'];
    await Promise.all(attackers.map((b) => simbots.run(b, PORT)));
    await sleep(300);
    const ov = await overview();
    const byLabel = {};
    for (const s of ov.top) for (const a of s.attackers) (byLabel[a] = byLabel[a] || []).push(s);
    // top is cost-ranked and capped; fetch every identity touched by label through detail of listed ids
    const find = (label) => (byLabel['Sim: ' + label] || []).sort((a, b) => b.obs - a.obs);
    const one = (label) => find(label)[0];

    const script = one('Python script');
    check('python script is classed scripted_bot and blocked', script && script.cls === 'scripted_bot' && script.decision === 'block', JSON.stringify(script && [script.cls, script.conf, script.decision]));
    const farm = one('solver farm (2Captcha-style)');
    check('solver farm and its worker are one identity (start and answer share a signed challenge id)', farm && farm.identities.uas >= 2 && farm.identities.ips >= 2, JSON.stringify(farm && farm.identities));
    check('solver farm is classed solver_service and blocked', farm && farm.cls === 'solver_service' && farm.decision === 'block', JSON.stringify(farm && [farm.cls, farm.conf, farm.decision, farm.top]));
    const head = one('stealth headless browser');
    check('stealth headless browser is an automation browser or script and blocked', head && ['automation_browser', 'scripted_bot'].includes(head.cls) && head.decision === 'block', JSON.stringify(head && [head.cls, head.conf]));
    const agent = one('computer-use AI agent');
    check('computer-use agent is classed llm_agent and blocked', agent && agent.cls === 'llm_agent' && agent.decision === 'block', JSON.stringify(agent && [agent.cls, agent.conf, agent.families]));
    const mimic = one('advanced human-mimic');
    check('layer 1 passed the human-mimic, layer 2 classes it human_mimic', mimic && mimic.challenges.passes >= 1 && mimic.cls === 'human_mimic', JSON.stringify(mimic && [mimic.cls, mimic.challenges, mimic.top]));
    check('human-mimic gets step_up (a fresh live check), not a pass', mimic && mimic.decision === 'step_up');
    const scraper = one('scraper (one address)');
    check('plain scraper is classed scraper', scraper && scraper.cls === 'scraper', JSON.stringify(scraper && [scraper.cls, scraper.conf, scraper.scrape]));

    console.log('\n== identity: rotating address and browser name is still one client ==');
    const rot = find('rotating-proxy scraper');
    const main = rot[0];
    check('rotating scraper collapses into one identity (not ' + rot.length + ')', rot.length === 1, 'identities: ' + rot.length);
    const d = main && (await req('GET', '/api/layer2/subject/' + main.id, null, { 'x-admin-key': ADMIN })).body;
    check('that identity saw many networks and many user agents', d && d.identities && d.identities.ips >= 6 && d.identities.uas >= 4, JSON.stringify(d && d.identities));
    check('rotating scraper is classed scraper, with IP_ROTATION evidence', d && d.cls === 'scraper' && (d.evidence || []).some((e) => e.code === 'IP_ROTATION'), JSON.stringify(d && [d.cls, (d.evidence || []).map((e) => e.code)]));
    const ids = new Set(Object.values(byLabel).flat().map((s) => s.id));
    check('different attackers were not merged into each other', new Set([script, farm, head, agent, mimic, scraper, main].filter(Boolean).map((s) => s.id)).size === 7);

    check('no fragmentation: 7 attackers and their relay workers make at most 12 identities (got ' + ov.identities + ')', ov.identities <= 12, String(ov.identities));
    console.log('\n== resource and scraping analysis ==');
    check('overview counts layer 1 packets', ov.packets > 50, String(ov.packets));
    check('scraping analysis sees the catalogue walk', ov.scraping.catalogPagesTouched >= 20 && ov.scraping.hits >= 40, JSON.stringify(ov.scraping));
    check('bypass analysis counts rival captchas beaten and the attacker cost', ov.bypass.rivalSolved >= 20 && ov.bypass.attackerSpendUsd > 0, JSON.stringify(ov.bypass));
    check('layer 1 and layer 2 totals agree: layer 1 blocked and passed counts are reported', ov.bypass.layer1Blocked >= 3 && ov.bypass.layer1Passed >= 1, JSON.stringify([ov.bypass.layer1Blocked, ov.bypass.layer1Passed]));
    check('flag matrix shows flags at several layers', ['L1', 'L3', 'L4', 'L5', 'L6'].filter((l) => Object.values(ov.matrix[l]).some((n) => n > 0)).length >= 4);
    check('bots account for cost', ov.usd.onBots > 0, JSON.stringify(ov.usd));

    console.log('\n== post-verification gate on the protected API ==');
    const envA = { webdriver: false, plugins: 6, hardware: 16, langs: 2, screen: '1680x1050', outer: '1200x780', tz: 'Europe/London' };
    const envB = { webdriver: false, plugins: 4, hardware: 6, langs: 2, screen: '1536x864', outer: '1400x800', tz: 'Europe/Berlin' };
    const hA = browserHeaders(UA_A.replace('142', '143'), '81.2.69.10'), hB = browserHeaders(UA_A.replace('142', '141'), '88.150.12.77');
    const [good, cheat] = await Promise.all([humanRun(hA, envA, 21, 1.05), humanRun(hB, envB, 22, 0.78)]);
    check('a person who performs the whole challenge passes layer 1', good.body.result === 'pass', JSON.stringify(good.body.flags));
    check('a generated path answered early also passes layer 1 (the known gap)', cheat.body.result === 'pass', JSON.stringify(cheat.body.flags));
    const qGood = await req('GET', '/api/protected/quote', null, { ...hA, cookie: 'pop_actor=' + encodeURIComponent(good.body.actor) });
    const dg = qGood.status === 200 ? null : (await req('GET', '/api/layer2/subject/' + qGood.body.subject, null, { 'x-admin-key': ADMIN })).body;
    check('layer 2 lets the real person through the protected API', qGood.status === 200, dg ? JSON.stringify({ cls: dg.cls, ids: dg.identities, mergeLog: dg.mergeLog, ev: dg.evidence.map((e) => e.code + ':' + e.text) }) : '');
    const qCheat = await req('GET', '/api/protected/quote', null, { ...hB, cookie: 'pop_actor=' + encodeURIComponent(cheat.body.actor) });
    check('layer 2 refuses the early-answer pass with step_up_required', qCheat.status === 403 && qCheat.body.error === 'step_up_required' && qCheat.body.class === 'human_mimic', JSON.stringify(qCheat.body).slice(0, 240));
    check('the refusal carries a reason, an appeal link and a way back', qCheat.body.reason && qCheat.body.appeal_url && qCheat.body.challenge_url === '/check');
    const dc = (await req('GET', '/api/layer2/subject/' + qCheat.body.subject, null, { 'x-admin-key': ADMIN })).body;
    check('evidence names the clock mismatch at layer 5', (dc.evidence || []).some((e) => e.code === 'CLOCK_SKEW' && e.layer === 'L5'), JSON.stringify(dc.evidence && dc.evidence.map((e) => e.code)));

    console.log('\n== reset ==');
    await req('POST', '/api/layer2/reset', {}, { 'x-admin-key': ADMIN });
    check('reset clears identities', (await overview()).identities === 0);
  } finally { srv.kill(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
