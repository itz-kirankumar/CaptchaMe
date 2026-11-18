import Link from 'next/link';
import ScriptEngine from '../components/ScriptEngine';

export default function Home() {
  return (<>
    <section className="th-hero">
      <svg className="th-curves" id="thCurves" aria-hidden="true" preserveAspectRatio="xMidYMid slice"></svg>
      <p className="th-tag"><i></i>Live demo &middot; every number comes from the running backend</p>
      <h1 className="th-h1">Know who&apos;s visiting.<em>Cap what they take.</em></h1>
      <p className="th-lede">Bypass tools are sold openly, so a solved puzzle proves nothing. CaptchaMe checks that a live person is there. A second layer merges every request into one identity, names the bypass family, and shows in raw text exactly where it was stopped.</p>
      <p className="th-more">
        <a className="btn" href="#livestack">Start the live demo</a> <a className="btn ghost" href="#stopped">See where attacks stop</a>
      </p>
    </section>

    <section className="block demo-sec" id="livestack">
      <span className="kicker">1 &middot; Live stack</span>
      <h2 className="section">Pick who is knocking. Press Start.</h2>
      <p className="section-sub">This page makes the real API calls your product would make and streams what each layer decides. Try it as a person: follow the ring when it appears.</p>
      <div className="lv" id="lvapp"></div>
    </section>

    <section className="block demo-sec" id="stopped">
      <span className="kicker">2 &middot; Post-analysis</span>
      <h2 className="section">Where attacks get stopped</h2>
      <p className="section-sub">Send a bypass tool at the stack. Layer 1 reads it layer by layer; layer 2 then merges the packets into one identity, names the bypass family and decides. Every line is raw output from the server.</p>
      <form className="th-bar" id="runForm" autoComplete="off">
        <span className="th-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg></span>
        <select id="runBot" aria-label="Choose an attacker"><option>Loading attackers...</option></select>
        <button type="submit" className="btn">Start attack</button>
      </form>
      <div className="th-sug" id="runSug" aria-live="polite">Loading attackers...</div>
      <p className="th-more"><Link className="btn ghost" href="/layer2">Open the full layer 2 analysis</Link> <Link className="btn ghost" href="/try">Try the captchas by hand</Link></p>
    </section>

    <div className="rn-modal" id="runModal" hidden role="dialog" aria-modal="true" aria-label="Attack run">
      <div className="rn-sheet">
        <canvas className="rn-rain" id="rnRain" aria-hidden="true"></canvas>
        <header className="rn-head">
          <span className="rn-logo"><svg width="22" height="22" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="3" /><path d="M12.24 5.66A11 11 0 0 1 23.78 8.22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="23.78" cy="8.22" r="3.4" fill="currentColor" /></svg></span>
          <div><b id="rnTitle">Attack run</b><small>every line is read live from the server</small></div>
          <button className="rn-x" id="rnClose" aria-label="Close">&times;</button>
        </header>
        <div className="rn-rail" id="rnRail"></div>
        <div className="rn-step" id="rnStep"></div>
        <div className="rn-term" id="rnTerm" aria-live="polite"></div>
        <div className="rn-verdict" id="rnVerdict"></div>
      </div>
    </div>
    <ScriptEngine srcs={['/engines/layers.js', '/engines/home-run.js']} />
  </>);
}
