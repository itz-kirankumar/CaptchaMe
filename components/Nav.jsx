import Link from 'next/link';

export default function Nav({ links = [] }) {
  return (
    <nav className="nav">
      <Link className="brand" href="/"><img src="/logo.svg" width="26" height="26" alt="" />CaptchaMe</Link>
      <div className="links">
        {links.map(([href, label]) => href.startsWith('http')
          ? <a key={href} href={href}>{label}</a>
          : <Link key={href} href={href}>{label}</Link>)}
      </div>
    </nav>
  );
}
