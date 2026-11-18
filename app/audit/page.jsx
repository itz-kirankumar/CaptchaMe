import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Bot cost audit' };

export default function Page() {
  return (<>
    <PageHead kicker="Zero-install audit" title="See what bots and scrapers cost you, from the logs you already have">
      Paste or upload an access log. In seconds you get every request sorted by who sent it (people, search engines, AI crawlers, scripts, headless browsers, browser-looking scrapers), the worst offenders, and the cost in your own unit prices. Nothing to install, and nothing is stored.
    </PageHead>

    <div className="grid g2" style={{ alignItems: 'start' }}>
      <div className="card">
        <h2>Your log</h2>
        <div className="audit-drop">
          <label htmlFor="logText">Apache or Nginx combined format, or JSON lines</label>
          <textarea id="logText" spellCheck="false" placeholder={'203.0.113.9 - - [18/Nov/2026:10:00:01 +0000] "GET /products?page=1 HTTP/1.1" 200 5120 "-" "python-requests/2.32.3"'}></textarea>
          <div className="row">
            <label className="btn sm ghost" htmlFor="logFile" style={{ cursor: 'pointer' }}>Upload a file</label>
            <input id="logFile" type="file" accept=".log,.txt,.json,.jsonl,text/plain" hidden />
            <button className="sm ghost" id="sample" type="button">Load a sample log</button>
            <span className="note small" id="fileNote" style={{ margin: 0 }}></span>
          </div>
        </div>
        <div className="grid g2" style={{ marginTop: 14, gap: 10 }}>
          <div><label htmlFor="c1k">Your cost per 1,000 requests (USD)</label><input id="c1k" type="number" step="0.01" min="0" defaultValue="0.40" /></div>
          <div><label htmlFor="cgb">Your cost per GB served (USD)</label><input id="cgb" type="number" step="0.01" min="0" defaultValue="0.09" /></div>
        </div>
        <button id="run" type="button">Run the audit</button>
        <p className="note small">Up to about 4 MB per run on the hosted demo. From a terminal: <code>curl --data-binary @access.log {'"'}<span id="origin">https://captchame.vercel.app</span>/api/audit/analyze{'"'}</code></p>
      </div>

      <div>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          <div className="kpi"><div className="n" id="a-total">-</div><div className="l">requests analysed</div></div>
          <div className="kpi"><div className="n bot" id="a-share">-</div><div className="l">sent by automation</div></div>
          <div className="kpi"><div className="n warn" id="a-cost">-</div><div className="l">cost of the automated share, this log</div></div>
          <div className="kpi"><div className="n" id="a-month">-</div><div className="l">projected per month at this rate</div></div>
        </div>
        <div className="card"><h2>Who sent the requests</h2><div className="bars" id="a-classes"><div className="empty">Run the audit to see the split.</div></div></div>
      </div>
    </div>

    <div className="card"><h2>Worst offenders</h2><div className="tablewrap"><table><thead><tr><th>Who</th><th>Type</th><th>Requests</th><th>Why</th></tr></thead><tbody id="a-top"><tr><td colSpan="4" className="empty">No results yet.</td></tr></tbody></table></div></div>
    <div className="card"><h2>What to turn on</h2><ul id="a-recs"><li className="dim">Recommendations appear after the audit.</li></ul>
      <p className="small">Names such as Googlebot or GPTBot are what the crawler claims. Next step: run <Link href="/scraper">the scraper shield</Link> in watch-only mode on live traffic, where it can also see JavaScript, headers and traps.</p></div>
    <ScriptEngine srcs={['/engines/audit.js']} />
  </>);
}
