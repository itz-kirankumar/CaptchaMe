import Nav from '../../components/Nav';
import ScriptEngine from '../../components/ScriptEngine';
export const metadata = { title: 'Live dashboard' };

export default function Page() {
  return (<>
    <Nav links={[['/check', 'Try it'], ['/live', 'Live run'], ['/agent', 'Agents']]} />

    <h1 className="page">Live dashboard</h1>
    <p className="sub">Every check, call, block and appeal, as it happens. This is what a site operator watches.</p>

    <div className="statgrid" id="summary">
      <div className="stat"><div className="n" id="s-saved">-</div><div className="l">compute protected</div></div>
      <div className="stat"><div className="n" id="s-blocked">-</div><div className="l">over-cap calls refused</div></div>
      <div className="stat"><div className="n" id="s-actors">-</div><div className="l">actors</div></div>
      <div className="stat"><div className="n" id="s-appeals">-</div><div className="l">open appeals</div></div>
    </div>

    <div className="card">
      <h2 style={{ marginTop: 0 }}>Fair-share ledger</h2>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Actor</th><th>Kind</th><th>Spent</th><th>Allowance</th><th>Left</th><th>Blocked</th></tr></thead><tbody id="actors"><tr><td colSpan="6" className="note">Loading...</td></tr></tbody></table></div>
    </div>
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Appeals</h2>
      <div id="appeals" className="feed"></div>
    </div>
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Event feed</h2>
      <div id="feed" className="feed"></div>
    </div>
    <ScriptEngine srcs={['/engines/dashboard.js']} />
  </>);
}
