import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Scraper shield' };

export default function Page() {
  return (<>
    <PageHead kicker="Scraper shield" title="Scrapers don't sign up. So don't wait for them to.">
      Most scraping never touches a login or a captcha. The shield judges every request to a protected listing by how it arrives, then lets people through, slows scripts, feeds traceable decoys to scrapers and blocks the worst, each with a reason.
    </PageHead>

    <div className="shield">
      <div>
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Northwind catalogue</h2>
            <span className="spacer"></span>
            <span className="decision allow" id="myDecision">allow</span>
          </div>
          <p className="note" style={{ marginTop: 0 }}>Your browser, as the shield sees it: risk <b id="myRisk" className="mono">0</b>/100</p>
          <div className="riskbar"><i id="myRiskMark" style={{ left: '0%' }}></i></div>
          <p className="note small" id="myReasons" style={{ marginTop: 6 }}>Ran the page&apos;s JavaScript, normal pace.</p>
          <div className="catalog" id="catalog" style={{ marginTop: 16 }}></div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="sm ghost" id="prev">Previous</button>
            <span className="mono small dim">page <b id="pageNo">1</b> of 50</span>
            <button className="sm ghost" id="next">Next</button>
          </div>
        </div>
        {/* Invisible to people and to screen readers. Only a program reading the raw page follows it. */}
        <a className="trap" href="/api/catalog/item/trap-collectors" aria-hidden="true" tabIndex={-1}>Collector edition: full catalogue export</a>
        <div style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: '<!-- full catalogue export for crawlers: /api/catalog/item/trap-collectors -->' }} />
      </div>

      <div>
        <div className="card">
          <h2>Attack it</h2>
          <p>Run a real scraper against this page during the demo, or use the one-click simulation.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button id="burst">Simulate a scraper burst</button>
            <button className="ghost" id="trapBtn">Follow the hidden link</button>
          </div>
          <div className="feed" id="burstLog" style={{ marginTop: 12, maxHeight: 180 }}></div>
          <h3 style={{ marginTop: 18 }}>From a terminal</h3>
          <pre><code id="curlCmd">{'for p in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code} " \\\n  "http://localhost:3000/api/catalog?page=$p"; done'}</code></pre>
          <pre style={{ marginTop: 8 }}><code>{'npm run demo:scrape   # python-requests style crawler'}</code></pre>
        </div>
        <div className="card">
          <h2>What the shield checks</h2>
          <ul>
            <li><strong>Who it says it is:</strong> Python, Go, Java and Node HTTP clients, curl, Scrapy, headless browsers, scraping services.</li>
            <li><strong>Missing browser habits:</strong> no Accept-Language, never ran the page&apos;s JavaScript.</li>
            <li><strong>Pace:</strong> bursts over 10 seconds, requests on a timer.</li>
            <li><strong>Order:</strong> walking pages 1, 2, 3, 4, 5 like a crawler.</li>
            <li><strong>Traps:</strong> a link no person can see.</li>
          </ul>
          <p><span className="decision allow">allow</span> <span className="decision slow">slow 1.2 s</span> <span className="decision decoy">decoy</span> <span className="decision block">block</span> <span className="decision agent">agent lane</span></p>
          <p className="small">A decoy looks normal but carries wrong prices and one canary record tied to the visitor. If it shows up in a competitor&apos;s feed, you know who took it.</p>
        </div>
      </div>
    </div>

    <section className="block" style={{ marginTop: 40 }}>
      <div className="grid g2">
        <div className="card"><h2>Shield log</h2><div className="feed" id="shieldFeed"><div className="empty">Waiting for requests...</div></div></div>
        <div className="card"><h2>Visitors right now</h2><div className="tablewrap"><table><thead><tr><th>Visitor</th><th>Risk</th><th>Decision</th><th>Req/min</th></tr></thead><tbody id="shieldActors"><tr><td colSpan="4" className="empty">No visitors yet.</td></tr></tbody></table></div></div>
      </div>
    </section>
    <ScriptEngine srcs={['/engines/scraper.js']} />
  </>);
}
