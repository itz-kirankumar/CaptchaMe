import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Developer analytics' };

export default function Page() {
  return (<>
    <PageHead kicker="Developer analytics" title="Every attack, counted and explained">
      What a developer watches after shipping CaptchaMe: who tried, which format they hit, why they were caught, and what the scraper shield did. Updates every two seconds from the live event stream.
    </PageHead>

    <div className="kpis" id="kpis">
      <div className="kpi"><div className="n" id="k-checks">-</div><div className="l">checks judged</div></div>
      <div className="kpi"><div className="n human" id="k-humans">-</div><div className="l">humans verified</div></div>
      <div className="kpi"><div className="n bot" id="k-bots">-</div><div className="l">bots and relays caught</div></div>
      <div className="kpi"><div className="n agent" id="k-agents">-</div><div className="l">agents declared</div></div>
      <div className="kpi"><div className="n warn" id="k-scrape">-</div><div className="l">scraper requests stopped</div></div>
      <div className="kpi"><div className="n" id="k-saved">-</div><div className="l">compute protected by the ledger</div></div>
    </div>

    <div className="card">
      <div className="row"><h2 style={{ margin: 0 }}>Traffic, last 30 minutes</h2><span className="spacer"></span><span className="badge"><span className="dot"></span>live</span></div>
      <div id="timeline" style={{ marginTop: 14 }}></div>
      <div className="legend"><span><i style={{ background: 'var(--human)' }}></i>human passes</span><span><i style={{ background: 'var(--bot)' }}></i>bots caught</span><span><i style={{ background: 'var(--warn)' }}></i>scraper slowed, decoyed or blocked</span><span><i style={{ background: 'var(--agent)' }}></i>declared agents</span><span><i style={{ background: 'var(--appeal)' }}></i>arena attempts</span></div>
    </div>

    <div className="grid g2">
      <div className="card"><h2>Verdicts by format</h2><div className="bars" id="byFormat"><div className="empty">No checks yet.</div></div><div className="legend"><span><i style={{ background: 'var(--human)' }}></i>passed</span><span><i style={{ background: 'var(--bot)' }}></i>failed</span></div></div>
      <div className="card"><h2>Why bots were caught</h2><div className="bars" id="byReason"><div className="empty">No catches yet.</div></div></div>
    </div>
    <div className="grid g2">
      <div className="card"><h2>Scraper shield decisions</h2><div className="bars" id="byDecision"><div className="empty">No listing traffic yet.</div></div></div>
      <div className="card"><h2>Attackers</h2><div className="tablewrap"><table><thead><tr><th>Attacker label</th><th>Attempts</th><th>Got through</th><th>Caught</th></tr></thead><tbody id="byAttacker"><tr><td colSpan="4" className="empty">Set a label in the arena to see tools side by side.</td></tr></tbody></table></div></div>
    </div>
    <div className="card"><h2>Event stream</h2><div className="feed" id="feed"></div></div>
    <ScriptEngine srcs={['/engines/analytics.js']} />
  </>);
}
