import {
  data,
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router';
import { z } from 'zod';
import type { Route } from './+types/login';
import {
  createEmailLoginCode,
  getClientIp,
  normalizeAuthEmail,
} from '~/lib/auth/email-code.server';
import {
  guardOtpRequest,
  logOtpSent,
  maskEmail,
  releaseOtpCooldown,
} from '~/lib/auth/otp-guard.server';
import {
  turnstileSiteKey,
  verifyTurnstile,
} from '~/lib/auth/turnstile.server';
import { getConfig } from '~/lib/config';
import { logger, serializeError } from '~/lib/logger';
import {
  AuthBanner,
  AuthShell,
  GoogleG,
  authPrimaryButton,
} from '~/components/auth/auth-shell';

const schema = z.object({
  email: z.string().email('Zadej platný e-mail.'),
});

type BannerKey =
  | 'oauth'
  | 'google'
  | 'email_unverified'
  | 'invalid'
  | null;

export async function loader({ request }: Route.LoaderArgs) {
  const cfg = getConfig();
  const url = new URL(request.url);
  const err = url.searchParams.get('error');
  let banner: BannerKey = null;
  if (
    err === 'oauth' ||
    err === 'google' ||
    err === 'email_unverified' ||
    err === 'invalid'
  ) {
    banner = err;
  }
  return {
    googleEnabled: Boolean(
      cfg.AUTH_GOOGLE_ID?.trim() && cfg.AUTH_GOOGLE_SECRET?.trim()
    ),
    banner,
    turnstileSiteKey: turnstileSiteKey(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = schema.safeParse({
    email: String(formData.get('email') ?? ''),
  });

  if (!parsed.success) {
    return data(
      {
        ok: false as const,
        error: parsed.error.flatten().formErrors[0] ?? 'Neplatný vstup.',
      },
      { status: 400 }
    );
  }

  const ip = getClientIp(request);
  const norm = normalizeAuthEmail(parsed.data.email);
  const captchaToken = String(formData.get('cf-turnstile-response') ?? '') || null;

  // Vrstvená ochrana: kill switch → per-IP → CAPTCHA → per-e-mail (cooldown/limit) → globální pojistka.
  const decision = await guardOtpRequest({
    ip,
    email: norm,
    verifyCaptcha: () => verifyTurnstile(captchaToken, ip),
  });

  if (!decision.ok) {
    // Generický redirect na verify (anti-enumeration / dedup) — nic nového neodesíláme.
    if (decision.kind === 'redirect_verify') {
      throw redirect(`/login/verify?${new URLSearchParams({ email: norm })}`);
    }
    return data(
      { ok: false as const, error: decision.message },
      { status: decision.status }
    );
  }

  const code = await createEmailLoginCode(norm, ip);

  try {
    const { sendLoginCodeEmail } = await import(
      '~/lib/email/send-login-code.server'
    );
    await sendLoginCodeEmail({ email: norm, code });
  } catch (err) {
    // Odeslání selhalo → uvolni cooldown, ať uživatel může hned zkusit znovu.
    await releaseOtpCooldown(norm);
    logger.error(
      { err: serializeError(err), email: maskEmail(norm) },
      '[login] sendLoginCodeEmail failed'
    );
    return data(
      {
        ok: false as const,
        error: 'Nepodařilo se odeslat e-mail. Zkuste to prosím za chvíli.',
      },
      { status: 502 }
    );
  }

  logOtpSent({ ip, email: norm });
  const params = new URLSearchParams({ email: norm });
  throw redirect(`/login/verify?${params.toString()}`);
}

export default function LoginRoute() {
  const actionData = useActionData<typeof action>();
  const { googleEnabled, banner, turnstileSiteKey } =
    useLoaderData<typeof loader>();
  const nav = useNavigation();
  const submitting = nav.state !== 'idle';

  const inkLabel = '#FAFAFA';
  const ink2 = '#A1A1AA';
  const line = 'rgba(255,255,255,0.12)';

  return (
    <AuthShell>
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            margin: 0,
            marginBottom: 8,
            color: inkLabel,
          }}
        >
          Vítejte zpět.
        </h1>
        <p
          style={{
            color: ink2,
            fontSize: 14.5,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Přihlaste se k Pulsu &mdash; MCP serveru pro váš e-shop.
        </p>
      </div>

      {banner === 'google' && (
        <AuthBanner
          tone="warn"
          title="Google OAuth není nakonfigurovaný"
          body="Zatím je dostupné jen přihlášení e-mailem."
        />
      )}
      {banner === 'oauth' && (
        <AuthBanner
          tone="err"
          title="Přihlášení přes Google se nepodařilo"
          body="Zkuste to prosím znovu."
        />
      )}
      {banner === 'email_unverified' && (
        <AuthBanner
          tone="err"
          title="Google účet nemá ověřený e-mail"
          body="Použijte přihlášení e-mailem — pošleme vám jednorázový kód."
        />
      )}
      {banner === 'invalid' && (
        <AuthBanner
          tone="err"
          title="Neplatný nebo expirovaný odkaz"
          body="Začněte přihlášení znovu."
        />
      )}
      {actionData && !actionData.ok && 'error' in actionData ? (
        <AuthBanner tone="err" title={actionData.error} />
      ) : null}

      <a
        href="/auth/google"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '12px 14px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.06)',
          color: inkLabel,
          border: `1px solid ${line}`,
          textDecoration: 'none',
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        <GoogleG />
        Pokračovat přes Google
      </a>
      {!googleEnabled && (
        <p
          style={{
            fontSize: 11.5,
            color: ink2,
            marginTop: 8,
            marginBottom: 0,
            textAlign: 'center',
          }}
        >
          Google přihlášení dočasně nedostupné. Použijte e-mail níže.
        </p>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '24px 0 20px',
        }}
      >
        <div style={{ flex: 1, height: 1, background: line }} />
        <span
          style={{
            fontSize: 11,
            color: ink2,
            fontFamily: 'var(--mono)',
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
          }}
        >
          nebo e-mailem
        </span>
        <div style={{ flex: 1, height: 1, background: line }} />
      </div>

      <Form method="post">
        <label
          htmlFor="email"
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 6,
            color: inkLabel,
          }}
        >
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="vy@vas-eshop.cz"
          style={{
            width: '100%',
            padding: '11px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            color: inkLabel,
            border: `1px solid ${line}`,
            fontSize: 14,
            fontFamily: 'var(--font)',
            outline: 'none',
          }}
        />
        {turnstileSiteKey ? (
          <>
            <div
              className="cf-turnstile"
              data-sitekey={turnstileSiteKey}
              data-theme="dark"
              style={{ marginTop: 14 }}
            />
            <script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              async
              defer
            />
          </>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          style={{
            ...authPrimaryButton,
            marginTop: 14,
            opacity: submitting ? 0.7 : 1,
            cursor: submitting ? 'progress' : 'pointer',
          }}
        >
          {submitting ? 'Odesílám…' : 'Poslat kód'}
          {!submitting && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="4" y1="12" x2="20" y2="12" />
              <polyline points="14 6 20 12 14 18" />
            </svg>
          )}
        </button>
      </Form>
    </AuthShell>
  );
}
