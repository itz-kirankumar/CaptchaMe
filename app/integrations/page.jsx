import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Integrations' };

const HASH_NODE = `// The same canonical form hash the widget computes in the browser:
// SHA-256 of the sorted [name, value] pairs, without the pass field.
const crypto = require('crypto');
function formHash(fields) {
  const pairs = Object.entries(fields)
    .filter(([k, v]) => k !== 'cm_pass' && typeof v === 'string')
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
  return crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
}`;

const SNIPPETS = [
  ['html', 'HTML (invisible)', `<!-- Protect a form. Most people never see a check: the widget reads how the
     form is filled (timings, never the keys) and asks only when it must. -->
<form id="signup" method="post" action="/signup">
  <input name="name" required>
  <input name="email" type="email" required>
  <button type="submit">Create account</button>
</form>
<script src="{ORIGIN}/widget.js" data-form="#signup"></script>
<!-- On submit the form gains a hidden field "cm_pass", bound to this browser
     and to these exact form contents, then submits as normal. -->`],
  ['next', 'Next.js', `// app/api/signup/route.js : verify the pass before you accept the action
${HASH_NODE}

export async function POST(req) {
  const form = Object.fromEntries(await req.formData());
  const r = await fetch('{ORIGIN}/api/pass/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pass: form.cm_pass,
      form_hash: formHash(form),                 // refuses a pass pasted into another submission
      remoteip: req.headers.get('x-forwarded-for')?.split(',')[0],
      user_agent: req.headers.get('user-agent'), // refuses a pass relayed from another browser
      accept_language: req.headers.get('accept-language'),
    }),
  });
  const v = await r.json();
  if (!v.ok) return Response.json({ error: v.reason }, { status: 403 });
  return Response.json({ ok: true, visitor: v.subject, via: v.via }); // via: silent | nudge | ring | ...
}`],
  ['express', 'Express', `${HASH_NODE}

async function captchame(req, res, next) {
  const r = await fetch('{ORIGIN}/api/pass/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pass: req.body.cm_pass, form_hash: formHash(req.body), remoteip: req.ip,
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
import hashlib, json, httpx
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

def form_hash(fields: dict) -> str:
    pairs = sorted((k, v) for k, v in fields.items() if k != "cm_pass" and isinstance(v, str))
    return hashlib.sha256(json.dumps([list(p) for p in pairs], separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

@app.post("/signup")
async def signup(request: Request):
    form = dict(await request.form())
    async with httpx.AsyncClient() as c:
        v = (await c.post("{ORIGIN}/api/pass/verify", json={
            "pass": form.get("cm_pass"), "form_hash": form_hash(form),
            "remoteip": request.client.host,
            "user_agent": request.headers.get("user-agent"),
            "accept_language": request.headers.get("accept-language"),
        })).json()
    if not v["ok"]:
        raise HTTPException(403, v["reason"])
    return {"ok": True, "visitor": v["subject"]}`],
  ['edge', 'Scraper shield (edge)', `// Next.js middleware.js : ask the shield before serving a listing page.
// No server-side waiting: slowed scrapers get 429 + Retry-After and pay the wait.
import { NextResponse } from 'next/server';

export async function middleware(req) {
  const s = await fetch('{ORIGIN}/api/shield/check', {
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
  }).then(r => r.json()); // { decision: allow|slow|decoy|block|agent, risk, reasons, retry_after_ms }

  if (s.decision === 'block')
    return NextResponse.json({ error: s.reasons.join('; '), appeal_url: '/appeal' }, { status: 429 });
  if (s.decision === 'slow')
    return NextResponse.json({ error: 'slow_down', retry_after_ms: s.retry_after_ms },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(s.retry_after_ms / 1000)) } });
  if (s.decision === 'decoy')   // a cached decoy page carrying a canary record
    return NextResponse.rewrite(new URL('/decoy' + req.nextUrl.pathname, req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/products/:path*', '/api/listings/:path*'] };`],
  ['agent', 'AI agents', `// 1) Verified operators: sign requests with Web Bot Auth (HTTP Message
//    Signatures). Publish your Ed25519 key at
//    https://your-agent.example/.well-known/http-message-signatures-directory
//    and send on every request:
//      Signature-Agent: "https://your-agent.example"
//      Signature-Input: sig1=("@authority" "signature-agent");created=...;expires=...;keyid="<JWK thumbprint>";alg="ed25519";tag="web-bot-auth"
//      Signature: sig1=:<base64>:
//    Check how this server sees you:  GET {ORIGIN}/api/agent/whoami
//    Verified operators get their own budget; no registration call.

// 2) A person's own agent: declare a key with that person's pass. It spends
//    from their fair share, however many keys it uses (Node 18+).
const { generateKeyPairSync, sign } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubkey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const { nonce } = await (await fetch('{ORIGIN}/api/agent/nonce', { method: 'POST' })).json();
const signature = sign(null, Buffer.from(nonce), privateKey).toString('base64');
const d = await (await fetch('{ORIGIN}/api/agent/declare', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ pubkey, signature, nonce, operator: 'ada-assistant', pass: PERSONS_PASS }),
})).json();   // d.mode: "delegated"; without a pass: "pooled" (one small pool per network)
await fetch('{ORIGIN}/api/protected/quote', { headers: { authorization: 'Bearer ' + d.agent_token } });`],
  ['curl', 'cURL', `# zero-install audit: what bots and scrapers cost you, from an access log
curl --data-binary @access.log "{ORIGIN}/api/audit/analyze?cost_per_1k=0.40&cost_per_gb=0.09"

# ask the scraper shield about one request
curl -s -X POST {ORIGIN}/api/shield/check -H 'content-type: application/json' \\
  -d '{"ip":"203.0.113.9","ua":"python-requests/2.32","acceptLanguage":"","js":false,"page":4}'

# verify a pass for this browser and this form
curl -s -X POST {ORIGIN}/api/pass/verify -H 'content-type: application/json' \\
  -d '{"pass":"...","form_hash":"<sha256>","remoteip":"203.0.113.9","user_agent":"Mozilla/5.0 ..."}'`],
];

const ENDPOINTS = [
  ['POST', '/api/pass/silent', 'Rung 1: the widget sends how a form was filled (timings, no values). Answer: pass, nudge or challenge.'],
  ['POST', '/api/pass/nudge', 'Rung 1b: the hold-and-release button check.'],
  ['POST', '/api/pass/verify', 'Your server checks a pass. Send form_hash to refuse pasted passes, and remoteip, user_agent, accept_language to refuse relayed ones.'],
  ['POST', '/api/challenge/start', 'Rung 3: start a live check (ring, clash, targets, reflex, pulse, beat, voice, or auto). Answer within its length plus 6 s.'],
  ['POST', '/api/challenge/cue', 'Rung 3: the ring’s jumps and the pulse’s flashes, revealed live with signed receipts.'],
  ['POST', '/api/challenge/submit', 'Rung 3: submit telemetry and cue receipts; get HUMAN or BOT, the reasons, and a bound pass.'],
  ['POST', '/api/shield/check', 'Your edge asks about a request: allow, slow (429), decoy or block, with reasons.'],
  ['POST', '/api/audit/analyze', 'Zero-install audit: send access-log text, get the cost of automated traffic by type.'],
  ['GET', '/api/agent/whoami', 'Agents: check a Web Bot Auth signature and see the operator budget.'],
  ['POST', '/api/agent/declare', 'Agents: declare an Ed25519 key, delegated to a person’s pass or pooled per network.'],
  ['POST', '/api/appeal', 'Anyone capped or blocked can ask a human to review it.'],
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
    <PageHead kicker="Integrations" title="One script tag, one verify call">
      Protect a form with the invisible widget, verify the pass on your server against the visitor&apos;s browser and the exact form contents, and optionally ask the scraper shield at the edge. Every snippet below runs against this server today.
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
            <p><a href="/demo.html">Northwind Books</a> is a mock storefront protected with the one-line invisible widget. Or start with the <Link href="/audit">free log audit</Link> to see what bots cost you today.</p>
          </div>
        </div>
      </div>
    </section>
    <ScriptEngine srcs={['/engines/integrations.js']} />
  </>);
}
