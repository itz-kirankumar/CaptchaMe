import Link from 'next/link';
import ScriptEngine from '../../components/ScriptEngine';
import PageHead from '../../components/PageHead';
export const metadata = { title: 'Appeal' };

export default function Page() {
  return (<>
    <PageHead kicker="Appeal" title="Never a silent block">
      If a cap or a block caught you by mistake, say so. A human reviews every appeal and can overturn it.
    </PageHead>
    <div className="card" style={{ maxWidth: 640 }}>
      <form id="f">
        <label htmlFor="actor">Your actor id (filled in from the link you followed)</label>
        <input id="actor" required autoComplete="off" />
        <label htmlFor="msg">What happened?</label>
        <textarea id="msg" rows="4" required placeholder="I am a real person and my allowance ran out while I was..."></textarea>
        <button>Send appeal</button>
      </form>
      <div id="out" aria-live="polite"></div>
    </div>
    <p className="note"><Link href="/check">Try a check again</Link></p>
    <ScriptEngine srcs={['/engines/appeal.js']} />
  </>);
}
