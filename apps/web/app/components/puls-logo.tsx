export function PulsLogo({ size = 28 }: { size?: number }) {
  const inner = Math.round(size * 0.55);
  return (
    <span
      className="row gap-10"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}
    >
      <span
        className="logo-mark"
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          fontSize: Math.round(size * 0.5),
        }}
      >
        <svg
          width={inner}
          height={inner}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />
        </svg>
      </span>
      <span
        style={{
          fontWeight: 600,
          fontSize: Math.round(size * 0.6),
          letterSpacing: '-0.02em',
        }}
      >
        Puls
      </span>
    </span>
  );
}
