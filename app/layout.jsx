import './globals.css';
import './skin.css';
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

// Boot screen: shown once per browser session. It only hides (never removes) the node, so React is not disturbed.
const PRE = `(function(){var p=document.getElementById('preload');if(!p)return;try{if(sessionStorage.getItem('cm-pre')||/[?&]embed=/.test(location.search)){p.className='gone';return}sessionStorage.setItem('cm-pre','1')}catch(e){}
var t=document.getElementById('preTxt'),b=document.getElementById('preLog'),W='CAPTCHAME',G='01#$%&@<>/\\\\|',n=0,L=['reading request','sealing challenge','arming layers','ready'],li=0;
var id=setInterval(function(){n++;var s='';for(var k=0;k<W.length;k++)s+=k<n/2?W[k]:G.charAt(Math.floor(Math.random()*G.length));t.textContent=s;if(n%5===0&&li<L.length)b.textContent='> '+L[li++];if(n>=W.length*2+2){clearInterval(id);t.textContent=W}},60);
setTimeout(function(){p.className='out';setTimeout(function(){p.className='gone'},700)},2100)})();`;

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
        <div id="preload" suppressHydrationWarning>
          <div className="pre-in">
            <svg width="72" height="72" viewBox="0 0 32 32" aria-hidden="true"><circle className="pre-ring" cx="16" cy="16" r="11" /><circle className="pre-dot" cx="23.78" cy="8.22" r="2.6" /></svg>
            <div className="pre-txt" id="preTxt">CAPTCHAME</div>
            <div className="pre-bar"><i></i></div>
            <div className="pre-log" id="preLog">&gt; booting</div>
          </div>
          <script dangerouslySetInnerHTML={{ __html: PRE }} />
        </div>
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
