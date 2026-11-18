import Link from 'next/link';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'How it works' };

const FORMATS = [
  ['Follow the ring', 'Track a moving ring for 7 s; it jumps twice', 'Reaction lag (80-350 ms), constant small corrections, recovery after each jump, lag drift', 'Path-reading scripts (0 ms lag), look-think-act agents (seconds to re-aim)'],
  ['Colour clash', 'Pick the ink colour of 8 words, 1.3 s each', 'Answer-time spread, accuracy, slowdown on mismatched words', 'Timers (identical times), page-text readers (pick the word), slow agents (miss the window)'],
  ['Targets', 'Click 9 targets of varied size and distance', "Fitts' law slope, scatter around the centre, accelerate-then-brake paths", 'Dead-centre clickers, teleporting cursors, constant-speed mouse bots, slow agents'],
  ['Catch the flash', 'Click 5 flashes, each under a second', 'Scattered reactions of 200-450 ms', 'Fixed-offset timers, clicks before the flash, look-think-act agents'],
  ['Follow + catch', 'Track and react at once', 'Tracking holds while reacting (dual task)', 'Step agents that drop the ring while busy'],
  ['Tap the beat', 'Tap with 12 pulses', 'Anticipation and natural timing scatter', 'Metronomic scripts, playback lag'],
  ['Voice path', 'Say 4 words back', 'Vocal onset timing and its spread, word match', 'Uniform playback scripts'],
];

const FARM = [
  ['Ship the content', 'The image, text or audio is uploaded to a model or a worker', 'There is no content to upload: the challenge is a live interaction. A worker driving it remotely adds network and video delay, which lands outside the human lag band and the sub-second windows.'],
  ['Ship the token', 'A worker solves the widget elsewhere and hands over the pass', 'Every pass is bound to the browser that earned it (user agent, language, network prefix) and works once. A relayed pass is refused with a reason.'],
  ['AI vision', 'A model looks at the puzzle and answers', 'Nothing is hidden in the picture. The questions are about timing and motor control, which a screenshot loop cannot produce in real time.'],
  ['Behaviour emulation', 'Scripts synthesise mouse paths and delays', 'Each format checks several signals at once (lag, corrections, Fitts slope, velocity shape, interference), and the mix rotates per session in surprise mode.'],
  ['Proof of work', 'Computers compute', 'CaptchaMe does not ask for compute. It asks for a body.'],
  ['Extensions', 'Buster, CapSolver and others solve known widgets in the page', 'There is no audio clip to transcribe, and no standard widget layout to recognise. The widget runs in a closed frame scored on the server.'],
];

export default function Page() {
  return (<>
    <PageHead kicker="How it works" title="Four defences, one door">
      Every classic captcha asks a question with a right answer, so the answer can be bought. CaptchaMe measures how a live person responds, binds the result to their browser, and caps what any actor can take even when a check is beaten.
    </PageHead>

    <div className="grid g4">
      <div className="step"><p className="n">01 · LIVE</p><b>Presence, not puzzles</b><p>Timing and motor control measured in real time.</p></div>
      <div className="step"><p className="n">02 · BOUND</p><b>Bound passes</b><p>Once only, 90-second challenges, passes tied to one browser.</p></div>
      <div className="step"><p className="n">03 · SHAPE</p><b>Scored on shape</b><p>Several signals per format, judged on the server.</p></div>
      <div className="step"><p className="n">04 · CAPPED</p><b>The ledger</b><p>A dollar cap per actor, a plain reason, a human appeal.</p></div>
    </div>

    <section className="block" style={{ marginTop: 56 }}>
      <h2 className="section">The formats</h2>
      <div className="card"><div className="tablewrap"><table>
        <thead><tr><th>Format</th><th>What you do</th><th>What the server measures</th><th>What fails it</th></tr></thead>
        <tbody>{FORMATS.map(r => <tr key={r[0]}><td><strong>{r[0]}</strong></td><td className="dim">{r[1]}</td><td>{r[2]}</td><td className="dim">{r[3]}</td></tr>)}</tbody>
      </table></div></div>
      <p className="note"><Link href="/check">Try them</Link> · surprise mode lets the server pick the format so a solver cannot be trained on one.</p>
    </section>

    <section className="block" style={{ marginTop: 56 }}>
      <h2 className="section">How it answers a solver farm</h2>
      <p className="section-sub">Solver services work in two ways: ship the puzzle to someone who can answer it, or ship the token from someone who passed. Here is each technique and the counter.</p>
      <div className="card"><div className="tablewrap"><table>
        <thead><tr><th>Technique</th><th>How it beats classic captchas</th><th>Why it does not work here</th></tr></thead>
        <tbody>{FARM.map(r => <tr key={r[0]}><td><strong>{r[0]}</strong></td><td className="dim">{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
      </table></div></div>
    </section>

    <section className="block" style={{ marginTop: 56 }}>
      <div className="grid g3">
        <div className="card"><h2>The ledger</h2><p>Every actor gets an allowance in dollars on the protected resource. At the cap the response says why and links to an appeal a human reviews. Even a beaten check buys one person&apos;s share, not the pool.</p></div>
        <div className="card"><h2>The agent lane</h2><p>Agents sign a server nonce with an Ed25519 key, skip the human checks and get their own capped budget. Honest automation is a customer, not an enemy. <Link href="/agent">Try it</Link></p></div>
        <div className="card"><h2>The scraper shield</h2><p>Visitors with no account are judged by how they request pages: client identity, headers, pace, order, traps. Then allow, slow, decoy or block. <Link href="/scraper">Try it</Link></p></div>
      </div>
    </section>

    <section className="block" style={{ marginTop: 56 }}>
      <h2 className="section">What still gets through</h2>
      <p className="section-sub">No check proves humanity forever, and this one does not claim to. These are the known residuals, each tested in the suite:</p>
      <div className="card">
        <ul>
          <li><strong>A bot that knows the clash answers and adds random delays</strong> passes colour clash. Mixing formats in surprise mode and the ledger cap bound what it wins.</li>
          <li><strong>A dedicated simulator that waits the full time</strong> and submits human-shaped tracking can pass follow + catch. It must spend real seconds per attempt, and the cap limits the prize.</li>
          <li><strong>A text-to-speech pipeline with human-like jitter</strong> passes the voice path. That pass is worth less on the ledger.</li>
          <li><strong>A farm that routes its worker through the bot&apos;s own proxy and user agent</strong> can defeat browser binding. Its worker must still perform live, sub-second interaction, which costs far more than a 2-second image task.</li>
          <li><strong>The synthetic humans are synthetic.</strong> Thresholds need tuning on real people (mouse, trackpad, touch, older users, assistive technology) before production.</li>
        </ul>
      </div>
    </section>
  </>);
}
