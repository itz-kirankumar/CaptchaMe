import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Live run: bot vs human' };

export default function Page() {
  return (<>
    <PageHead kicker="Live run" title="Bot vs human, judged live">
      Pick a format and an attacker. Both sides play out on screen in real time; the movement is simulated so you can watch it, and the verdicts come from the real CaptchaMe server over the same API every visitor uses.
    </PageHead>

    <div className="controls">
      <select id="fmt" aria-label="Format">
        <option value="ring">Follow the ring</option>
        <option value="targets">Targets (Fitts&apos; law)</option>
        <option value="clash">Colour clash</option>
        <option value="reflex">Catch the flash</option>
      </select>
      <select id="atk" aria-label="Attacker"></select>
      <button id="go">Run it live</button>
      <span className="note" id="status" style={{ margin: 0 }}></span>
    </div>

    <div className="livegrid">
      <div className="livecard">
        <h3><span className="chip bot">attacker</span> <span id="atkName">Script</span></h3>
        <canvas id="botcv" width="560" height="340"></canvas>
        <div id="botout"></div>
      </div>
      <div className="livecard">
        <h3><span className="chip human">human</span> Messy, lagging, alive</h3>
        <canvas id="humcv" width="560" height="340"></canvas>
        <div id="humout"></div>
      </div>
    </div>
    <p className="note">Every verdict lands in <Link href="/analytics">analytics</Link>. Then <Link href="/check">try the human side yourself</Link>, or point a real tool at the <Link href="/arena">arena</Link>.</p>
    <ScriptEngine srcs={['/engines/verdict.js', '/engines/actors.js', '/engines/live.js']} />
  </>);
}
