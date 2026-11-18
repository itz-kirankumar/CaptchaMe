// The mark: a tracking ring with a dot that lags behind it. Human reaction
// lag is the signal CaptchaMe reads, so the lag is the logo.
export function Mark({ size = 26, className = '' }) {
  return (
    <svg className={'mark ' + className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--brand)" strokeOpacity=".3" strokeWidth="3" />
      <path d="M12.24 5.66A11 11 0 0 1 23.78 8.22" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="23.78" cy="8.22" r="3.4" fill="var(--brand)" />
    </svg>
  );
}

export default function Logo({ size = 26 }) {
  return (
    <span className="logo">
      <Mark size={size} />
      <span className="wordmark">captcha<b>me</b></span>
    </span>
  );
}
