import Nav from '../../components/Nav';
export const metadata = { title: 'Protect your site' };

export default function Page() {
  return (<>
    <Nav links={[['/how', 'How it works'], ['/dashboard', 'Dashboard']]} />

    <h1 className="page">Protect your site in three lines</h1>

    <div className="card">
      <h2>1. Paste the widget</h2>
      <pre><code>{'<script src="https://captchame.vercel.app/widget.js"\n        data-site="demo-site"></script>'}</code></pre>
    </div>

    <div className="card">
      <h2>2. Verify the pass server-side</h2>
      <pre><code>{`const r = await fetch('https://captchame.vercel.app/api/pass/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ pass })
});
const { ok, subject, share } = await r.json();
// ok=false: send the visitor to the challenge
// subject='agent': signed agent pass with its share
// subject='human': presence pass, let them in`}</code></pre>
    </div>

    <div className="card">
      <h2>See it live first</h2>
      <p><a href="/demo.html">Northwind Books</a> is a mock storefront using the exact script tag above: checkout stays locked until a human passes, then the page receives the signed pass.</p>
    </div>

    <div className="card">
      <h2>3. Read your dashboard</h2>
      <p>Every challenge, verdict, appeal and ledger cap is live at <a href="/dashboard">/dashboard</a>. Try it now with the demo-site key.</p>
    </div>

    <div className="card">
      <h2>Choose your agent policy</h2>
      <ul className="note">
        <li><strong>Fair share (default)</strong>: declared agents get 10% of capacity, in order, with a signed pass.</li>
        <li><strong>Humans only</strong>: declarations get a clean refusal; agents cannot buy a way in.</li>
        <li><strong>Priority lanes (soon)</strong>: paid, metered agent access for sites that want agent customers.</li>
      </ul>
    </div>
  </>);
}
