import './globals.css';

export const metadata = {
  title: { default: 'CaptchaMe - Bots, go ahead. Try.', template: '%s - CaptchaMe' },
  description: 'CaptchaMe verifies a live human is present. Bots, scripts and solvers fail; honest AI agents get a signed lane of their own.',
  icons: { icon: [{ url: '/logo.svg', type: 'image/svg+xml' }] },
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700;800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
        <main>{children}</main>
      </body>
    </html>
  );
}
