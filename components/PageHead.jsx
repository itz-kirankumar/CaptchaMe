export default function PageHead({ kicker, title, children }) {
  return (
    <div className="pagehead">
      {kicker && <span className="kicker">{kicker}</span>}
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}
