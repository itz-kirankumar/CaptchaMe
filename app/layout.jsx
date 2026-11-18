import './globals.css';
import Nav from '../components/Nav';
import Footer from '../components/Footer';

export const metadata = {
  title: { default: 'CaptchaMe - Bots, go ahead. Try.', template: '%s - CaptchaMe' },
  description: 'CaptchaMe checks that a live human is present, not that someone can solve a puzzle. Scripts, solver services and AI agents fail; honest agents get a signed lane; a fair-share ledger caps what any one actor can take.',
  icons: { icon: [{ url: '/logo.svg', type: 'image/svg+xml' }] },
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#07080c' };

// Runs before paint: theme from the visitor's last choice, and embed mode
// when the page is shown inside a customer's iframe.
const BOOT = `(function(){try{var t=localStorage.getItem('cm-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}if(/[?&]embed=/.test(location.search))document.documentElement.classList.add('embed');})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
