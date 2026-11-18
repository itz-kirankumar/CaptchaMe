import { Fragment } from 'react';
import Link from 'next/link';
import PageHead from '../../components/PageHead';
import data from './data.json';

export const metadata = { title: 'Evidence' };

const REPO = 'https://github.com/itz-kirankumar/buildathon-captchame/blob/main/';
const pct = (x) => (x * 100).toFixed(1) + '%';
const num = (n) => Number(n).toLocaleString('en-US');
// a rate with its interval and n, as plain text
const R = (r) => `${pct(r.p)} [${pct(r.lo).replace('%', '')}, ${pct(r.hi).replace('%', '')}]`;
const N = (r) => (r.people ? `across ${num(r.people)} people (${num(r.n)} sessions)` : `n = ${num(r.n)}`);
const DASH = '—';

const { typing, pointer, clash, identity } = data;
const a = identity.categories;
const generated = new Date(data.generatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// One row per captcha we ship. Measured rows read their numbers from data.json.
const ROWS = [
  // own checks
  { g: 'Our own checks', name: 'Invisible pass: typing', what: 'How a form is typed: key-hold and key-gap timing', set: `${typing.dataset.name.replace(/ \(.*\)/, '')}, ${num(typing.dataset.used)} samples`, humans: `${R(typing.humansPass)} given the invisible pass`, bots: `Fixed timing denied ${pct(typing.adversaries['fixed timing (script)'].denied.p)}. Uniform random jitter denied ${pct(typing.adversaries['uniform random jitter'].denied.p)}.`, status: 'Measured' },
  { name: 'Invisible pass: pointer', what: 'How the pointer moves before a submit', set: `Public mouse sessions, ${num(pointer.dataset.used)} sessions`, humans: `${R(pointer.humansPass)} given the invisible pass`, bots: `All four tested bot generators got the invisible pass ${pct(Math.min(...Object.values(pointer.bots).map((b) => b.gotThrough.p)))} to ${pct(Math.max(...Object.values(pointer.bots).map((b) => b.gotThrough.p)))} of the time.`, status: 'Measured' },
  { name: 'One-second button check', what: 'Hold the button, release when it turns green', set: null, status: 'Not measured yet' },
  { name: 'Follow the ring', what: 'Track a moving ring that jumps twice', set: null, status: 'Not measured yet' },
  { name: 'Colour clash', what: 'Pick the ink colour, not the word', set: `${clash.dataset.name}, ${num(clash.dataset.used)} trials from ${num(clash.dataset.people)} people`, humans: `${R(clash.humansPass)} pass`, bots: null, status: 'Partly measured' },
  { name: 'Targets', what: 'Click targets of different size and distance', set: null, status: 'Not measured yet' },
  { name: 'Catch the flash', what: 'Click five flashes inside short windows', set: null, status: 'Not measured yet' },
  { name: 'Follow + catch', what: 'Track the ring and react to flashes', set: null, status: 'Not measured yet' },
  { name: 'Tap the beat', what: 'Tap along with twelve pulses', set: null, status: 'Not measured yet' },
  { name: 'Voice path', what: 'Say four words back; vocal onset timing', set: null, status: 'Not measured yet' },
  { name: 'Agent lane', what: 'A signed nonce from a declared agent', set: null, status: 'Not measured yet' },
  { name: 'Scraper shield and log audit', what: 'What a client says it is (user agent), rate, order', set: `${identity.dataset.name} lists, ${num(identity.dataset.kept)} entries`, humans: `${a.human.flagged.k} of ${a.human.n} real browsers wrongly flagged`, bots: `Agents ${pct(a.agent.flagged.p)}, AI crawlers ${pct(a['ai-crawler'].flagged.p)}, crawlers ${pct(a.crawler.flagged.p)}, other bots ${pct(a.bot.flagged.p)} flagged.`, status: 'Partly measured' },
  // classic
  ...[['Distorted text', 'Read warped characters'], ['Image grid', 'Pick all tiles with a shape'], ['Math', 'Solve a sum shown as an image'], ['Slider', 'Drag a piece into a gap'], ['Bare checkbox', 'Tick a box, with crude signals'], ['Rotate', 'Turn a picture upright'], ['Click in order', 'Click shapes in a given order'], ['Proof of work', 'The browser computes a hash puzzle']].map(([name, what], i) => ({ g: i === 0 ? 'Classic formats (arena and try pages)' : undefined, name, what, set: null, status: 'Not measured yet' })),
  // third party
  ...[['Cloudflare Turnstile'], ['hCaptcha'], ['Google reCAPTCHA v2']].map(([name], i) => ({ g: i === 0 ? 'Third-party widgets (need site keys)' : undefined, name, what: 'The vendor widget, verified server side', set: null, status: 'Not measured yet' })),
];

const sweep = clash.windowSweep;

function Status({ s }) {
  const cls = s === 'Measured' ? 'human' : s === 'Partly measured' ? 'warn' : '';
  return <span className={'chip ' + cls}>{s}</span>;
}

export default function Page() {
  return (<>
    <PageHead kicker="Evidence" title="What we measured, and what we have not">
      Measured on public data with the real scoring code. Intervals count people, not samples. Data file made {generated}.
    </PageHead>

    <section className="ev-sec">
      <h2>Every captcha we ship</h2>
      <p className="ev-sub">An em dash ({DASH}) means no data. It does not mean zero. Rates show a 95% interval in square brackets.</p>
      <table className="ev-table">
        <caption className="ev-cap">Measured results for each check</caption>
        <thead><tr><th scope="col">Check</th><th scope="col">What it checks</th><th scope="col">Data used</th><th scope="col">Humans passed</th><th scope="col">Bots stopped</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {ROWS.map((r) => (<Fragment key={r.name}>
            {r.g && <tr className="ev-group" key={'g' + r.g}><th scope="colgroup" colSpan={6}>{r.g}</th></tr>}
            <tr key={r.name}>
              <th scope="row" data-label="Check">{r.name}</th>
              <td data-label="What it checks">{r.what}</td>
              <td data-label="Data used">{r.set || DASH}</td>
              <td data-label="Humans passed">{r.humans || DASH}</td>
              <td data-label="Bots stopped">{r.bots || DASH}</td>
              <td data-label="Status"><Status s={r.status} /></td>
            </tr>
          </Fragment>))}
        </tbody>
      </table>
    </section>

    <section className="ev-sec">
      <h2>The measured checks, in detail</h2>
      <div className="ev-grid">
        <article className="card ev-card">
          <h3>Invisible pass: typing</h3>
          <ul>
            <li>Humans given the invisible pass: <b>{R(typing.humansPass)}</b>, {N(typing.humansPass)}.</li>
            <li>False alarms (sent to a full check): {R(typing.falseAlarm)}, {N(typing.falseAlarm)}.</li>
            <li>Counted by person: <b>{R(typing.falseAlarmByPerson)}</b> {N(typing.falseAlarmByPerson)}. This is the honest interval.</li>
            <li>Two typists were flagged {Math.round(typing.worstTypists[0].notPassed * 100)}% and {Math.round(typing.worstTypists[1].notPassed * 100)}% of the time (400 tries each).</li>
          </ul>
          <table className="ev-mini"><caption>Synthetic adversaries denied the invisible pass</caption>
            <thead><tr><th scope="col">Adversary</th><th scope="col">Denied</th><th scope="col">n</th></tr></thead>
            <tbody>{Object.entries(typing.adversaries).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{R(v.denied)}</td><td>{num(v.n)}</td></tr>)}</tbody>
          </table>
          <p className="ev-note">The adversaries are synthetic and written by us. Fitted-to-human and uniform jitter get through. That is the measured gap.</p>
        </article>

        <article className="card ev-card">
          <h3>Invisible pass: pointer</h3>
          <ul>
            <li>Humans given the invisible pass: <b>{R(pointer.humansPass)}</b>, {N(pointer.humansPass)}.</li>
            {pointer.phone && <li>Phone users <b>not</b> given it: <b>{pct(pointer.phone.notPassed)} [{pct(pointer.phone.lo).replace('%', '')}, {pct(pointer.phone.hi).replace('%', '')}]</b>, n = {num(pointer.phone.n)}.</li>}
          </ul>
          <table className="ev-mini"><caption>Bot generators that got the invisible pass</caption>
            <thead><tr><th scope="col">Generator</th><th scope="col">Got through</th><th scope="col">n</th></tr></thead>
            <tbody>{Object.entries(pointer.bots).map(([k, v]) => <tr key={k}><th scope="row">{k.replace('bot_', '')}</th><td>{R(v.gotThrough)}</td><td>{num(v.n)}</td></tr>)}</tbody>
          </table>
          <p className="ev-note">Humans and bots were recorded on different machines. A feature can separate them because of the recorder, not the visitor.</p>
        </article>

        <article className="card ev-card">
          <h3>Colour clash</h3>
          <ul>
            <li>Humans who pass: <b>{R(clash.humansPass)}</b>, {N(clash.humansPass)}.</li>
            <li>Failure counted by person: <b>{R(clash.failByPerson)}</b> {N(clash.failByPerson)}.</li>
            <li>Median reaction time: <b>{clash.rtMs.median} ms</b> (5th percentile {clash.rtMs.p05} ms, 95th percentile {clash.rtMs.p95} ms).</li>
            <li>Trials past the {num(clash.windowMs)} ms window: {R(clash.pastWindow)}, n = {num(clash.pastWindow.n)} trials.</li>
            <li>Bots: <b>not measured</b>.</li>
          </ul>
          {sweep ? (
            <table className="ev-mini"><caption>Answer-window sweep</caption>
              <thead><tr><th scope="col">Window</th><th scope="col">Humans passing</th></tr></thead>
              <tbody>{sweep.map((w) => <tr key={w.windowMs}><th scope="row">{(w.windowMs / 1000).toFixed(1)} s</th><td>{R(w.humanPass)}</td></tr>)}</tbody>
            </table>
          ) : (
            <p className="ev-note"><b>Answer-window sweep: not in the saved results file.</b> The harness can compute 1.0 s to 2.5 s, but this file has no sweep. It will show here after the next full run.</p>
          )}
          <p className="ev-note">Reaction times come from a keyboard task. A click or tap adds pointing time, so lateness here is a lower bound.</p>
        </article>

        <article className="card ev-card">
          <h3>Client identity (shield and audit)</h3>
          <table className="ev-mini"><caption>Clients flagged as automated, by what they say they are</caption>
            <thead><tr><th scope="col">Says it is</th><th scope="col">Flagged</th><th scope="col">n</th></tr></thead>
            <tbody>
              {[['agent', 'AI agents'], ['ai-crawler', 'AI crawlers'], ['crawler', 'Crawlers'], ['bot', 'Other bots']].map(([k, label]) => <tr key={k}><th scope="row">{label}</th><td>{R(a[k].flagged)}</td><td>{num(a[k].n)}</td></tr>)}
              <tr><th scope="row">Real browsers (wrongly flagged)</th><td>{a.human.flagged.k} of {a.human.n}</td><td>{num(a.human.n)}</td></tr>
            </tbody>
          </table>
          <p className="ev-note">The live shield alone catches {pct(a.agent.shieldAlone.p)} of agents. The log audit catches the rest.</p>
          <p className="ev-note">A user agent is a claim, not proof. A bot that says &ldquo;Chrome&rdquo; is invisible here. Agents that run inside a person&apos;s own Chrome look like that person at the HTTP level.</p>
        </article>
      </div>
    </section>

    <section className="ev-sec">
      <h2>What these numbers cannot tell you</h2>
      <div className="card ev-box">
        <ul>{data.limits.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="ev-note">We make no claim about real AI agents passing or failing these checks. That is not measured.</p>
      </div>
    </section>

    <section className="ev-sec">
      <h2>Data we are missing</h2>
      <p className="ev-sub">These datasets exist but were blocked or gated where we ran the tests.</p>
      <table className="ev-table ev-mini-t">
        <caption className="ev-cap">Blocked and gated datasets</caption>
        <thead><tr><th scope="col">Dataset</th><th scope="col">Status</th><th scope="col">What it would let us test</th></tr></thead>
        <tbody>{data.missing.map((d) => <tr key={d.name}><th scope="row" data-label="Dataset">{d.name}</th><td data-label="Status"><span className="chip warn">{d.status}</span></td><td data-label="Would test">{d.uses || DASH}</td></tr>)}</tbody>
      </table>
      <p className="ev-sub">Method and full limits: <a href={REPO + 'docs/VALIDATION-PLAN.md'}>docs/VALIDATION-PLAN.md</a>. Every dataset and its status: <a href={REPO + 'docs/DATASETS.md'}>docs/DATASETS.md</a>.</p>
    </section>

    <section className="ev-sec" id="abuseguard">
      <span className="kicker">Layer 3 &middot; optional</span>
      <h2>When a captcha fails, abuseguard limits the damage</h2>
      <p className="ev-sub">Layer 1 is the CaptchaMe check. <Link href="/layer2">Layer 2</Link> is the built-in analysis that names who really sent a request. <b>Layer 3 is abuseguard</b>, a separate service. It is the fair-share budget layer, and it is optional.</p>
      <div className="ev-grid">
        <article className="card ev-card"><h3>One person, one share</h3><p>A passed or beaten check still earns only one person&apos;s fair share. abuseguard counts dollars per <b>person</b>, across every account, key and session linked to them. It does not count per account.</p>
          <p className="ev-note"><b>The farm demo.</b> Several visitors share one browser and each spend under their own cap (in our docs, $0.40 each). A new visitor on that browser, with $0 spent, is limited with the reasons <code>DEVICE_CLUSTER, COST_OVER_BUDGET</code>. See <a href={REPO + 'docs/ABUSEGUARD.md'}>docs/ABUSEGUARD.md</a>. The <code>npm run demo:farm</code> script is not in this repo, so we cite the documented run.</p></article>
        <article className="card ev-card"><h3>Every block is explained</h3><p>A block carries named reasons, a retry time, recovery paths and a decision id.</p></article>
        <article className="card ev-card"><h3>A wrong block can be appealed</h3><p>An overturned appeal clears blocks and challenges for 30 days. CaptchaMe&apos;s own +$1 grant still applies.</p></article>
        <article className="card ev-card"><h3>Signed webhooks</h3><p>The events <code>subject.flagged</code>, <code>appeal.filed</code> and <code>appeal.resolved</code> land in the console feed. Forged or stale ones are refused.</p></article>
        <article className="card ev-card"><h3>It fails open</h3><p>If abuseguard is down, customers are still served. Each failure is counted. Reported test result: HTTP 200 in about 11 ms (from the test run we were given; not stored in this repo).</p></article>
        <article className="card ev-card"><h3>Shadow mode first</h3><p>It records and compares with the local ledger before it enforces anything. The comparison is at <code>GET /api/admin/abuseguard</code> (agree, abuseguardStricter, ledgerStricter). Roll out in steps: watch, then gentle, then strict. Go back to watch if more than 1% of paying users are limited, or if appeals wait over 24 hours.</p></article>
        <article className="card ev-card"><h3>Server side only</h3><p>Identifiers are hashed with a secret salt before they leave CaptchaMe.</p></article>
      </div>

      <table className="ev-table ev-mini-t">
        <caption className="ev-cap">If this captcha fails, then</caption>
        <thead><tr><th scope="col">If this fails</th><th scope="col">Then abuseguard</th></tr></thead>
        <tbody>
          <tr><th scope="row" data-label="If this fails">Typing: jitter, fitted or replayed passes</th><td data-label="Then">The per-person budget still caps what that identity can take.</td></tr>
          <tr><th scope="row" data-label="If this fails">A pointer bot passes</th><td data-label="Then">Same: the per-person budget caps it.</td></tr>
          <tr><th scope="row" data-label="If this fails">Many accounts from one browser</th><td data-label="Then">The cluster budget limits them (the farm demo).</td></tr>
          <tr><th scope="row" data-label="If this fails">A block was a mistake</th><td data-label="Then">The person appeals. Trust lasts 30 days.</td></tr>
          <tr><th scope="row" data-label="If this fails">The second service is down</th><td data-label="Then">It fails open. The failure is counted.</td></tr>
        </tbody>
      </table>

      <div className="card ev-box">
        <h3>What abuseguard does not do</h3>
        <ul>
          <li>It does not stop a bot from passing a check. That is the measured gap above.</li>
          <li>Linking quality bounds everything. It links only what we send: the network prefix and the <code>cm_vid</code> browser id.</li>
          <li>Live state is per process. Run <b>one</b> instance, not in serverless functions.</li>
          <li>Agent passes and other adapters are not built in abuseguard 0.4.0.</li>
          <li>Its Docker file and Postgres adapter were not run by us.</li>
          <li>Nothing has been measured on real customer traffic.</li>
        </ul>
      </div>
    </section>
  </>);
}
