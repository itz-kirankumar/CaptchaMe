import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
import { Mark } from '../../components/Logo';
export const metadata = { title: 'Voice path' };

export default function Page() {
  return (<>
    <PageHead kicker="Voice path" title="The accessible way through the door">
      No pointer, no timed visual test. Four words appear and are spoken, one at a time. Say each word back when you hear it. The server checks that a live voice answers, when it answers, and what it says.
    </PageHead>

    <div className="widget">
      <div className="word" id="wordBox">Press start when ready</div>
      <div className="meter"><i id="prog" style={{ width: '0%' }}></i></div>
      <div className="row"><button id="start">Start voice check</button><button className="ghost" id="perm">Allow microphone</button></div>
      <p className="note" id="status">Needs a microphone. Words are matched on the server by Sarvam&apos;s speech recognition, with your browser&apos;s own recognition as the fallback. Timing is measured from your microphone either way.</p>
      <div id="out" aria-live="polite"></div>
      <div className="wmark"><Mark size={14} />Protected by CaptchaMe</div>
    </div>

    <div className="card">
      <h2>Why this is not an audio captcha</h2>
      <p>Classic audio captchas play a clip and ask you to type it, which is exactly what speech-to-text extensions like Buster solve for free. Here nothing is transcribed for you: you speak, live, and the server scores when each word starts relative to its prompt and how that timing varies. A playback script answers at one uniform delay.</p>
      <p>Honest limit: a good text-to-speech pipeline with human-like jitter can pass this path. It is worth less on the ledger than a pointer pass, and it always sits behind the fair-share cap. <Link href="/check">Pointer formats</Link></p>
    </div>
    <ScriptEngine srcs={['/engines/verdict.js', '/engines/voice.js']} />
  </>);
}
