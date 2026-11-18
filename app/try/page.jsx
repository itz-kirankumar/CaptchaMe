import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Try every captcha' };

export default function Page() {
  return (<>
    <PageHead kicker="Try it" title="Every captcha, one page">
      Try the classic formats by hand on the left, and CaptchaMe on the right. Each captcha has a <b>Refresh</b> button for a fresh puzzle; <b>Refresh all</b> reloads everything, CaptchaMe included. Your tries land on the <Link href="/arena">scoreboard</Link> as a person.
    </PageHead>
    <div className="try-top">
      <div className="try-score" aria-live="polite"><div className="try-meter"><i id="tryBar"></i></div><span><b id="tryN">0</b> of 8 classic captchas solved</span><span className="dim" id="tryCmS">CaptchaMe: not tried yet</span></div>
      <span className="sp"></span>
      <button className="btn" id="tryAll">Refresh all captchas</button>
    </div>
    <div className="try-grid">
      <section className="try-col" aria-label="Classic captchas">
        <div className="try-head"><span className="chip bot">classic</span><h2>What solver farms sell</h2></div>
        <p className="try-sub">Eight familiar formats. Each is judged by this server.</p>
        <div className="lr-rivals" id="tryGrid"></div>
      </section>
      <section className="try-col cm" aria-label="CaptchaMe">
        <div className="try-head"><span className="chip human">captchame</span><h2>What we ask instead</h2><span className="sp"></span><button className="sm ghost" id="tryCmNew" aria-label="Refresh CaptchaMe">&#8635; Refresh</button></div>
        <p className="try-sub">A live check: follow, tap or speak. &ldquo;Surprise me&rdquo; lets the server pick.</p>
        <iframe className="try-frame" id="tryCm" src="/check?embed=1" title="CaptchaMe human check" allow="microphone"></iframe>
        <div className="try-pass" id="tryPass" aria-live="polite"></div>
      </section>
    </div>
    <ScriptEngine srcs={['/engines/try.js']} />
  </>);
}
