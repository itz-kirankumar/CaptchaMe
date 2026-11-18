import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-in" style={{ gridTemplateColumns: '1fr', justifyItems: 'center', textAlign: 'center' }}>
        <div>
          <Logo size={22} />
          <p>Checks that a live human is present, then shows who really was behind every request.</p>
        </div>
      </div>
    </footer>
  );
}
