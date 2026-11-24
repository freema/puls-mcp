import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  /**
   * Shoptet OAuth addon (install handshake `/api/install`). Volitelné — bez nich
   * běží jen Upgates; Shoptet install pak vrátí srozumitelnou chybu.
   */
  SHOPTET_API_BASE_URL: z.string().url().optional(),
  SHOPTET_CLIENT_ID: z.string().min(1).optional(),
  SHOPTET_CLIENT_SECRET: z.string().min(1).optional(),
  SHOPTET_REDIRECT_URI: z.string().url().optional(),
  /** Upgates Prism mock base URL (E2E) — connector jinak bere z shop.apiBaseUrl. */
  UPGATES_API_BASE_URL: z.string().url().optional(),
  /** Náš identifikátor doplňku přimíchaný do podepsaných dat aktivačních callbacků. */
  UPGATES_SIGNATURE_TOKEN: z.string().min(1).default('puls-upgates-signature-token'),
  /** Override veřejného klíče Upgates (PEM nebo base64 PEM) — E2E/testy. */
  UPGATES_SIGNATURE_PUBKEY: z.string().optional(),
  /** Symetrický klíč pro šifrování credentials (apiKey) — sdílený s mcp službou. */
  CREDENTIALS_ENC_KEY: z.string().optional(),
  /** Veřejný origin webu pro callback URL webhooků (default prod doména). */
  WEB_PUBLIC_ORIGIN: z.string().url().optional(),
  /** Resend API (optional fallback when SMTP is not configured). */
  RESEND_API_KEY: z.string().optional(),
  /** From header for Resend; may be also used as SMTP_FROM fallback. */
  EMAIL_FROM: z.string().optional(),
  /** SMTP; preferred over Resend when host/user/pass set. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  /** Set to 1 to log SMTP sends (subject/recipient). */
  PULS_LOG_MAIL: z.string().optional(),
  /** Cloudflare Turnstile — veřejný site key (frontend widget). */
  TURNSTILE_SITE_KEY: z.string().optional(),
  /** Cloudflare Turnstile — tajný secret key (server-side siteverify). */
  TURNSTILE_SECRET_KEY: z.string().optional(),
  /** Kill switch e-mailového OTP loginu — '1' = okamžitě vypnout odesílání kódů. */
  OTP_LOGIN_DISABLED: z.string().optional(),
  /** Globální pojistka: max OTP e-mailů za hodinu napříč celou aplikací. */
  OTP_GLOBAL_HOURLY_MAX: z.coerce.number().int().min(1).default(50),
  /** Google OAuth sign-in (NextAuth-style env names). */
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  /** When behind reverse proxy with different public URL than request.origin. */
  AUTH_GOOGLE_REDIRECT_URI: z.preprocess((val) => {
    if (val === '' || val === undefined || val === null) return undefined;
    return val;
  }, z.string().url().optional()),
  /** Comma-separated list of admin e-mail addresses (e.g. "a@x.cz,b@y.cz"). */
  ADMIN_EMAIL: z.string().min(1).default('admin@example.com'),
  MCP_INTERNAL_URL: z.string().url().default('http://mcp:3001'),
  MCP_PUBLIC_ORIGIN: z.string().url().default('http://localhost:3001'),
  /** Sentry DSN — when unset, Sentry SDK is a no-op. */
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  /** 0..1 portion of transactions to send to Sentry. */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  /** Override pino log level (default: debug in dev, info in prod). */
  LOG_LEVEL: z.string().optional(),
  /** Bearer token chránící /api/cron endpoint před externím spouštěním. */
  CRON_SECRET: z.string().optional(),
  /** Kolik dní po expiraci trialu mažeme data shopu (default 30). */
  TRIAL_GRACE_DAYS: z.coerce.number().int().min(1).default(30),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getConfig(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Cannot import logger here — config is loaded before logger init in some paths.
    // Use stderr directly so this still surfaces in container logs.
    process.stderr.write(
      `[config] Invalid environment: ${JSON.stringify(parsed.error.flatten())}\n`
    );
    throw new Error('Invalid environment configuration');
  }
  cached = parsed.data;
  return parsed.data;
}

/** @internal Reset cached config — tests only */
export function resetConfigForTests(): void {
  cached = null;
}
