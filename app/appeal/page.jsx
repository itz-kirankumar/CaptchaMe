import Nav from '../../components/Nav';
import ScriptEngine from '../../components/ScriptEngine';
export const metadata = { title: 'Appeal a cap' };

export default function Page() {
  return (<>
    <Nav links={[['/check', 'Try again'], ['/dashboard', 'Dashboard']]} />

    <h1 className="page">Never a silent block</h1>
    <p className="sub">If the fair-share cap caught you by mistake, say so. A human reviews every appeal and can overturn it.</p>

    <div className="card">
      <form id="f">
        <label htmlFor="actor">Your actor id</label>
        <input id="actor" required autoComplete="off" />
        <label htmlFor="msg">What happened?</label>
        <textarea id="msg" rows="4" required placeholder="I am a real person testing the demo and my allowance ran out..."></textarea>
        <p style={{ marginTop: '14px' }}><button>Send appeal</button></p>
      </form>
      <div id="out"></div>
    </div>
    <p className="note"><a href="/">Back</a></p>
    <ScriptEngine srcs={['/engines/appeal.js']} />
  </>);
}
