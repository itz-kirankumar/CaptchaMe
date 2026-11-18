import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Integrations' };

const SNIPPETS = [
  ['html', 'HTML widget', `<!-- 1. Put the check where your captcha sits today -->
<form id="signup" method="post" action="/signup">
  <input name="email" type="email" required>
  <input name="pass" type="hidden">
  <script src="{ORIGIN}/widget.js" data-site="your-site" data-onpass="onHuman"></script>
  <button type="submit">Create account</button>
</form>
<script>
  function onHuman(d) { document.querySelector('[name=pass]').value = d.pass_token; }
</script>`],
  ['next', 'Next.js', `// app/api/signup/route.js : verify the pass before you accept the action
export async function POST(req) {
  const form = await req.formData();
  const r = await fetch('{ORIGIN}/api/pass/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pass: form.get('pass'),
      remoteip: req.headers.get('x-forwarded-for')?.split(',')[0],
      user_agent: req.headers.get('user-agent'),
      accept_language: req.headers.get('accept-language'),
    }),
  });
  const v = await r.json();
  if (!v.ok) return Response.json({ error: v.reason }, { status: 403 });
  // v.subject is 'human' or 'agent'; v.browser_checked says the pass came from this browser
  return Response.json({ ok: true });
}`],
  ['express', 'Express', `// middleware: only verified humans (or declared agents) reach the route
async function captchame(req, res, next) {
  const r = await fetch('{ORIGIN}/api/pass/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pass: req.body.pass, remoteip: req.ip,
      user_agent: req.get('user-agent'), accept_language: req.get('accept-language'),
    }),
  });
  const v = await r.json();
  if (!v.ok) return res.status(403).json({ error: v.reason });
  req.visitor = { kind: v.subject, actor: v.actor };
  next();
}
app.post('/signup', express.urlencoded({ extended: false }), captchame, createAccount);`],
  ['python', 'Python', `# FastAPI (the same call works from Flask or Django)
import httpx
from fastapi import FastAPI, Form, Request, HTTPException

app = FastAPI()

@app.post("/signup")
async def signup(request: Request, email: str = Form(...), pass_: str = Form(..., alias="pass")):
    async with httpx.AsyncClient() as c:
        v = (await c.post("{ORIGIN}/api/pass/verify", json={
            "pass": pass_,
            "remoteip": request.client.host,
            "user_agent": request.headers.get("user-agent"),
            "accept_language": request.headers.get("accept-language"),
        })).json()
    if not v["ok"]:
        raise HTTPException(403, v["reason"])
    return {"ok": True, "visitor": v["subject"]}`],
  ['edge', 'Scraper shield (edge)', `// Next.js middleware.js : ask the shield before serving a listing page
import { NextResponse } from 'next/server';

export async function middleware(req) {
  const r = await fetch('{ORIGIN}/api/shield/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ip: req.headers.get('x-forwarded-for')?.split(',')[0],
      ua: req.headers.get('user-agent'),
      acceptLanguage: req.headers.get('accept-language'),
      js: req.cookies.get('cm_js')?.value === '1',
      vid: req.cookies.get('cm_vid')?.value,
      page: Number(req.nextUrl.searchParams.get('page')),
    }),
  });
  const s = await r.json(); // { decision: allow|slow|decoy|block, risk, reasons, delay_ms }
  if (s.decision === 'block') return NextResponse.json({ error: s.reasons.join('; ') }, { status: 429 });
  if (s.decision === 'decoy') return NextResponse.rewrite(new URL('/decoy' + req.nextUrl.pathname, req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/products/:path*', '/api/listings/:path*'] };`],
  ['curl', 'cURL', `# start a challenge, submit telemetry, verify the pass
curl -s -X POST {ORIGIN}/api/challenge/start -H 'content-type: application/json' -d '{"type":"auto"}'
curl -s -X POST {ORIGIN}/api/challenge/submit -H 'content-type: application/json' -d '{"session":"...","samples":[...]}'
curl -s -X POST {ORIGIN}/api/pass/verify -H 'content-type: application/json' \\
  -d '{"pass":"...","remoteip":"203.0.113.9","user_agent":"Mozilla/5.0 ..."}'

# ask the scraper shield about a request
curl -s -X POST {ORIGIN}/api/shield/check -H 'content-type: application/json' \\
  -d '{"ip":"203.0.113.9","ua":"python-requests/2.32","acceptLanguage":"","js":false,"page":4}'`],
  ['agent', 'AI agent lane', `// An honest agent declares itself instead of solving a puzzle (Node 18+)
const { generateKeyPairSync, sign } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubkey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

const { nonce } = await (await fetch('{ORIGIN}/api/agent/nonce', { method: 'POST' })).json();
const signature = sign(null, Buffer.from(nonce), privateKey).toString('base64');
const d = await (await fetch('{ORIGIN}/api/agent/declare', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ pubkey, signature, nonce, operator: 'acme-shopping-agent' }),
})).json();

// d.agent_token: send as "Authorization: Bearer <token>"; the agent spends its own capped budget
await fetch('{ORIGIN}/api/protected/quote', { headers: { authorization: 'Bearer ' + d.agent_token } });`],
];

const ENDPOINTS = [
  ['POST', '/api/challenge/start', 'Start a check: ring, clash, targets, reflex, pulse, beat, voice, or auto (server picks).'],
  ['POST', '/api/challenge/submit', 'Submit telemetry. Returns a HUMAN or BOT verdict, a score, the reasons and a pass bound to this browser.'],
  ['POST', '/api/pass/verify', 'Your server checks a pass. Send remoteip, user_agent and accept_language to refuse relayed tokens.'],
  ['POST', '/api/shield/check', 'Your edge asks about a request: allow, slow, decoy or block, with reasons.'],
  ['GET', '/api/catalog?page=N', 'The demo listing protected by the shield.'],
  ['POST', '/api/agent/nonce', 'Agent lane, step 1: get a nonce.'],
  ['POST', '/api/agent/declare', 'Agent lane, step 2: send the Ed25519 signature; get an agent token with its own budget.'],
  ['POST', '/api/appeal', 'Anyone capped or blocked can ask a human to review it.'],
  ['GET', '/api/stats', 'Public counters: checks, humans, bots caught, agents, scraper requests stopped.'],
  ['GET', '/api/admin/events', 'Admin: the event stream behind the console and analytics (X-Admin-Key).'],
];

const PLATFORMS = [
  ['N', 'Next.js and Vercel', 'Ready. Route handler and middleware above.', true],
  ['JS', 'Node and Express', 'Ready. One middleware.', true],
  ['Py', 'Python', 'Ready. FastAPI, Flask or Django over HTTP.', true],
  ['CF', 'Cloudflare Workers', 'Ready. Same fetch call as the edge middleware.', true],
  ['Go', 'Go, Ruby, Java, PHP', 'Ready over plain HTTP. Official SDKs planned.', true],
  ['WP', 'WordPress', 'Planned plugin for comments, login and WooCommerce checkout.', false],
  ['S', 'Shopify', 'Planned app for checkout and limited drops.', false],
  ['R', 'Stripe Radar', 'Planned: use Radar’s score as an input to the ledger.', false],
];

export default function Page() {
  return (<>
    <PageHead kicker="Integrations" title="Ten minutes from script tag to protected">
      A widget on the page, one verify call on your server, and an optional edge check for scrapers. Every snippet below runs against this server today.
    </PageHead>

    <div className="card" id="snips" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="codetabs" style={{ padding: '0 12px' }}>
        {SNIPPETS.map(([id, label], i) => <button key={id} data-snip={id} className={i === 0 ? 'on' : ''}>{label}</button>)}
      </div>
      {SNIPPETS.map(([id, , code], i) => (
        <div key={id} className="codepane" data-pane={id} style={{ display: i === 0 ? 'block' : 'none' }}>
          <button className="sm ghost copy" data-copy={id}>Copy</button>
          <pre style={{ margin: 0, borderRadius: 0, border: 0 }}><code data-code={id}>{code}</code></pre>
        </div>
      ))}
    </div>

    <section className="block" style={{ marginTop: 56 }}>
      <div className="grid g2">
        <div className="card">
          <h2>Endpoints</h2>
          {ENDPOINTS.map(([m, p, d]) => <div className="endpoint" key={p}><span className="m">{m}</span><span className="p">{p}</span><span className="d">{d}</span></div>)}
        </div>
        <div>
          <div className="card">
            <h2>Platforms</h2>
            <div className="grid" style={{ gap: 10 }}>
              {PLATFORMS.map(([ico, name, desc, ready]) => (
                <div className="platform" key={name}><span className="ico">{ico}</span><div><b>{name} {ready ? <span className="chip human">ready</span> : <span className="chip">planned</span>}</b><span>{desc}</span></div></div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2>Try it before you wire it</h2>
            <p><a href="/demo.html">Northwind Books</a> is a mock storefront using the exact script tag above: checkout stays locked until a human passes. Watch the result in the <Link href="/dashboard">console</Link>.</p>
          </div>
        </div>
      </div>
    </section>
    <ScriptEngine srcs={['/engines/integrations.js']} />
  </>);
}
