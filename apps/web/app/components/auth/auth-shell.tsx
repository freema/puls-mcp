import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { PulsLogo } from '~/components/puls-logo';

const AUTH_INK = '#FAFAFA';
const AUTH_INK_2 = '#A1A1AA';
const AUTH_BG = '#09090B';
const AUTH_CARD_BG = 'rgba(24,24,27,0.62)';
const AUTH_LINE = 'rgba(255,255,255,0.08)';
export const AUTH_ACCENT = '#67E8F9';
export const AUTH_ACCENT_INK = '#083344';

export const authStyles = {
  ink: AUTH_INK,
  ink2: AUTH_INK_2,
  line: AUTH_LINE,
  cardBg: AUTH_CARD_BG,
};

function PulseWave() {
  const stroke = AUTH_ACCENT;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      <svg
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMid slice"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0.65,
        }}
      >
        <defs>
          <linearGradient id="pulseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={stroke} stopOpacity="0" />
            <stop offset="40%" stopColor={stroke} stopOpacity="0.5" />
            <stop offset="60%" stopColor={stroke} stopOpacity="0.6" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="pulseGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={stroke} stopOpacity="0" />
            <stop offset="50%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <line
            key={i}
            x1="0"
            x2="800"
            y1={75 + i * 75}
            y2={75 + i * 75}
            stroke={stroke}
            strokeOpacity={0.08}
            strokeWidth="1"
          />
        ))}
        <path
          d="M-50 380 L120 380 L150 360 L180 400 L210 220 L235 460 L260 380 L420 380 L450 350 L480 410 L510 250 L535 420 L560 380 L800 380"
          fill="none"
          stroke="url(#pulseGrad2)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M-50 300 L100 300 L130 280 L160 320 L190 130 L215 460 L240 300 L420 300 L450 270 L480 330 L510 170 L535 420 L560 300 L800 300"
          fill="none"
          stroke="url(#pulseGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g>
          {[120, 290, 460, 630].map((x, i) => (
            <circle
              key={x}
              cx={x}
              cy={300}
              r={i === 1 ? 4 : 2.5}
              fill={stroke}
              opacity={i === 1 ? 0.9 : 0.4}
            >
              <animate
                attributeName="opacity"
                values={i === 1 ? '0.9;0.3;0.9' : '0.4;0.1;0.4'}
                dur={`${2 + i * 0.4}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </g>
      </svg>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '30%',
          width: 560,
          height: 560,
          transform: 'translate(-50%,-50%)',
          background: `radial-gradient(circle, ${stroke}26, transparent 60%)`,
          filter: 'blur(8px)',
        }}
      />
    </div>
  );
}

export function AuthShell({
  children,
  foot,
}: {
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div
      style={{
        background: AUTH_BG,
        color: AUTH_INK,
        minHeight: '100dvh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <PulseWave />
      <header
        style={{
          position: 'relative',
          padding: '24px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Link to="/" style={{ textDecoration: 'none', color: AUTH_INK }}>
          <PulsLogo size={28} />
        </Link>
        <Link
          to="/"
          style={{
            color: AUTH_INK_2,
            fontSize: 13,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          ← Zpět na úvod
        </Link>
      </header>
      <main
        style={{
          position: 'relative',
          padding: '32px 32px 64px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          minHeight: 'calc(100dvh - 80px)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div
            style={{
              background: AUTH_CARD_BG,
              border: `1px solid ${AUTH_LINE}`,
              borderRadius: 18,
              padding: '36px 36px 28px',
              backdropFilter: 'blur(14px) saturate(140%)',
              WebkitBackdropFilter: 'blur(14px) saturate(140%)',
              boxShadow:
                '0 30px 80px -30px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05) inset',
            }}
          >
            {children}
          </div>
          {foot}
        </div>
      </main>
    </div>
  );
}

export function AuthBanner({
  tone = 'err',
  title,
  body,
}: {
  tone?: 'err' | 'warn' | 'info';
  title: string;
  body?: string;
}) {
  const colors = {
    err: {
      bg: 'rgba(239,68,68,0.10)',
      border: 'rgba(239,68,68,0.32)',
      ink: '#FCA5A5',
    },
    warn: {
      bg: 'rgba(251,191,36,0.10)',
      border: 'rgba(251,191,36,0.32)',
      ink: '#FCD34D',
    },
    info: {
      bg: 'rgba(103,232,249,0.10)',
      border: 'rgba(103,232,249,0.32)',
      ink: AUTH_ACCENT,
    },
  }[tone];

  return (
    <div
      role="alert"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 18,
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <div
        style={{
          color: colors.ink,
          fontWeight: 500,
          marginBottom: body ? 2 : 0,
        }}
      >
        {title}
      </div>
      {body && (
        <div style={{ color: AUTH_INK_2, fontSize: 12.5 }}>{body}</div>
      )}
    </div>
  );
}

export function AuthEyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        border: '1px solid rgba(103,232,249,0.32)',
        background: 'rgba(103,232,249,0.08)',
        borderRadius: 999,
        fontSize: 11,
        color: AUTH_ACCENT,
        marginBottom: 18,
        fontFamily: 'var(--mono)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

export function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.4 0 10.3-2.1 14-5.5l-6.5-5.3C29.6 34.7 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.7 2-2 3.8-3.8 5.1l6.5 5.3C42.6 34.7 44 29.7 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export const authPrimaryButton = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  background: AUTH_ACCENT,
  color: AUTH_ACCENT_INK,
  border: 'none',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  boxShadow: '0 8px 24px -8px rgba(103,232,249,0.45)',
} as const;
