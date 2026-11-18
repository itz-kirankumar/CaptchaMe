import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Layer 2: post-verification analysis' };

// What the public 2captcha libraries and demos do, and what layer 2 sees when it happens.
// Source: github.com/2captcha (python, javascript, custom-slider-demo, cloudflare-demo, mcp servers), read 2026-11-18.
const PLAYBOOK = [
  ['Image, grid, rotate, canvas, coordinates', 'The picture is uploaded; a worker or vision model answers. The bot only types or clicks the result.', 'Answers arrive at the price-list speed for several different formats; every puzzle is right; no pointer history', 'MARKET_SOLVE_PACE, INSTANT_SOLVES, UNIFORM_AI_PACE', 'L5'],
  ['Token relay (reCAPTCHA, Turnstile, hCaptcha, GeeTest...)', 'The caller sends its user agent, cookies and proxy to a worker. The worker solves on their machine and returns a token.', 'A pass earned in one browser is presented from another; the challenge starts with one network signature and is answered with another; the answer is late', 'TOKEN_RELAY, SIGNATURE_SWITCH, NETWORK_SWITCH, LATE_ANSWER', 'L6'],
  ['Slider demo (Puppeteer)', 'Worker returns one coordinate; the script drags in 50-100 equal steps at a fixed delay, starting at the exact centre of the knob.', 'Samples on a perfect clock, zero reaction lag, no corrections, instant answers', 'SYNTHETIC_CLOCK, SCRIPTED_RESPONSE, COMPUTED_NOT_PERFORMED', 'L4/L5'],
  ['Retry loop with good and bad reports', 'Try, check for navigation, report right or wrong, try again with a fresh puzzle.', 'Many challenge starts per minute from one identity, however the address changes', 'ATTEMPT_VELOCITY', 'L7'],
  ['Selenium / Puppeteer / MCP-driven browser', 'An agent calls browser tools; a driver clicks and types.', 'Automation flag, headless window, default screen, client hints missing or contradicting the user agent', 'WEBDRIVER_FLAG, HEADLESS_WINDOW, UA_NO_CLIENT_HINTS, UA_HINT_VERSION_MISMATCH', 'L1/L3'],
  ['Screenshot-think-act LLM agent', 'Looks at the page, thinks for seconds, acts.', 'Seconds to re-aim after the ring jumps; few corrections; steady 2-9 s pace across every format', 'SLOW_REAIM, NO_HAND_CORRECTIONS, UNIFORM_AI_PACE', 'L4/L5'],
  ['Rotating residential proxies', 'A new address (and often a new browser name) on every request.', 'One client stack under many labels; the same catalogue walk continued from a new address', 'IP_ROTATION, ONE_STACK_MANY_USER_AGENTS, one merged identity', 'L1'],
  ['Generated human-shaped path', 'Synthetic lag, wander and jitter, submitted early.', 'The samples cover more time than the server clock allowed', 'CLOCK_SKEW', 'L5'],
];

export default function Page() {
  return (<>
    <PageHead kicker="Layer 2" title="Post-verification: who really was that?">
      Layer 1 decides one challenge. Layer 2 takes every packet layer 1 produces, plus every later request that uses the pass. It merges them into one identity per real client across IP, handshake and browser fingerprint, says which bypass family it belongs to, which layer flagged it, and what it cost you. Run attacks from the <Link href="/live">live room</Link> and watch this page fill.
    </PageHead>

    <div className="statgrid" id="l2sum">
      <div className="stat"><div className="n" id="k-mode">-</div><div className="l">protected API gate</div></div>
      <div className="stat"><div className="n" id="k-packets">-</div><div className="l">packets from layer 1</div></div>
      <div className="stat"><div className="n" id="k-ids">-</div><div className="l">identities (after merging)</div></div>
      <div className="stat"><div className="n" id="k-merges">-</div><div className="l">identities merged into others</div></div>
      <div className="stat"><div className="n" id="k-bots">-</div><div className="l">cost caused by bots</div></div>
      <div className="stat"><div className="n" id="k-spend">-</div><div className="l">attacker spend at market rate</div></div>
    </div>

    <div className="row" style={{ marginBottom: 14 }}>
      <span className="note" style={{ margin: 0 }}>Updates every 1.5 s. Identities and keys are hashed; addresses are masked to the network.</span>
      <span className="spacer"></span>
      <button className="sm danger" id="l2reset">Clear layer 2</button>
    </div>

    <div className="card">
      <h2>Identities</h2>
      <p className="note small" style={{ marginTop: 0 }}>One row per real client. Click a row to see its evidence, every network and browser name it used, and why it was merged.</p>
      <div className="tablewrap"><table><thead><tr><th>Identity</th><th>Class</th><th>Decision</th><th>Seen as</th><th>Layer 1</th><th>Scraped</th><th>Cost</th><th>Top evidence</th></tr></thead><tbody id="l2ids"><tr><td colSpan="8" className="empty">Waiting for packets. Open the live room and press an attacker.</td></tr></tbody></table></div>
    </div>
    <div className="card" id="l2detail" hidden></div>

    <div className="grid g2">
      <div className="card">
        <h2>Where it was caught</h2>
        <p className="note small" style={{ marginTop: 0 }}>Evidence count by layer and bypass family. Cold cells are cheap for an attacker today; hot cells are where the walls hold.</p>
        <div className="tablewrap"><table className="l2heat"><thead><tr id="l2mh"></tr></thead><tbody id="l2m"></tbody></table></div>
      </div>
      <div className="card">
        <h2>Who is using your resources</h2>
        <div className="bars" id="l2cls"></div>
        <p className="note small">Cost uses unit prices you should replace with your own (a challenge start, a catalogue page, a protected call). Defaults are in <code>lib/layer2.js</code>.</p>
      </div>
    </div>

    <div className="grid g2">
      <div className="card">
        <h2>What is being scraped</h2>
        <div className="statgrid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="stat"><div className="n" id="k-pages">-</div><div className="l">catalogue pages touched</div></div>
          <div className="stat"><div className="n" id="k-hits">-</div><div className="l">catalogue requests</div></div>
          <div className="stat"><div className="n" id="k-decoy">-</div><div className="l">decoys served</div></div>
          <div className="stat"><div className="n" id="k-canary">-</div><div className="l">canaries tied to a visitor</div></div>
        </div>
        <div className="tablewrap"><table><thead><tr><th>Class</th><th>Identities</th><th>Requests</th><th>Pages</th></tr></thead><tbody id="l2scr"><tr><td colSpan="4" className="empty">No scraping seen yet.</td></tr></tbody></table></div>
      </div>
      <div className="card">
        <h2>Bypass services and what they got through</h2>
        <div className="statgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat"><div className="n" id="k-rival">-</div><div className="l">other captchas beaten</div></div>
          <div className="stat"><div className="n" id="k-l1b">-</div><div className="l">layer 1 blocks</div></div>
          <div className="stat"><div className="n" id="k-l1p">-</div><div className="l">layer 1 passes</div></div>
        </div>
        <div className="bars" id="l2riv"></div>
        <h3 style={{ marginTop: 16 }}>Identities that were merged</h3>
        <div className="feed" id="l2merged"><div className="empty">None yet.</div></div>
      </div>
    </div>

    <div className="card">
      <h2>The bypass playbook layer 2 is built against</h2>
      <p className="note small" style={{ marginTop: 0 }}>From reading the public 2captcha libraries and demos. It describes what the tools do and the traces they leave. It is not a how-to; the evidence codes are what you will see in the table above.</p>
      <div className="tablewrap"><table><thead><tr><th>Technique</th><th>What it does</th><th>What layer 2 sees</th><th>Evidence codes</th><th>Layer</th></tr></thead><tbody>
        {PLAYBOOK.map(([a, b, c, d, e]) => <tr key={a}><td><strong>{a}</strong></td><td className="dim">{b}</td><td>{c}</td><td className="mono small">{d}</td><td className="mono">{e}</td></tr>)}
      </tbody></table></div>
    </div>
    <ScriptEngine srcs={['/engines/admin.js', '/engines/layer2.js']} />
  </>);
}
