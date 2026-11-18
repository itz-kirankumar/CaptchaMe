import Link from 'next/link';
import ScriptEngine from '../components/ScriptEngine';

const FORMATS = [
  ['/check?format=ring', 'Follow the ring', 'Track a moving ring that jumps twice.', 'lag 80-350 ms, re-acquire after each jump', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'],
  ['/check?format=clash', 'Colour clash', 'Pick the ink, not the word.', 'mismatches slow people down; readers pick the word', 'M4 6h16M4 12h10M4 18h16'],
  ['/check?format=targets', 'Targets', 'Click targets of every size and distance.', "Fitts' law, centre scatter, accelerate-then-brake", 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  ['/check?format=reflex', 'Catch the flash', 'Five flashes, sub-second windows.', 'scattered 200-450 ms; timers and agents miss', 'M13 2L4 14h7l-1 8 9-12h-7z'],
  ['/check?format=pulse', 'Follow + catch', 'Track and react at the same time.', 'dual-task: people wobble, step agents drop the ring', 'M3 12h4l3-8 4 16 3-8h4'],
  ['/check?format=beat', 'Tap the beat', 'Tap along with twelve pulses.', 'humans anticipate and scatter; scripts hit 0 ms', 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
  ['/voice', 'Voice path', 'Say four words back. No pointer, no timed visuals.', 'vocal onset timing; built for accessibility', 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3'],
  ['/agent', 'Agent lane', 'Honest agents sign a nonce and skip the puzzle.', 'Ed25519 key, own fair-share budget', 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4'],
];

export default function Home() {
  return (<>
    <section className="th-hero">
      <svg className="th-curves" id="thCurves" aria-hidden="true" preserveAspectRatio="xMidYMid slice"></svg>
      <p className="th-tag"><i></i>Post-verification for people, AI agents and bots</p>
      <h1 className="th-h1">Know who&apos;s visiting.<em>Cap what they take.</em></h1>
      <p className="th-lede">Solving a puzzle proves nothing now: bypass tools are sold openly. CaptchaMe checks that a live person is there, then a second layer keeps every packet, merges them into one identity per real client, names the bypass family, and decides what that identity may do next.</p>
      <form className="th-bar" id="runForm" autoComplete="off">
        <span className="th-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg></span>
        <select id="runBot" aria-label="Choose an attacker"><option>Loading attackers...</option></select>
        <button type="submit" className="btn">Run the attack</button>
      </form>
      <div className="th-sug" id="runSug" aria-live="polite">Loading attackers...</div>
      <p className="th-hint">Pick an attacker. Watch every layer read it, then see who layer 2 says it was.</p>
      <p className="th-fine">Runs against this server with built-in simulators. Nothing leaves your machine.</p>
      <p className="th-more"><Link className="btn ghost" href="/live">Open the live room</Link> <Link className="btn ghost" href="/layer2">See layer 2</Link></p>
    </section>

    <div className="th-modal" id="runModal" hidden role="dialog" aria-modal="true" aria-label="Attack run">
      <div className="th-sheet">
        <div className="th-steps" id="thSteps"></div>
        <div className="th-prog" id="thProg"></div>
        <div className="th-body"><aside className="th-list" id="thList" aria-label="Steps"></aside><section className="th-main" id="thMain" aria-live="polite"></section></div>
        <div className="th-foot"><span id="thStat">Starting...</span><span className="sp"></span><button className="btn ghost" id="thAgain" hidden>Run another</button><Link className="btn accent" href="/layer2">Open layer 2 analysis</Link></div>
      </div>
    </div>

    <div className="statband" id="statband">
      <div><b id="st-checks">-</b><span>live checks judged</span></div>
      <div><b id="st-humans">-</b><span>humans verified</span></div>
      <div><b id="st-bots">-</b><span>bots and relays caught</span></div>
      <div><b id="st-agents">-</b><span>agents declared</span></div>
      <div><b id="st-scrape">-</b><span>scraper requests stopped</span></div>
    </div>

    <section className="block">
      <span className="kicker">Why captchas fell</span>
      <h2 className="section">Every puzzle is now a paid API call</h2>
      <p className="section-sub">Solver services list around fifty captcha types, from reCAPTCHA and Turnstile to sliders, rotations and audio, at roughly $0.50 to $3 per thousand, in 1 to 40 seconds: AI first, human workers as backup.</p>
      <div className="breakers">
        <div className="breaker"><span className="x">SHIP THE CONTENT</span><b>Image, text, audio</b><span>The puzzle is uploaded to a model or a worker anywhere in the world, and the answer comes back in seconds.</span></div>
        <div className="breaker"><span className="x">SHIP THE TOKEN</span><b>Widget tokens</b><span>A worker solves the widget on their own machine and hands over the pass token. The bot pastes it in.</span></div>
        <div className="breaker"><span className="x">ONE-CLICK EXTENSIONS</span><b>Buster and friends</b><span>Speech-to-text beats the audio fallback for free. Paid extensions solve in the background.</span></div>
        <div className="breaker"><span className="x">AI AGENTS</span><b>See and click</b><span>Browser agents look at the puzzle and click, like a person. Proof-of-work just costs them a second.</span></div>
      </div>
      <p className="note"><Link href="/arena">Watch them beat the classic formats live in the arena, then try the same tools on CaptchaMe.</Link></p>
    </section>

    <section className="block">
      <span className="kicker">The answer</span>
      <h2 className="section">Nothing to ship, nothing to replay, nothing worth stealing</h2>
      <div className="grid g4">
        <div className="step"><p className="n">01 · LIVE</p><b>Nothing to ship</b><p>The challenge is a live interaction with sub-second windows. A relayed worker&apos;s delay shows up as lag, and a screenshot is useless.</p></div>
        <div className="step"><p className="n">02 · BOUND</p><b>Nothing to replay</b><p>Every challenge answers once in 90 seconds. Every pass is bound to the browser that earned it, so a relayed token is refused.</p></div>
        <div className="step"><p className="n">03 · SHAPE</p><b>Scored on how, not what</b><p>Reaction lag, corrections, Fitts&apos; law, interference, rhythm. A script fakes one signal; faking all of them live is expensive.</p></div>
        <div className="step"><p className="n">04 · CAPPED</p><b>Nothing worth stealing</b><p>Even a beaten check buys one person&apos;s fair share. The ledger caps every actor in dollars, with a plain reason and a human appeal.</p></div>
      </div>
    </section>

    <section className="block">
      <span className="kicker">The risk ladder</span>
      <h2 className="section">A check only when the evidence asks for one</h2>
      <p className="section-sub">Each rung costs the visitor more, so CaptchaMe climbs only as far as the signals demand.</p>
      <div className="rungs">
        <div className="rung on"><span className="rn">Rung 1 · most people</span><b>Invisible pass</b><p>Key-hold timing (never the keys), paste and autofill, the pointer&apos;s path, a real submit and the connection, read while the form is filled.</p></div>
        <div className="rung"><span className="rn">Rung 1b · mild doubt</span><b>One-second button check</b><p>Hold the submit button, let go when it turns green.</p></div>
        <div className="rung"><span className="rn">Rung 2 · agents</span><b>Signed agent lane</b><p>Web Bot Auth signatures, or a declared key that spends a person&apos;s share.</p></div>
        <div className="rung"><span className="rn">Rung 3 · strong signals</span><b>Live step-up check</b><p>The formats below, with jumps that arrive live so nothing can be pre-computed.</p></div>
      </div>
      <p className="note"><Link href="/check">Try the ladder on a protected form</Link></p>
    </section>

    <section className="block">
      <span className="kicker">Step-up checks</span>
      <h2 className="section">When a check is needed: eight ways through</h2>
      <p className="section-sub">Only for traffic whose signals contradict each other. Each line in grey is the signal the server checks.</p>
      <div className="formats">
        {FORMATS.map(([href, name, desc, sig, d]) => (
          <Link className="format" href={href} key={name}>
            <span className="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg></span>
            <b>{name}</b><p>{desc}</p><span className="sig">{sig}</span>
          </Link>
        ))}
      </div>
    </section>

    <section className="block">
      <span className="kicker">Beyond the door</span>
      <h2 className="section">One layer for every kind of visitor</h2>
      <div className="lanes">
        <Link className="lane" href="/check"><span className="chip human">person</span><b>Let people straight in</b><span className="d">A few seconds, no puzzles, scored on how a body moves. The voice path covers people who cannot use a pointer.</span></Link>
        <Link className="lane" href="/agent"><span className="chip agent">agent</span><b>Give honest agents a lane</b><span className="d">Agents sign a nonce with their key, skip the checks and get their own capped budget instead of a wall.</span></Link>
        <Link className="lane" href="/scraper"><span className="chip bot">scraper</span><b>Slow, decoy or block scrapers</b><span className="d">Account-free visitors are judged by how they request pages. Scrapers get delays, traceable decoy data or a block.</span></Link>
      </div>
    </section>

    <section className="block">
      <span className="kicker">For builders</span>
      <h2 className="section">Protect a form in three lines</h2>
      <div className="codeblock"><span className="c">{'<!-- your page: protect the form, most people never see a check -->'}</span>{'\n'}{'<script src='}<span className="g">&quot;https://captchame.vercel.app/widget.js&quot;</span>{' data-form='}<span className="g">&quot;#signup&quot;</span>{'></script>'}{'\n\n'}<span className="c"># your server: check the pass against this browser and this exact form</span>{'\n'}POST <span className="b">/api/pass/verify</span>{'  { pass, form_hash, remoteip, user_agent }  '}<span className="c">{'# -> { ok, subject, form_checked }'}</span></div>
      <p className="note"><Link href="/integrations">Every integration, endpoint and SDK snippet</Link></p>
    </section>

    <Link className="cta-big" href="/arena">
      <span><b>Bots, go ahead. Try.</b><small>Point Buster, 2Captcha, CapSolver or a browser agent at the classic formats, then at CaptchaMe.</small></span>
      <span className="go">Open the arena</span>
    </Link>
    <ScriptEngine srcs={['/engines/home.js', '/engines/home-run.js']} />
  </>);
}
