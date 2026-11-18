import Nav from '../../components/Nav';
import ScriptEngine from '../../components/ScriptEngine';
export const metadata = { title: 'Voice presence' };

export default function Page() {
  return (<>
    <Nav links={[['/check', 'Pointer checks'], ['/live', 'Live run'], ['/dashboard', 'Dashboard']]} />

    <h1 className="page">The voice path</h1>
    <p className="sub">The accessible way through the door: no pointer, no timed visual test. Four words appear and are spoken, one at a time. Say each word back when you hear it. We check that a live voice answers, and what it says.</p>

    <div className="widget">
      <div className="word" id="wordBox">Press start when ready</div>
      <div className="meter"><i id="prog" style={{ width: '0%' }}></i></div>
      <p><button id="start">Start voice check</button>{' '}
      <button className="ghost" id="perm">Allow microphone</button></p>
      <p className="note" id="status">Needs a microphone. Words are matched on our server by Sarvam&apos;s speech recognition; your browser&apos;s own recognition is the automatic fallback. Timing is measured from your mic either way.</p>
      <div id="out"></div>
      <div className="wmark"><img src="/logo.svg" width="15" height="15" alt="" />Protected by CaptchaMe</div>
    </div>

    <p className="note">Honest note: a voice check raises the cost for AI voice agents. It does not by itself prove a human, so it always sits beside the fair-share cap. <a href="/">Back</a></p>
    <ScriptEngine srcs={['/engines/verdict.js', '/engines/voice.js']} />
  </>);
}
