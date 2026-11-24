import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import {
  LOCALE_FLAGS,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  SUPPORTED_LOCALES,
  type Locale,
} from '~/lib/locale';
import { useLocale } from '~/lib/i18n-context';
import { persistLocaleAndGo } from '~/lib/switch-locale.client';

export function LocaleSwitcher({
  variant = 'header',
}: {
  variant?: 'header' | 'footer';
}) {
  const current = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  async function pick(next: Locale) {
    if (next === current || busy) {
      setOpen(false);
      return;
    }
    setBusy(true);
    await persistLocaleAndGo(next);
  }

  const buttonStyle: React.CSSProperties =
    variant === 'header'
      ? {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          color: 'var(--ink-2)',
          background: 'transparent',
          border: '1px solid var(--line)',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
        }
      : {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          color: 'var(--ink-3)',
          background: 'transparent',
          border: '1px solid var(--line)',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
        };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        onClick={() => setOpen((v) => !v)}
        style={buttonStyle}
        disabled={busy}
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
          {LOCALE_FLAGS[current]}
        </span>
        <span>{LOCALE_SHORT_LABELS[current]}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 160,
            margin: 0,
            padding: 6,
            listStyle: 'none',
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: '0 16px 40px -12px rgba(0,0,0,0.5)',
            zIndex: 50,
          }}
        >
          {SUPPORTED_LOCALES.map((loc) => {
            const isActive = loc === current;
            return (
              <li key={loc}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => void pick(loc)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink)',
                    fontSize: 13,
                    cursor: 'pointer',
                    borderRadius: 6,
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--surface)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 14 }}>
                      {LOCALE_FLAGS[loc]}
                    </span>
                    <span>{LOCALE_LABELS[loc]}</span>
                  </span>
                  {isActive ? (
                    <Check size={14} color="var(--accent)" aria-hidden="true" />
                  ) : (
                    <span
                      className="mono faint"
                      style={{ fontSize: 11, color: 'var(--ink-4)' }}
                    >
                      {LOCALE_SHORT_LABELS[loc]}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
