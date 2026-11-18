import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Live dry run' };

export default function Page() {
  return (<>
    <PageHead kicker="Dry run" title="Rehearse the whole demo in one click">
      Eighteen scripted scenarios against this live server: synthetic humans that should pass and every class of attacker that should not, from path-reading scripts to relayed tokens and scrapers. Run it before you go on stage; every result also lands in analytics and on the arena scoreboard as &quot;dry run&quot;.
    </PageHead>

    <div className="grid dry">
      <div>
        <div className="row">
          <button id="runAll">Run the dry run</button>
          <button className="ghost" id="resetData">Reset demo data</button>
          <span className="spacer"></span>
          <span className="mono small dim" id="summary">not run yet</span>
        </div>
        <div className="progress"><i id="prog"></i></div>
        <div className="runlist" id="runlist"></div>
      </div>
      <div>
        <div className="card">
          <h2>Stage checklist</h2>
          <ul className="checklist">
            <li>Run this dry run once on the stage network. Every row green.</li>
            <li>Press Reset demo data so the counters start at zero.</li>
            <li>Open <Link href="/analytics">Analytics</Link> on the projector or a second screen.</li>
            <li>Open the <Link href="/arena">Arena</Link>. Set the attacker label before each tool.</li>
            <li>Classic side first: Buster, 2Captcha or CapSolver, then a browser agent. Let the audience watch them pass.</li>
            <li>Same tools on the CaptchaMe side, in Surprise me mode.</li>
            <li>Scraper shield: run <code>npm run demo:scrape</code> live.</li>
            <li>Close on the agent lane and the ledger: honest agents get in, nobody takes more than a fair share.</li>
          </ul>
        </div>
        <div className="card">
          <h2>What this does not prove</h2>
          <p>The humans here are simulated, and so are the attackers. The dry run proves the server, the scoring and the plumbing are working. The real proof is the live part: real people, real tools.</p>
        </div>
      </div>
    </div>
    <ScriptEngine srcs={['/engines/actors.js', '/engines/dryrun.js']} />
  </>);
}
