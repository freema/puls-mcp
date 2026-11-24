import { useEffect, useRef, useState } from 'react';
import { Form, Link } from 'react-router';
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  Store,
} from 'lucide-react';

type Variant = 'pill' | 'compact';

export type UserMenuProps = {
  email: string;
  isAdmin?: boolean;
  /** Variant: "pill" (rounded with email visible), "compact" (just avatar). */
  variant?: Variant;
  /** Optional override for displayed name next to the avatar (pill variant). */
  displayName?: string;
};

function userInitials(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (local.slice(0, 2) || '··').toUpperCase();
}

export function UserMenu({
  email,
  isAdmin = false,
  variant = 'pill',
  displayName,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = userInitials(email);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const avatar = (
    <span
      aria-hidden
      style={{
        width: variant === 'compact' ? 24 : 26,
        height: variant === 'compact' ? 24 : 26,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #FF7A3D, #FF5A1F)',
        color: 'white',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: variant === 'compact' ? 10 : 11,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="row gap-8"
        style={{
          padding:
            variant === 'compact' ? '4px 8px 4px 4px' : '6px 10px 6px 6px',
          background: 'var(--surface)',
          borderRadius: 999,
          border: '1px solid var(--line)',
          color: 'var(--ink)',
          cursor: 'pointer',
          minWidth: 0,
        }}
      >
        {avatar}
        <span
          style={{
            fontSize: variant === 'compact' ? 12 : 13,
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          className={variant === 'compact' ? 'muted' : undefined}
        >
          {displayName ?? email}
        </span>
        <ChevronDown
          size={14}
          color="var(--ink-3)"
          style={{
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 0.15s ease',
            flexShrink: 0,
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 240,
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
            padding: 6,
            zIndex: 60,
          }}
        >
          <div
            style={{
              padding: '10px 12px 12px',
              borderBottom: '1px solid var(--line)',
              marginBottom: 6,
            }}
          >
            <div className="row gap-10">
              {avatar}
              <div className="col gap-2" style={{ minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {email}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: isAdmin ? 'var(--accent)' : 'var(--ink-3)',
                    letterSpacing: '0.10em',
                    textTransform: 'uppercase',
                  }}
                >
                  {isAdmin ? 'Admin' : 'Účet'}
                </span>
              </div>
            </div>
          </div>

          {isAdmin ? (
            <>
              <MenuLink to="/admin" onClick={() => setOpen(false)}>
                <Shield size={14} /> Admin přehled
              </MenuLink>
              <MenuLink to="/dashboard" onClick={() => setOpen(false)}>
                <LayoutDashboard size={14} /> Můj dashboard
              </MenuLink>
              <MenuLink to="/dashboard/select" onClick={() => setOpen(false)}>
                <Store size={14} /> Vybrat obchod
              </MenuLink>
            </>
          ) : (
            <>
              <MenuLink to="/dashboard" onClick={() => setOpen(false)}>
                <LayoutDashboard size={14} /> Dashboard
              </MenuLink>
              <MenuLink to="/dashboard/select" onClick={() => setOpen(false)}>
                <Store size={14} /> Vybrat obchod
              </MenuLink>
            </>
          )}
          <MenuLink to="/nastaveni" onClick={() => setOpen(false)}>
            <Settings size={14} /> Nastavení
          </MenuLink>

          <div
            style={{
              borderTop: '1px solid var(--line)',
              marginTop: 6,
              paddingTop: 6,
            }}
          >
            <Form method="post" action="/auth/logout" reloadDocument>
              <button
                type="submit"
                role="menuitem"
                className="row gap-10"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: 'var(--err)',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--surface)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <LogOut size={14} /> Odhlásit se
              </button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  to,
  onClick,
  children,
}: {
  to: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className="row gap-10"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 6,
        color: 'var(--ink)',
        textDecoration: 'none',
        fontSize: 13,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </Link>
  );
}
