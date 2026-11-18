import Nav from '../../components/Nav';
import ScriptEngine from '../../components/ScriptEngine';
export const metadata = { title: 'Live run: bot vs human' };

export default function Page() {
  return (<>
    <Nav links={[['/check', 'Try it yourself'], ['/how', 'How it works'], ['/dashboard', 'Dashboard']]} />

    <h1 className="page">Bot vs human, judged live</h1>
    <p className="sub">Two cursors follow the same kind of moving ring at the same time. On the left, a script that read the published path and tracks it perfectly. On the right, a hand with reaction lag, wander and constant small corrections. Both cursors are simulated here so you can watch; the judging is the real CaptchaMe server, live. Then <a href="/check">try the human side yourself</a>.</p>

    <p style={{ margin: '0 0 18px' }}><button id="go">Run it live</button> <span className="note" id="status"></span></p>

    <div className="livegrid">
      <div className="livecard">
        <h3><span className="chip bot">script bot</span> Perfect path replay</h3>
        <canvas id="botcv" width="400" height="260"></canvas>
        <div id="botout"></div>
      </div>
      <div className="livecard">
        <h3><span className="chip human">human</span> Messy, lagging, alive</h3>
        <canvas id="humcv" width="400" height="260"></canvas>
        <div id="humout"></div>
      </div>
    </div>

    <p className="note">Every verdict lands on the <a href="/dashboard">live dashboard</a>. Open it on a second screen during a demo and watch attacks get stamped in real time.</p>
    <ScriptEngine srcs={['/engines/verdict.js', '/engines/live.js']} />
  </>);
}
