import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type NiceSelectOption = {
  value: string;
  label: string;
  hint?: string;
};

type NiceSelectProps = {
  /** Form field name. Submitted via a hidden input so server actions don't change. */
  name: string;
  /** Initial value. The component is uncontrolled by default. */
  defaultValue?: string;
  /** Optional controlled value. */
  value?: string;
  onChange?: (value: string) => void;
  options: NiceSelectOption[];
  /** Placeholder shown when value === ''. */
  placeholder?: string;
  /** ARIA label for the trigger button. */
  ariaLabel?: string;
  required?: boolean;
  disabled?: boolean;
  /** Visual width — defaults to "100%" so it fills its grid cell. */
  width?: number | string;
  className?: string;
};

/**
 * Custom dropdown that hides the browser-default <select> chrome but keeps
 * form submissions working through a hidden input. SSR-safe — first render
 * produces the closed state, hydration enables the popover.
 */
export function NiceSelect({
  name,
  defaultValue,
  value,
  onChange,
  options,
  placeholder = '— vyberte —',
  ariaLabel,
  required,
  disabled,
  width = '100%',
  className,
}: NiceSelectProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const id = useId();
  const current = isControlled ? value! : internal;
  const selected = useMemo(
    () => options.find((o) => o.value === current) ?? null,
    [options, current]
  );

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, options.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = options[highlight];
        if (opt) commit(opt.value);
      }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, options, highlight]);

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === current);
    setHighlight(idx >= 0 ? idx : 0);
  }, [open, options, current]);

  function commit(next: string) {
    if (!isControlled) setInternal(next);
    onChange?.(next);
    setOpen(false);
  }

  const triggerStyle: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    color: 'var(--ink)',
    padding: '9px 12px',
    paddingRight: 36,
    borderRadius: 8,
    fontSize: 13,
    textAlign: 'left',
    position: 'relative',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: 'inherit',
    transition: 'border-color 120ms ease, background 120ms ease',
  };

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: 'relative', width: typeof width === 'number' ? width : '100%' }}
    >
      <input
        type="hidden"
        name={name}
        value={current}
        required={required}
      />
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? name}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onMouseEnter={(e) => {
          if (disabled) return;
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line-2)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)';
        }}
        style={triggerStyle}
      >
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selected ? 'var(--ink)' : 'var(--ink-3)',
          }}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
            transition: 'transform 140ms ease',
            color: 'var(--ink-3)',
            pointerEvents: 'none',
          }}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-labelledby={id}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 60,
            margin: 0,
            padding: 4,
            listStyle: 'none',
            background: 'var(--surface-2, var(--surface))',
            border: '1px solid var(--line-2)',
            borderRadius: 10,
            boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {options.length === 0 ? (
            <li
              style={{
                padding: '10px 12px',
                color: 'var(--ink-3)',
                fontSize: 13,
              }}
            >
              Žádné možnosti
            </li>
          ) : (
            options.map((opt, idx) => {
              const isSel = opt.value === current;
              const isHi = idx === highlight;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => {
                    // Prevent the trigger button from losing focus before
                    // the click finishes on iOS Safari.
                    e.preventDefault();
                    commit(opt.value);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 10px',
                    fontSize: 13,
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: isHi
                      ? 'rgba(255, 122, 61, 0.10)'
                      : 'transparent',
                    color: isSel ? 'var(--ink)' : 'var(--ink-2)',
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent)',
                    }}
                  >
                    {isSel ? <Check size={14} /> : null}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {opt.label}
                  </span>
                  {opt.hint ? (
                    <span
                      className="mono"
                      style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
                    >
                      {opt.hint}
                    </span>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
