import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { Route } from './+types/login.verify';
import {
  consumeEmailLoginCode,
  normalizeAuthEmail,
} from '~/lib/auth/email-code.server';
import { ensureUserByEmail } from '~/lib/auth/ensure-user.server';
import { createUserSession } from '~/lib/auth/session.server';
import { getDb } from '~/lib/db';
import {
  AuthBanner,
  AuthEyebrow,
  AuthShell,
  authPrimaryButton,
} from '~/components/auth/auth-shell';

const SLOT_COUNT = 6;
const ACCENT = '#67E8F9';
const INK = '#FAFAFA';
const INK_2 = '#A1A1AA';
const LINE = 'rgba(255,255,255,0.10)';

function maskEmail(email: string): string {
  const [a, domain] = email.split('@');
  if (!domain || !a) return '***';
  const head = a.slice(0, 2);
  return `${head}***@${domain}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('email');
  if (!raw) throw redirect('/login');
  const email = normalizeAuthEmail(raw);
  return { email, masked: maskEmail(email) };
}

const schema = z.object({
  email: z.string().email(),
  code: z.string().min(6).max(8),
});

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = schema.safeParse({
    email: String(formData.get('email') ?? ''),
    code: String(formData.get('code') ?? '').trim(),
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      error: 'Zadej platný kód (6 znaků).',
    };
  }

  const consumed = await consumeEmailLoginCode(
    parsed.data.email,
    parsed.data.code
  );
  if (!consumed.ok) {
    const msg =
      consumed.reason === 'wrong_code'
        ? 'Neplatný kód.'
        : consumed.reason === 'too_many_attempts'
          ? 'Příliš mnoho pokusů. Požádejte o nový kód.'
          : 'Kód vypršel nebo neexistuje. Požádejte o nový.';
    return { ok: false as const, error: msg };
  }

  const db = getDb();
  const userId = await ensureUserByEmail(db, parsed.data.email);
  const { setCookie } = await createUserSession(db, userId);

  const headers = new Headers();
  headers.append('Location', '/dashboard');
  headers.append('Set-Cookie', setCookie);
  return new Response(null, { status: 302, headers });
}

export default function LoginVerifyRoute() {
  const { email, masked } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state !== 'idle';

  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => code[i] ?? '');
  const focusIndex = Math.min(code.length, SLOT_COUNT - 1);

  return (
    <AuthShell>
      <div style={{ marginBottom: 28 }}>
        <AuthEyebrow>Krok 2 / 2 · Ověření</AuthEyebrow>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            margin: 0,
            marginBottom: 8,
            color: INK,
          }}
        >
          Zadejte kód z e-mailu.
        </h1>
        <p
          style={{
            color: INK_2,
            fontSize: 14.5,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Poslali jsme šestimístný kód na{' '}
          <b style={{ color: INK }}>{masked}</b>. Platí 10 minut.
        </p>
      </div>

      {actionData && !actionData.ok ? (
        <AuthBanner
          tone="err"
          title="Kód nesedí"
          body={actionData.error}
        />
      ) : null}

      <Form method="post" style={{ position: 'relative' }}>
        <input type="hidden" name="email" value={email} />
        <label
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 8,
            color: INK,
          }}
          onClick={() => inputRef.current?.focus()}
        >
          Kód
        </label>
        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${SLOT_COUNT}, 1fr)`,
            gap: 8,
            marginBottom: 6,
            background: 'transparent',
            border: 'none',
            padding: 0,
            width: '100%',
            cursor: 'text',
          }}
          aria-label="Zaměřit pole pro zadání kódu"
        >
          {slots.map((v, i) => {
            const focused = i === focusIndex && code.length < SLOT_COUNT;
            return (
              <span
                key={i}
                style={{
                  aspectRatio: '1 / 1.15',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${focused ? ACCENT : LINE}`,
                  boxShadow: focused
                    ? '0 0 0 4px rgba(103,232,249,0.15)'
                    : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--mono)',
                  fontSize: 24,
                  fontWeight: 500,
                  color: INK,
                }}
              >
                {v ? (
                  v
                ) : focused ? (
                  <span
                    style={{
                      width: 1.5,
                      height: 22,
                      background: ACCENT,
                      animation: 'pulsBlink 1s steps(2) infinite',
                    }}
                  />
                ) : (
                  <span style={{ color: INK_2, opacity: 0.3 }}>•</span>
                )}
              </span>
            );
          })}
        </button>
        <input
          ref={inputRef}
          name="code"
          value={code}
          onChange={(e) => {
            const cleaned = e.target.value
              .replace(/[^a-zA-Z0-9]/g, '')
              .toUpperCase()
              .slice(0, 8);
            setCode(cleaned);
          }}
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          minLength={6}
          maxLength={8}
          style={{
            position: 'absolute',
            left: -9999,
            top: 0,
            opacity: 0,
            width: 1,
            height: 1,
          }}
          required
        />
        <p style={{ fontSize: 11.5, color: INK_2, marginTop: 0, marginBottom: 18 }}>
          Bez nul a jedniček &mdash; používáme jen znaky, které nejde splést.{' '}
          <span className="mono" style={{ color: INK }}>
            A–Z, 2–9
          </span>
        </p>
        <button
          type="submit"
          disabled={submitting || code.length < SLOT_COUNT}
          style={{
            ...authPrimaryButton,
            opacity: submitting || code.length < SLOT_COUNT ? 0.6 : 1,
            cursor:
              submitting || code.length < SLOT_COUNT ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Ověřuji…' : 'Přihlásit se'}
        </button>
      </Form>

      <div
        style={{
          marginTop: 22,
          paddingTop: 18,
          borderTop: `1px solid ${LINE}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        <Link
          to="/login"
          style={{ color: INK_2, textDecoration: 'none' }}
        >
          ← Poslat nový kód
        </Link>
        <span
          style={{
            color: INK_2,
            fontSize: 11.5,
            fontFamily: 'var(--mono)',
          }}
        >
          platí 10 minut
        </span>
      </div>
    </AuthShell>
  );
}
