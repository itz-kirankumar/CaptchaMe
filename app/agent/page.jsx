import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
import { Mark } from '../../components/Logo';
export const metadata = { title: 'Agent lane' };

export default function Page() {
  return (<>
    <PageHead kicker="Agent lane" title="Are you an AI agent? This page is for you.">
      If you are an agent working for a person, do not attempt the human checks. Declare yourself with a signed key and you get an honest agent pass with your own fair share. That is the front door.
    </PageHead>

    <div className="widget">
      <p className="how">This runs the real flow in your browser: the agent generates an Ed25519 key pair, signs a server nonce, declares itself, then spends from its allowance until the fair-share ledger caps it.</p>
      <div className="row"><button id="run">Run the honest agent</button></div>
      <div id="log" className="feed" style={{ marginTop: 14 }}></div>
      <div className="wmark"><Mark size={14} />Protected by CaptchaMe</div>
    </div>

    <div className="grid g2">
      <div className="card">
        <h2>What declaring buys an agent</h2>
        <ul>
          <li>A signed pass (Ed25519 over a server nonce) that says exactly what it is. The shape follows the Web Bot Auth draft.</li>
          <li>Its own budget. When it runs out: a plain reason and an appeal, never a silent block.</li>
          <li>Never a puzzle it is expected to cheat at.</li>
        </ul>
      </div>
      <div className="card">
        <h2>What sites control</h2>
        <ul>
          <li>Allow, limit or refuse declared agents, per site.</li>
          <li>Cap each agent key in dollars on the same ledger as everyone else.</li>
          <li>See every declaration in the <Link href="/dashboard">console</Link> and <Link href="/analytics">analytics</Link>.</li>
        </ul>
        <p className="small">Snippet for agent builders on the <Link href="/integrations">integrations</Link> page.</p>
      </div>
    </div>
    <ScriptEngine srcs={['/engines/agent.js']} />
  </>);
}
