import Nav from '../../components/Nav';
export const metadata = { title: 'Compare' };

export default function Page() {
  return (<>
    <Nav links={[['/how', 'How it works'], ['/check', 'Try it'], ['/dashboard', 'Dashboard']]} />

    <h1 className="page">The old question is answered by the wrong party</h1>
    <p className="sub">Every captcha since 2000 has asked &quot;can you solve this puzzle?&quot; In 2026 the honest answer, from any agent, is yes. Here is what that looks like, and what we ask instead.</p>

    <div className="card">
      <table>
        <thead><tr><th></th><th>What it asks</th><th>Who answers in 2026</th><th>Cost to pass</th></tr></thead>
        <tbody>
          <tr><td><strong>Distorted text</strong><br/><span className="note">reCAPTCHA v1, 2007</span></td><td>Read warped characters</td><td>OCR models, solver farms</td><td>$0.50 per 1,000 (2captcha list price)</td></tr>
          <tr><td><strong>Image grids</strong><br/><span className="note">reCAPTCHA v2</span></td><td>Click every traffic light</td><td>Vision models, human click farms</td><td>$1-3 per 1,000, or free via an agent&apos;s eyes</td></tr>
          <tr><td><strong>Invisible score</strong><br/><span className="note">reCAPTCHA v3</span></td><td>Nothing; a hidden score</td><td>Everyone passes eventually; sites tune thresholds blind</td><td>Free retry until the score flips</td></tr>
          <tr><td><strong>Cloudflare Turnstile</strong></td><td>Nothing visible; browser proof-of-work and signals</td><td>Headless browsers replay the same signals</td><td>Free to replay</td></tr>
          <tr><td><strong>hCaptcha</strong></td><td>More image puzzles</td><td>Same solvers, slightly higher price</td><td>$0.99 per 1,000</td></tr>
          <tr><td><strong>CaptchaMe</strong></td><td>Be here, live, like a person</td><td>People. Agents get a declared lane or a precise wait.</td><td>Time you cannot fake, plus a ledger that caps every identity</td></tr>
        </tbody>
      </table>
    </div>

    <div className="card">
      <h2>The asymmetry that broke captchas</h2>
      <p>Old captchas scale linearly for the attacker: a thousand solves costs a thousand tiny fees, or nothing with a modern agent. CaptchaMe makes each attempt cost live, measured seconds of presence, and the fair-share ledger means scaling up does not dilute the cost. Verification flips who does the work.</p>
    </div>
  </>);
}
