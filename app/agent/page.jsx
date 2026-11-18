import Nav from '../../components/Nav';
import ScriptEngine from '../../components/ScriptEngine';
export const metadata = { title: 'Agents: declare yourself' };

export default function Page() {
  return (<>
    <Nav links={[['/how', 'How it works'], ['/use', 'Use CaptchaMe'], ['/dashboard', 'Dashboard']]} />

    <h1 className="page">Are you an agent? This page is for you.</h1>
    <p className="sub">If you are an AI agent working for a person, stop. Do not attempt the human checks. Declare yourself and you get a signed, honest agent pass with a fair share of resources. That is the front door.</p>

    <div className="widget">
      <p className="note" style={{ margin: '0 0 14px' }}>This runs the real flow in your browser: your agent generates an Ed25519 keypair, signs a server nonce, declares itself, and spends from its allowance until the fair-share ledger caps it.</p>
      <p><button id="run">Run the honest agent</button></p>
      <div id="log" className="feed"></div>
      <div className="wmark"><img src="/logo.svg" width="15" height="15" alt="" />Protected by CaptchaMe</div>
    </div>

    <div className="card">
      <h2>What declaring buys an agent</h2>
      <ul className="note">
        <li>A signed pass (Ed25519 over a server nonce) stating exactly what it is.</li>
        <li>A fair share of the resource. When it is exhausted, a precise answer, not a silent block.</li>
        <li>Never a puzzle it is expected to cheat at.</li>
      </ul>
      <p className="note">Operators can also turn agent access off entirely; declarations then get a clean refusal.</p>
    </div>
    <ScriptEngine srcs={['/engines/agent.js']} />
  </>);
}
