import Link from 'next/link';
import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-in">
        <div>
          <Logo size={22} />
          <p>Checks that a live human is present, gives honest agents a signed lane, and caps what any one actor can take.</p>
        </div>
        <div>
          <h4>Product</h4>
          <Link href="/check">Risk ladder</Link>
          <Link href="/audit">Bot cost audit</Link>
          <Link href="/voice">Voice path</Link>
          <Link href="/agent">Agent lane</Link>
          <Link href="/scraper">Scraper shield</Link>
        </div>
        <div>
          <h4>Live</h4>
          <Link href="/arena">Arena</Link>
          <Link href="/dashboard">Console</Link>
          <Link href="/appeal">Appeal a block</Link>
        </div>
        <div>
          <h4>Builders</h4>
          <Link href="/integrations">Integrations</Link>
          <Link href="/analytics">Analytics</Link>
          <Link href="/how">How it works</Link>
          <a href="https://github.com/itz-kirankumar/CaptchaMe">GitHub</a>
        </div>
      </div>
    </footer>
  );
}
