import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Arena: classic captchas vs CaptchaMe' };

// From 2captcha.com's public price list, as captured on 18 Nov 2026.
const SOLVER = [
  ['reCAPTCHA v2', '$1 - $2.99', '2 s', 'vendor', 'Real widget, left column', 'Image grid: a vision model or a worker clicks the tiles; the token is handed over'],
  ['reCAPTCHA v3 / Enterprise', '$1 - $2.99', '1 s', 'vendor', '-', 'Invisible score: a solver farms good scores in clean browsers and relays the token'],
  ['Cloudflare Turnstile', '$1.45', '1 s', 'vendor', 'Real widget, left column', 'Browser signals replayed in a real browser; the token is relayed'],
  ['hCaptcha-style image tasks', '$0.50 - $1', '2 s', 'grid', 'Image grid', 'Vision models label images faster than people'],
  ['Normal / text captcha', '$0.50 - $1', '1 s', 'text', 'Distorted text', 'OCR and LLMs read warped text'],
  ['Math captcha', '$0.50 - $1', '3 s', 'math', 'Math', 'Arithmetic is trivial for any model'],
  ['Slider captcha', '$1.20', '9 s', 'slider', 'Slider', 'The gap is visible in the image; a script drags to it'],
  ['Rotate captcha', '$0.50', '6 s', 'rotate', 'Rotate', 'Orientation is a classic vision task'],
  ['Click captcha', '$1.20', '13 s', 'click', 'Click in order', 'Object detection returns the coordinates'],
  ['Audio captcha', '$0.50', '14 s', '-', 'Voice path (reversed)', 'Speech-to-text transcribes the clip (the Buster approach)'],
  ['ALTCHA / Friendly Captcha', '$1.45 - $2.99', '10 - 15 s', 'pow', 'Proof of work', 'Proof of work proves compute, and machines have compute'],
  ['GeeTest', '$2.99', '3 s', 'slider', 'Slider', 'Slide and click tasks solved by models and workers'],
  ['Arkose Labs (FunCaptcha)', '$1.45 - $50', '18 s', '-', '-', 'Harder puzzle games, still farmed to human workers'],
  ['DataDome / Amazon WAF / Imperva', '$1.45 - $2.99', '2 - 14 s', '-', '-', 'Solved inside a real browser through the attacker’s own proxy'],
  ['KeyCAPTCHA / Capy / Lemin', '$1.45 - $2.99', '7 - 40 s', '-', '-', 'Drag-and-drop puzzles, worker-solved'],
];

export default function Page() {
  return (<>
    <PageHead kicker="Arena" title="Point your bypass tools here">
      Left: the classic formats that solver farms sell, plus the real vendor widgets. Right: CaptchaMe. Set who is attacking, then throw Buster, 2Captcha, CapSolver, NopeCHA, browser agents or plain scripts at both sides. Every attempt lands on the scoreboard below.
    </PageHead>

    <div className="attackerbar" id="attackerbar">
      <span className="lbl">Attacking as</span>
      <div className="pills" id="pills"></div>
      <input id="attackerInput" placeholder="custom label" aria-label="Custom attacker label" maxLength={40} />
      <button className="sm ghost" id="attackerSet">Set</button>
      <span className="spacer"></span>
      <span className="note" style={{ margin: 0 }}>now: <b id="attackerNow" className="mono">unlabelled</b></span>
    </div>

    <div className="arena">
      <div className="arena-col">
        <h2><span className="chip bot">classic</span> What solver farms sell</h2>
        <p>Generic versions of the familiar formats, judged by this server. They are not the vendors&apos; products; the real widgets are below them.</p>
        <div id="classicList"></div>

        <div className="cap" id="vendorCard">
          <div className="cap-head"><b>Real vendor widgets</b><span className="spacer"></span><button className="sm ghost" id="loadVendors">Load Turnstile, hCaptcha, reCAPTCHA</button></div>
          <p className="note" style={{ marginTop: 0 }}>Loaded only when you press the button, and only with this server&apos;s own keys: <code>TURNSTILE_SITE_KEY</code>, <code>HCAPTCHA_SITE_KEY</code>, <code>RECAPTCHA_SITE_KEY</code> and their secrets. A vendor without keys shows as not configured; there is no always-pass test mode.</p>
          <div id="vendorList"></div>
        </div>
      </div>

      <div className="arena-col">
        <h2><span className="chip human">captchame</span> What we ask instead</h2>
        <p>The same widget a protected site embeds. Try &quot;Surprise me&quot; so the server picks the format. Each verdict is credited to the current attacker label.</p>
        <iframe className="frame-embed" id="cmFrame" src="/check?embed=1" title="CaptchaMe human check" allow="microphone"></iframe>
        <p className="note">Also try the <Link href="/voice">voice path</Link>, the <Link href="/agent">agent lane</Link> and the <Link href="/scraper">scraper shield</Link>. Those land on the scoreboard too.</p>
      </div>
    </div>

    <section className="block" style={{ marginTop: 56 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <div><span className="kicker">Scoreboard</span><h2 className="section" style={{ marginBottom: 0 }}>Who got through what</h2></div>
        <span className="spacer"></span>
        <button className="sm danger" id="resetScores">Reset scoreboard (admin)</button>
      </div>
      <div className="card"><div className="tablewrap"><table className="matrix" id="matrix"><tbody><tr><td className="empty">No attempts yet. Pick an attacker and start.</td></tr></tbody></table></div>
        <div className="legend"><span><i style={{ background: 'var(--bot)' }}></i>a bot got through</span><span><i style={{ background: 'var(--human)' }}></i>blocked (or a human passed)</span><span><i style={{ background: 'var(--warn)' }}></i>mixed</span></div>
      </div>
    </section>

    <section className="block" style={{ marginTop: 56 }}>
      <span className="kicker">The going rate</span>
      <h2 className="section">What a solver farm charges per thousand</h2>
      <p className="section-sub">From 2captcha&apos;s public price list as captured on 18 Nov 2026. AI solves first; human workers take what the AI cannot. CaptchaMe is not on the list for a reason: a live interaction has nothing to upload, and a pass bound to one browser is worth nothing to another.</p>
      <div className="card"><div className="tablewrap"><table>
        <thead><tr><th>Format</th><th>Price / 1,000</th><th>Solve time</th><th>Arena</th><th>How it is beaten</th></tr></thead>
        <tbody>
          {SOLVER.map(([f, p, s, , arena, how]) => <tr key={f}><td><strong>{f}</strong></td><td className="mono">{p}</td><td className="mono">{s}</td><td>{arena}</td><td className="dim">{how}</td></tr>)}
          <tr><td><strong style={{ color: 'var(--human-text)' }}>CaptchaMe</strong></td><td className="mono">not offered</td><td className="mono">-</td><td>Right column</td><td>Live, sub-second, scored on the shape of the response; pass bound to the browser; ledger caps every actor</td></tr>
        </tbody>
      </table></div></div>
    </section>
    <ScriptEngine srcs={['/engines/admin.js', '/engines/arena.js']} />
  </>);
}
