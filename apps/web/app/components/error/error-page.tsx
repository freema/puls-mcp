import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { PulsLogo } from '~/components/puls-logo';

export type ErrorIllustrationKind =
  | 'lost'
  | 'broken'
  | 'forbidden'
  | 'maintenance';

export type ErrorTone = 'warn' | 'err' | 'info' | 'accent';

export interface ErrorAction {
  to: string;
  label: string;
  external?: boolean;
}

export interface ErrorPageProps {
  code: number | string;
  title: string;
  description: string;
  primary?: ErrorAction;
  secondary?: ErrorAction;
  illustration?: ErrorIllustrationKind;
  tone?: ErrorTone;
  requestId?: string;
}

export function ErrorPage({
  code,
  title,
  description,
  primary,
  secondary,
  illustration,
  requestId,
}: ErrorPageProps) {
  return (
    <div
      style={{
        background: 'var(--bg)',
        color: 'var(--ink)',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        className="glow"
        style={{
          position: 'absolute',
          inset: '0 0 auto 0',
          height: 720,
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.5,
          pointerEvents: 'none',
          backgroundImage:
            'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 70%)',
        }}
      />

      <header
        style={{
          position: 'relative',
          padding: '22px clamp(20px, 4vw, 40px)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <Link
          to="/"
          style={{ color: 'var(--ink)', textDecoration: 'none' }}
          aria-label="Puls MCP — domů"
        >
          <PulsLogo />
        </Link>
        <nav
          className="row gap-20"
          style={{ fontSize: 13, color: 'var(--ink-3)' }}
        >
          <Link
            to="/dashboard"
            style={{ color: 'var(--ink-3)', textDecoration: 'none' }}
          >
            Dashboard
          </Link>
        </nav>
      </header>

      <main
        style={{
          flex: 1,
          position: 'relative',
          padding: '64px clamp(20px, 4vw, 40px)',
          display: 'grid',
          gridTemplateColumns: illustration ? '1.05fr 0.95fr' : '1fr',
          gap: 56,
          alignItems: 'center',
          maxWidth: 1200,
          width: '100%',
          margin: '0 auto',
        }}
        className="error-main"
      >
        <div className="col gap-20">
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 'clamp(96px, 16vw, 168px)',
              fontWeight: 500,
              lineHeight: 0.9,
              letterSpacing: '-0.06em',
              backgroundImage:
                'linear-gradient(180deg, var(--accent), var(--accent) 40%, transparent 95%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              marginBottom: 4,
            }}
          >
            {code}
          </div>

          <h1
            className="h-display"
            style={{
              fontSize: 'clamp(32px, 5vw, 56px)',
              lineHeight: 1.05,
              textWrap: 'balance',
              maxWidth: 580,
            }}
          >
            {title}
          </h1>
          <p className="lede" style={{ maxWidth: 520, marginTop: -8 }}>
            {description}
          </p>

          <div
            className="row gap-12"
            style={{ marginTop: 12, flexWrap: 'wrap' }}
          >
            {primary ? <ActionButton action={primary} variant="primary" /> : null}
            {secondary ? <ActionButton action={secondary} variant="ghost" /> : null}
          </div>

          <div
            className="row gap-20"
            style={{
              marginTop: 24,
              fontSize: 12.5,
              color: 'var(--ink-3)',
              flexWrap: 'wrap',
            }}
          >
            <Link
              to="/"
              style={{ color: 'var(--ink-3)', textDecoration: 'none' }}
            >
              Domů
            </Link>
            <span className="faint">·</span>
            <Link
              to="/dashboard"
              style={{ color: 'var(--ink-3)', textDecoration: 'none' }}
            >
              Dashboard
            </Link>
          </div>
        </div>

        {illustration ? <ErrorIllustration kind={illustration} /> : null}
      </main>

      <footer
        style={{
          position: 'relative',
          padding: '20px clamp(20px, 4vw, 40px)',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11.5,
          color: 'var(--ink-4)',
          fontFamily: 'var(--mono)',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <span>{requestId ? `req-id: ${requestId}` : 'puls-mcp'}</span>
        <span>puls-mcp · v1.0.0</span>
      </footer>
    </div>
  );
}

function ActionButton({
  action,
  variant,
}: {
  action: ErrorAction;
  variant: 'primary' | 'ghost';
}) {
  const className =
    variant === 'primary' ? 'btn btn-primary btn-lg' : 'btn btn-ghost btn-lg';
  if (action.external) {
    return (
      <a
        className={className}
        href={action.to}
        target="_blank"
        rel="noopener noreferrer"
      >
        {action.label}
        {variant === 'primary' ? <ArrowRight size={16} /> : null}
      </a>
    );
  }
  return (
    <Link className={className} to={action.to}>
      {action.label}
      {variant === 'primary' ? <ArrowRight size={16} /> : null}
    </Link>
  );
}

function ErrorIllustration({ kind }: { kind: ErrorIllustrationKind }) {
  const stroke = 'var(--accent)';
  const muted = 'var(--line-2)';
  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        maxWidth: 420,
        width: '100%',
        justifySelf: 'center',
      }}
      aria-hidden
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle, rgba(255,122,61,0.12), transparent 60%)',
          filter: 'blur(20px)',
        }}
      />
      {kind === 'lost' ? (
        <svg
          viewBox="0 0 200 200"
          style={{ width: '100%', height: '100%', position: 'relative' }}
        >
          <circle
            cx="100"
            cy="100"
            r="78"
            fill="none"
            stroke={muted}
            strokeWidth="0.6"
          />
          <circle
            cx="100"
            cy="100"
            r="58"
            fill="none"
            stroke={muted}
            strokeWidth="0.6"
            strokeDasharray="2 4"
          />
          <circle
            cx="100"
            cy="100"
            r="38"
            fill="none"
            stroke={muted}
            strokeWidth="0.6"
          />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line
              key={a}
              x1="100"
              y1="100"
              x2={100 + 78 * Math.cos(((a - 90) * Math.PI) / 180)}
              y2={100 + 78 * Math.sin(((a - 90) * Math.PI) / 180)}
              stroke={muted}
              strokeWidth="0.4"
            />
          ))}
          <g
            style={{
              transformOrigin: '100px 100px',
              animation: 'errLost 4s ease-in-out infinite',
            }}
          >
            <polygon points="100,42 96,100 100,108 104,100" fill={stroke} />
            <polygon
              points="100,158 96,100 100,92 104,100"
              fill="var(--ink-3)"
            />
            <circle
              cx="100"
              cy="100"
              r="5"
              fill="var(--bg)"
              stroke={stroke}
              strokeWidth="1.5"
            />
          </g>
          <text
            x="100"
            y="32"
            fontSize="9"
            fill="var(--ink-3)"
            textAnchor="middle"
            fontFamily="var(--mono)"
          >
            N
          </text>
          <text
            x="100"
            y="178"
            fontSize="9"
            fill="var(--ink-3)"
            textAnchor="middle"
            fontFamily="var(--mono)"
          >
            S
          </text>
        </svg>
      ) : null}

      {kind === 'broken' ? (
        <svg
          viewBox="0 0 200 200"
          style={{ width: '100%', height: '100%', position: 'relative' }}
        >
          <rect
            x="40"
            y="40"
            width="120"
            height="120"
            rx="14"
            fill="none"
            stroke={muted}
            strokeWidth="1"
          />
          <path
            d="M40 90 L96 100 L80 130 L120 110 L160 160"
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx="96" cy="100" r="3" fill={stroke} />
          <circle cx="80" cy="130" r="3" fill={stroke} />
          <circle cx="120" cy="110" r="3" fill={stroke} />
          <g
            style={{
              transformOrigin: '100px 100px',
              animation: 'errSpark 1.4s ease-out infinite',
            }}
          >
            <circle cx="100" cy="100" r="5" fill={stroke} opacity="0.4" />
          </g>
          <text
            x="100"
            y="184"
            fontSize="8"
            fill="var(--ink-3)"
            textAnchor="middle"
            fontFamily="var(--mono)"
          >
            SIG ABRT
          </text>
        </svg>
      ) : null}

      {kind === 'forbidden' ? (
        <svg
          viewBox="0 0 200 200"
          style={{ width: '100%', height: '100%', position: 'relative' }}
        >
          <circle
            cx="100"
            cy="100"
            r="72"
            fill="none"
            stroke={muted}
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          <rect
            x="62"
            y="86"
            width="76"
            height="56"
            rx="8"
            fill="none"
            stroke={stroke}
            strokeWidth="2"
          />
          <path
            d="M76 86 V72 a24 24 0 0 1 48 0 V86"
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="100" cy="114" r="4" fill={stroke} />
          <line
            x1="100"
            y1="114"
            x2="100"
            y2="128"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      ) : null}

      {kind === 'maintenance' ? (
        <svg
          viewBox="0 0 200 200"
          style={{ width: '100%', height: '100%', position: 'relative' }}
        >
          <rect
            x="46"
            y="58"
            width="108"
            height="22"
            rx="4"
            fill="none"
            stroke={muted}
            strokeWidth="1"
          />
          <rect
            x="46"
            y="86"
            width="108"
            height="22"
            rx="4"
            fill="none"
            stroke={muted}
            strokeWidth="1"
          />
          <rect
            x="46"
            y="114"
            width="108"
            height="22"
            rx="4"
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
          />
          <circle cx="56" cy="69" r="2" fill={stroke}>
            <animate
              attributeName="opacity"
              values="1;0.3;1"
              dur="1.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="56" cy="97" r="2" fill="var(--ink-3)" />
          <circle cx="56" cy="125" r="2" fill={stroke} />
          <g
            style={{
              transformOrigin: '150px 50px',
              animation: 'errSpin 9s linear infinite',
            }}
          >
            <path
              d="M150 30 L154 30 L155 36 A14 14 0 0 1 162 40 L168 38 L170 42 L165 46 A14 14 0 0 1 165 54 L170 58 L168 62 L162 60 A14 14 0 0 1 155 64 L154 70 L146 70 L145 64 A14 14 0 0 1 138 60 L132 62 L130 58 L135 54 A14 14 0 0 1 135 46 L130 42 L132 38 L138 40 A14 14 0 0 1 145 36 Z"
              fill="none"
              stroke={stroke}
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle
              cx="150"
              cy="50"
              r="4"
              fill="none"
              stroke={stroke}
              strokeWidth="1.4"
            />
          </g>
          <polygon points="40 152 56 152 50 132" fill={stroke} opacity="0.85" />
          <rect x="44" y="152" width="8" height="6" fill="var(--ink-3)" />
        </svg>
      ) : null}
    </div>
  );
}
