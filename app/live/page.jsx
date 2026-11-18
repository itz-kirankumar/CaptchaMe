import ScriptEngine from '../../components/ScriptEngine';
export const metadata = { title: 'Live attack room' };

const LAYERS = [
  ['L0', 'Request', 'who asked, which format (the server picks)'],
  ['L1', 'Network', 'headers, client hints, header count, address'],
  ['L2', 'Sealed challenge', 'signed, single use, hidden live schedule'],
  ['L3', 'Browser probe', 'automation flag, plugins, window, languages'],
  ['L4', 'Response shape', 'reaction lag, corrections, path, spread'],
  ['L5', 'Live timing', 'wall clock and signed live receipts'],
  ['L6', 'Binding', 'same browser, no replay, no relay'],
  ['L7', 'Decision + ledger', 'pass token, dollar cap, or block with reason'],
];

export default function Page() {
  return (
    <div className="liveroom">
      <header className="lr-top">
        <div className="lr-intro">
          <span className="kicker">Live attack room</span>
          <div className="lr-title-row">
            <h1>Attack surface <span>/</span> live</h1>
            <span className="lr-session mono" id="lrSession">SESSION · LOCAL-SIM</span>
          </div>
          <p>Run local adversarial simulations against legacy answer-only formats and every CaptchaMe verification layer. Observe network evidence, live timing, replay resistance and the final ledger decision.</p>
        </div>
        <div className="lr-stats" aria-live="polite">
          <div className="lr-stat bot"><b id="stBypass">0</b><span>rival bypasses</span></div>
          <div className="lr-stat warn"><b id="stSpend">$0.000</b><span>attacker cost at market rate</span></div>
          <div className="lr-stat human"><b id="stBlocked">0</b><span>CaptchaMe blocks</span></div>
          <div className="lr-stat"><b id="stThrough">0</b><span>non-human passes on CaptchaMe</span></div>
        </div>
      </header>

      <div className="lr-statusrail">
        <span><i className="ok"></i><b>SYSTEM</b> operational</span>
        <span><i></i><b>MODE</b> defensive sandbox</span>
        <span><i></i><b>STREAM</b> <span id="lrStream">polling 450 ms</span></span>
        <span className="lr-clock"><b>UTC</b> <span id="lrClock">--:--:--</span></span>
      </div>

      <div className="attackerbar lr-bar">
        <span className="lbl">Attacking as</span>
        <div className="pills" id="pills"></div>
        <input id="attackerInput" placeholder="custom label" aria-label="Custom attacker label" maxLength={40} />
        <button className="sm ghost" id="attackerSet">Set</button>
        <span className="spacer"></span>
        <span className="lbl">Built-in attackers</span>
        <div className="pills" id="sims"></div>
        <button className="sm" id="liveRefresh" title="Load fresh versions of every rival captcha and restart the CaptchaMe widget">Refresh all captchas</button>
        <button className="sm ghost" id="liveReset" title="Clear this view (the server keeps its records)">Clear view</button>
      </div>

      <div className="lr-grid">
        <section className="lr-col lr-cm" aria-label="CaptchaMe">
          <div className="lr-head"><span className="chip human">captchame</span><h2>Every layer, live</h2><span className="spacer"></span><span className="lr-pulse" id="cmPulse">idle</span></div>
          <div className="lr-cmtop">
            <div className="lr-widget">
              <iframe id="cmFrame" src="/check?embed=1" title="CaptchaMe human check" allow="microphone"></iframe>
            </div>
            <ol className="lr-layers" id="layers">
              {LAYERS.map(([id, name, what]) => (
                <li key={id} data-layer={id} className="idle">
                  <span className="lr-dot" aria-hidden="true"></span>
                  <span className="lr-lid mono">{id}</span>
                  <span className="lr-lname"><b>{name}</b><small>{what}</small></span>
                  <span className="lr-ltext mono">waiting</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="lr-vizrow">
            <figure className="lr-fig">
              <figcaption><b>Live sensor</b> your pointer inside the widget, read 60 times a second<span className="spacer"></span><span className="mono dim" id="sensorTrust"></span></figcaption>
              <canvas id="sensorCv" width="640" height="260"></canvas>
              <div className="lr-readout mono" id="sensorOut">move inside the CaptchaMe widget</div>
            </figure>
            <figure className="lr-fig">
              <figcaption><b>Last attempt</b> what the server measured<span className="spacer"></span><span className="mono dim" id="vizLabel"></span></figcaption>
              <canvas id="vizCv" width="640" height="260"></canvas>
              <div className="lr-legend"><span><i className="tg"></i>target the server drew</span><span><i className="cu"></i>cursor it received</span><span><i className="hb"></i>human reaction band</span></div>
            </figure>
          </div>
          <div className="lr-console" id="cmConsole" role="log" aria-label="CaptchaMe raw recognition log"></div>
        </section>

        <section className="lr-col lr-rival" aria-label="Other captcha styles">
          <div className="lr-head"><span className="chip bot">other captchas</span><h2>Answer-only checks</h2><span className="spacer"></span><span className="lr-pulse" id="rvPulse">idle</span></div>
          <p className="lr-sub">Local recreations of the formats on the 2captcha price list, judged by this server. Each card shows its going rate. When one is beaten, it flashes red with who did it and what it cost them.</p>
          <div className="lr-rivals" id="rivalGrid"></div>
          <div className="lr-console" id="rivalConsole" role="log" aria-label="Rival and attacker raw log"></div>
        </section>
      </div>
      <section className="lr-col lr-l2" aria-label="Layer 2" style={{ marginTop: 18 }}>
        <div className="lr-head"><span className="chip warn">layer 2</span><h2>Post-verification: what layer 1 handed over</h2><span className="spacer"></span><span className="lr-pulse" id="l2Pulse">idle</span><a className="btn sm" href="/layer2">Open the full analysis</a></div>
        <p className="lr-sub">Every layer 1 verdict, rival captcha attempt and scrape becomes a packet. Layer 2 merges packets into one identity per real client (across address, handshake signature and browser fingerprint), names the bypass family, and decides what that identity may do next.</p>
        <div className="lr-console" id="l2Console" role="log" aria-label="Layer 2 handoff log"></div>
      </section>
      <ScriptEngine srcs={['/engines/embedfit.js', '/engines/live.js']} />
    </div>
  );
}
