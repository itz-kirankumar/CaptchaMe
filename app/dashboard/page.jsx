import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Console' };

export default function Page() {
  return (<>
    <PageHead kicker="Console" title="The operator's view">
      The fair-share ledger, appeals waiting for a human, and every event as it happens. For charts and attacker breakdowns, open <Link href="/analytics">analytics</Link>.
    </PageHead>

    <div className="statgrid" id="summary">
      <div className="stat"><div className="n" id="s-saved">-</div><div className="l">compute protected</div></div>
      <div className="stat"><div className="n" id="s-blocked">-</div><div className="l">over-cap calls refused</div></div>
      <div className="stat"><div className="n" id="s-actors">-</div><div className="l">actors on the ledger</div></div>
      <div className="stat"><div className="n" id="s-appeals">-</div><div className="l">open appeals</div></div>
      <div className="stat"><div className="n" id="s-signups">-</div><div className="l">early-access requests</div></div>
    </div>

    <div className="card">
      <h2>Fair-share ledger</h2>
      <div className="tablewrap"><table><thead><tr><th>Actor</th><th>Kind</th><th>Spent</th><th>Allowance</th><th>Left</th><th>Blocked</th></tr></thead><tbody id="actors"><tr><td colSpan="6" className="empty">Loading...</td></tr></tbody></table></div>
    </div>
    <div className="card">
      <h2>Early-access requests</h2>
      <p className="note small" style={{ marginTop: 0 }}>Sent through the protected form on the <Link href="/check">risk ladder</Link> page. Each one was accepted only with a person&apos;s pass, earned in that browser for exactly these values.</p>
      <div className="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Verified by</th><th>When</th></tr></thead><tbody id="signups"><tr><td colSpan="4" className="empty">Loading...</td></tr></tbody></table></div>
    </div>
    <div className="grid g2">
      <div className="card"><h2>Appeals</h2><div id="appeals" className="feed"></div></div>
      <div className="card"><h2>Event feed</h2><div id="feed" className="feed"></div></div>
    </div>
    <ScriptEngine srcs={['/engines/admin.js', '/engines/dashboard.js']} />
  </>);
}
