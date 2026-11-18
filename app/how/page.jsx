import Nav from '../../components/Nav';
export const metadata = { title: 'How it works' };

export default function Page() {
  return (<>
    <Nav links={[['/check', 'Try it'], ['/compare', 'Compare'], ['/dashboard', 'Dashboard']]} />

    <h1 className="page">Three doors, one honest system</h1>
    <p className="sub">CaptchaMe does not fight a permanent arms race. It reads simple physics of human behavior, gives honest agents a front door, and puts a hard ledger in front of everything that pretends.</p>

    <div className="card">
      <h2>Door 1: Proof of presence</h2>
      <p>Four small checks, each under 10 seconds:</p>
      <ul className="note">
        <li><strong>Follow the ring</strong>: track a moving ring for 7 seconds. We measure speed, jitter and correction, not perfection.</li>
        <li><strong>Tap the beat</strong>: tap with 12 pulses. Human rhythm error is 30-100ms and drifts. Script timing is metronomic.</li>
        <li><strong>Catch the flash</strong>: click 5 random flashes. Humans need 150-300ms. Sub-100ms &quot;reflexes&quot; are code.</li>
        <li><strong>Follow + catch</strong>: both at once. Split attention costs people accuracy; automation it does not.</li>
      </ul>
    </div>

    <div className="card">
      <h2>Why the physics holds up</h2>
      <p>The server publishes the challenge path up front, so no remote solver farm has any sight advantage. A follower script then has two choices: move perfectly and fail physics, or synthesize human sloppiness.</p>
      <p className="note">Replayed recordings of real humans carry frozen timing; fresh noise passes a basic check today but still has to be synthesized correctly for every new challenge on the fly. And every attempt feeds the fair-share ledger below, so better mimicry buys attackers tries, not scale.</p>
    </div>

    <div className="card">
      <h2>Door 2: Voice presence</h2>
      <p>Four spoken words, say each back. Timing is measured from the live microphone, so a recording of a voice played through a speaker pipeline carries playback characteristics that look different from a live throat. Built for accessibility: people who cannot do pointer challenges, and a second lane when a pointer check feels wrong about a real person.</p>
    </div>

    <div className="card">
      <h2>Door 3: The declare lane</h2>
      <p>An agent that says what it is gets a signed pass and a fair share: 10% of capacity, shared across all declared agents. When the share is exhausted, agents wait with a precise time, not a block. Sites can also turn agents off entirely.</p>
      <p className="note">This is the part nobody else does: we treat agents as a customer class with rights, not only as a threat class to crush.</p>
    </div>

    <div className="card">
      <h2>The ledger behind every door</h2>
      <p>Every attempt, from every identity and fingerprint, feeds one ledger. A single identity gets at most 3 tokens an hour, 10 a day; the shared agent pool caps at 20 an hour, 60 a day. Verification makes a wrong try expensive in the one currency attackers cannot print: time.</p>
    </div>
  </>);
}
