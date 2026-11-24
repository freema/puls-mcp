import { ExternalLink } from 'lucide-react';
import { PulsLogo } from '~/components/puls-logo';

export function EmbedHeader({
  shopId,
  shopName,
  shopStatus,
  quotaUsed,
  quotaTotal = 1000,
}: {
  shopId: string;
  shopName: string;
  shopStatus: string;
  quotaUsed: number;
  quotaTotal?: number;
}) {
  const isActive = shopStatus.toLowerCase() === 'active';
  const quotaPct = Math.min(
    100,
    Math.round((quotaUsed / Math.max(1, quotaTotal)) * 100)
  );
  const quotaLabel =
    quotaUsed === 0 ? 'Zatím nevyužito' : 'Reset denně 00:00 UTC';
  return (
    <div
      className="row between"
      style={{
        marginBottom: 16,
        paddingBottom: 14,
        borderBottom: '1px solid var(--line)',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div className="col gap-4">
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          <PulsLogo size={20} />
          <span
            className={`pill ${isActive ? 'pill-ok' : 'pill-warn'}`}
            style={{ fontSize: 10 }}
          >
            <span
              className={`dot ${isActive ? 'dot-ok' : 'dot-warn'}`}
              aria-hidden
            />
            {isActive ? 'Aktivní' : shopStatus}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          Embedded v adminu e-shopu · {shopName}
        </span>
      </div>
      <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
        <div
          className="row gap-10"
          title={`${quotaUsed} / ${quotaTotal} MCP volání · ${quotaLabel}`}
          style={{
            padding: '6px 12px',
            border: '1px solid var(--line)',
            borderRadius: 999,
            background: 'var(--surface)',
            minWidth: 168,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              letterSpacing: '0.12em',
            }}
          >
            QUOTA
          </span>
          <div
            style={{
              flex: 1,
              height: 4,
              background: 'var(--bg-3)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${quotaPct}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
            }}
          >
            {quotaUsed} / {quotaTotal}
          </span>
        </div>
        <a
          href={`/dashboard/${shopId}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-soft btn-sm"
          data-testid="open-full-dashboard"
        >
          Otevřít plný přehled <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

export function EmbedFooter() {
  const linkStyle = {
    color: 'var(--ink-3)',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  } as const;
  return (
    <div
      className="row gap-12"
      style={{
        marginTop: 12,
        paddingTop: 14,
        borderTop: '1px solid var(--line)',
        fontSize: 11,
        color: 'var(--ink-3)',
        flexWrap: 'wrap',
      }}
    >
      <a
        href="mailto:support@example.com"
        style={linkStyle}
      >
        Podpora
      </a>
      <span style={{ flex: 1 }} />
      <span className="mono">v1.0.0</span>
    </div>
  );
}
