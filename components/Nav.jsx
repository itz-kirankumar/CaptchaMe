'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Logo from './Logo';

export const LINKS = [
  ['/check', 'Risk ladder'],
  ['/live', 'Live run'],
  ['/layer2', 'Layer 2'],
  ['/audit', 'Audit'],
  ['/arena', 'Arena'],
  ['/scraper', 'Scraper shield'],
  ['/agent', 'Agent lane'],
  ['/integrations', 'Integrations'],
  ['/analytics', 'Analytics'],
];

export default function Nav() {
  const path = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  useEffect(() => { setTheme(document.documentElement.dataset.theme || 'dark'); }, []);
  useEffect(() => { setOpen(false); }, [path]);

  function flip() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('cm-theme', next); } catch { /* private mode */ }
    setTheme(next);
    window.dispatchEvent(new Event('cm-theme'));
  }

  return (
    <header className="nav">
      <div className="nav-in">
        <Link className="home" href="/" aria-label="CaptchaMe home"><Logo /></Link>
        <nav className="links" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={path.startsWith(href) ? 'on' : ''}>{label}</Link>
          ))}
        </nav>
        <div className="right">
          <button className="iconbtn" onClick={flip} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title="Theme">
            {theme === 'dark'
              ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>}
          </button>
          <a className="iconbtn" href="https://github.com/itz-kirankumar/CaptchaMe" aria-label="GitHub repository">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1 1.6 1 .9 1.5 2.3 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.5-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z" /></svg>
          </a>
          <Link className="btn sm" href="/check">Try it</Link>
          <button className="iconbtn menu-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
          </button>
        </div>
      </div>
      <nav className={'mobile-menu' + (open ? ' open' : '')} aria-label="Mobile">
        {LINKS.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
    </header>
  );
}
