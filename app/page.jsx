import Nav from '../components/Nav';

export default function Home() {
  return (<>
    <Nav links={[['/live', 'Live run'], ['/how', 'How it works'], ['/compare', 'Why captchas fail'], ['/dashboard', 'Dashboard'], ['https://github.com/itz-kirankumar/CaptchaMe', 'GitHub']]} />

    <div className="hero">
      <span className="badge"><span className="dot"></span>Live demo, judged by a real server</span>
      <h1>Bots, go ahead. <span className="try">Try.</span></h1>
      <p className="lede">CaptchaMe checks that a live human is present: how they move, react and speak. Scripts and AI agents fail. Honest agents declare themselves and get a signed lane of their own.</p>
      <div className="cta-row">
        <a className="btn" href="/check">Prove you are human</a>
        <a className="btn ghost" href="/live">Watch bot vs human</a>
      </div>
    </div>

    <div className="lanes">
      <a className="lane" href="/check">
        <div className="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2ee6a8" strokeWidth="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="#2ee6a8"/></svg></div>
        <b>I am a person</b>
        <span>Follow a moving ring, tap a beat, catch a flash. Seconds long. Scored on how you move, not how fast.</span>
      </a>
      <a className="lane" href="/voice">
        <div className="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2ee6a8" strokeWidth="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></div>
        <b>I am a person, voice path</b>
        <span>No pointer, no timed visuals. Speak four words back at your own pace. Built for accessibility first.</span>
      </a>
      <a className="lane" href="/agent">
        <div className="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2ee6a8" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>
        <b>I am an AI agent</b>
        <span>Declare yourself with a signed key. No puzzle, no disguise. Your own fair budget instead of a wall.</span>
      </a>
    </div>

    <section className="block">
      <p className="kicker">How it works</p>
      <h2 className="section">Not a puzzle. A presence check.</h2>
      <p className="section-sub">Puzzles get solved and sold. CaptchaMe watches for the signals only a body produces, then limits the blast radius with a fair-share ledger.</p>
      <div className="steps">
        <div className="step"><p className="n">01</p><b>A fresh challenge every time</b><p>Randomized per session, answered once, gone in 90 seconds. Nothing to replay, record or pre-train on.</p></div>
        <div className="step"><p className="n">02</p><b>Scored on the shape of you</b><p>Reaction lag, correction patterns, rhythm drift, vocal onset. A script can fake any one signal. It cannot fake all of them, live, for cheap.</p></div>
        <div className="step"><p className="n">03</p><b>A verdict with reasons</b><p>HUMAN or BOT, with the evidence shown. Then a dollar cap per actor, so even a beaten check never becomes a free pass.</p></div>
      </div>
    </section>

    <section className="block">
      <p className="kicker">For builders</p>
      <h2 className="section">Three lines to protect a form</h2>
      <p className="section-sub">Drop the widget where your captcha sits today. Verify the pass token on your server before you accept the action.</p>
      <div className="codeblock"><span className="c">{'<!-- on your page -->'}</span>{'\n'}
{'<script src='}<span className="g">"https://captchame.vercel.app/widget.js"</span>{'></script>'}{'\n'}
{'<div data-captchame='}<span className="g">"your-site-key"</span>{'></div>'}{'\n\n'}
<span className="c"># on your server</span>{'\n'}
POST <span className="b">/api/pass/verify</span>{'  { pass_token } '}<span className="c">{'# -> { ok: true, actor }'}</span></div>
      <p className="note">The hosted demo API is live today: <code>POST /api/challenge/start</code> then <code>POST /api/challenge/submit</code>, verified with <code>POST /api/pass/verify</code>. The one-tag widget is live on the <a href="/demo.html">demo storefront</a>.</p>
    </section>

    <section className="block">
      <div className="stats">
        <div className="stat"><p className="v">12</p><p className="l">attack classes stopped live: scripts, agents, replays, playback, scrapers</p></div>
        <div className="stat"><p className="v">~7s</p><p className="l">for a human to pass. Near-zero friction, no puzzles</p></div>
        <div className="stat"><p className="v">45</p><p className="l">automated end-to-end checks on every deploy</p></div>
        <div className="stat"><p className="v">$0.50</p><p className="l">default fair-share cap per actor, with a human appeal</p></div>
      </div>
    </section>

    <a className="cta-big" href="/live">Watch a bot try and fail, live
      <small>Two cursors, one judge: the real CaptchaMe server. Thirty seconds, no setup.</small>
    </a>

    <div className="footer">
      <span>CaptchaMe · built at Road to YC, Nov 2026</span>
      <span className="spacer"></span>
      <a href="/how">What happens after the door</a>
      <a href="/compare">Why existing captchas fail</a>
      <a href="/appeal">Appeal a cap</a>
      <a href="https://github.com/itz-kirankumar/CaptchaMe">GitHub</a>
    </div>
  </>);
}
