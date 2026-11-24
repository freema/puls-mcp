import { createHash } from 'node:crypto';
import { getRedis } from '~/lib/redis';
import { getConfig } from '~/lib/config';
import { logger, serializeError } from '~/lib/logger';
import { rateLimitRedis } from '~/lib/rate-limit.server';

/**
 * Vrstvená ochrana endpointu, který spouští odeslání e-mailového OTP kódu,
 * proti zneužití ("OTP bombing"). Všechny čítače jsou v Redis (atomický INCR /
 * SET NX) — žádné DB count dotazy, takže to nemá race conditions a chrání to
 * doručovací schránku před opakovaným suspendem.
 *
 * Pořadí kontrol (od nejlevnější po nejdražší, fail-fast):
 *   0. kill switch / globální auto-pauza
 *   1. per-IP krátké okno   (5 / 15 min)
 *   2. per-IP denní okno     (20 / 24 h)
 *   3. CAPTCHA (Cloudflare Turnstile) — až po levné IP bráně, před jakoukoli prací s e-mailem
 *   4. per-e-mail cooldown   (min. 60 s mezi odesláními — dedup proti dvojkliku)
 *   5. per-e-mail hodinový limit (3 / h)
 *   6. globální pojistka     (OTP_GLOBAL_HOURLY_MAX / h) → při překročení auto-pauza + ALERT
 *
 * Při chybě Redis se rozhoduje FAIL-CLOSED (radši login dočasně nedostupný než
 * rozeslat tisíce e-mailů bez limitu).
 */

// ---- Laděné konstanty ----
const IP_SHORT = { limit: 5, windowMs: 15 * 60_000 }; // 5 / 15 min
const IP_DAILY = { limit: 20, windowMs: 24 * 60 * 60_000 }; // 20 / 24 h
const EMAIL_HOURLY = { limit: 3, windowMs: 60 * 60_000 }; // 3 / 1 h
const EMAIL_COOLDOWN_MS = 60_000; // min. 60 s mezi dvěma odesláními pro stejný e-mail
const GLOBAL_WINDOW_MS = 60 * 60_000; // 1 h
const GLOBAL_AUTOPAUSE_MS = 15 * 60_000; // jak dlouho po překročení globálního stropu pozastavit odesílání

const KILLSWITCH_KEY = 'puls:otp:killswitch'; // ruční vypnutí (admin přes redis-cli, bez TTL)
const AUTOPAUSE_KEY = 'puls:otp:autopause'; // automatická pauza po překročení globálního stropu (TTL)

// ---- Generické (anti-enumeration) hlášky — nikdy neprozrazují existenci účtu ----
const MSG_PAUSED =
  'Přihlášení e-mailem je teď dočasně nedostupné. Použijte prosím Google, nebo to zkuste za chvíli.';
const MSG_IP =
  'Příliš mnoho pokusů z této sítě. Zkuste to prosím později.';
const MSG_CAPTCHA =
  'Ověření, že nejste robot, se nezdařilo. Načtěte stránku znovu a zkuste to.';
const MSG_BUSY =
  'Přihlášení je teď dočasně nedostupné. Zkuste to prosím za chvíli.';

export type OtpGuardDecision =
  | { ok: true }
  /** Zobraz uživateli chybu s daným HTTP statusem (429/503/400). */
  | { ok: false; kind: 'error'; status: number; reason: string; message: string }
  /** Tváříme se jako úspěch a posíláme na /login/verify — ale NIC nového neodesíláme. */
  | { ok: false; kind: 'redirect_verify'; reason: string };

function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** Maskovaný e-mail pro logy (GDPR) — `ab***@domena.cz`. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || !local) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

function cooldownKey(emailHash: string): string {
  return `puls:otp:cd:${emailHash}`;
}

function logBlock(
  reason: string,
  ctx: { ip?: string; email: string; alert?: boolean }
): void {
  const payload = {
    event: 'otp_send_blocked',
    reason,
    ip: ctx.ip ?? 'unknown',
    email: maskEmail(ctx.email),
    emailHash: hashEmail(ctx.email).slice(0, 12),
    ...(ctx.alert ? { alert: true } : {}),
  };
  if (ctx.alert) logger.warn(payload, `[otp-guard] ALERT: ${reason}`);
  else logger.info(payload, `[otp-guard] blocked: ${reason}`);
}

/** Zaloguj úspěšné odeslání kódu (volá login route po odeslání e-mailu). */
export function logOtpSent(ctx: { ip?: string; email: string }): void {
  logger.info(
    {
      event: 'otp_send_ok',
      ip: ctx.ip ?? 'unknown',
      email: maskEmail(ctx.email),
      emailHash: hashEmail(ctx.email).slice(0, 12),
    },
    '[otp-guard] sent'
  );
}

/** Je odesílání OTP pozastavené? (env kill switch | ruční Redis flag | auto-pauza) */
export async function isOtpSendingPaused(): Promise<
  { paused: true; reason: string } | { paused: false }
> {
  if (String(getConfig().OTP_LOGIN_DISABLED ?? '') === '1') {
    return { paused: true, reason: 'env_kill_switch' };
  }
  const r = getRedis();
  const [manual, auto] = await Promise.all([
    r.exists(KILLSWITCH_KEY),
    r.exists(AUTOPAUSE_KEY),
  ]);
  if (manual) return { paused: true, reason: 'manual_kill_switch' };
  if (auto) return { paused: true, reason: 'global_autopause' };
  return { paused: false };
}

/**
 * Uvolni per-e-mail cooldown (volej, když odeslání e-mailu SELHALO — ať uživatel
 * může hned zkusit znovu a 60s blokace ho zbytečně nedrží).
 */
export async function releaseOtpCooldown(email: string): Promise<void> {
  try {
    await getRedis().del(cooldownKey(hashEmail(email)));
  } catch {
    /* best-effort */
  }
}

/**
 * Spusť všechny vrstvy ochrany. `verifyCaptcha` je callback, aby se CAPTCHA
 * ověřovala až po levné IP bráně (a vůbec ne, když je request blokovaný dřív).
 */
export async function guardOtpRequest(args: {
  ip: string | undefined;
  email: string;
  verifyCaptcha: () => Promise<{ ok: boolean }>;
}): Promise<OtpGuardDecision> {
  const { ip, email } = args;
  const ipKey = ip ?? 'unknown';
  const emailHash = hashEmail(email);

  try {
    // 0. Kill switch / auto-pauza
    const paused = await isOtpSendingPaused();
    if (paused.paused) {
      logBlock(paused.reason, {
        ip,
        email,
        alert: paused.reason === 'global_autopause',
      });
      return {
        ok: false,
        kind: 'error',
        status: 503,
        reason: paused.reason,
        message: MSG_PAUSED,
      };
    }

    // 1. per-IP krátké okno (5 / 15 min)
    const ipShort = await rateLimitRedis(
      'otp-ip-15m',
      ipKey,
      IP_SHORT.limit,
      IP_SHORT.windowMs
    );
    if (!ipShort.ok) {
      logBlock('ip_short', { ip, email, alert: true });
      return {
        ok: false,
        kind: 'error',
        status: 429,
        reason: 'ip_short',
        message: MSG_IP,
      };
    }

    // 2. per-IP denní okno (20 / 24 h)
    const ipDaily = await rateLimitRedis(
      'otp-ip-24h',
      ipKey,
      IP_DAILY.limit,
      IP_DAILY.windowMs
    );
    if (!ipDaily.ok) {
      logBlock('ip_daily', { ip, email, alert: true });
      return {
        ok: false,
        kind: 'error',
        status: 429,
        reason: 'ip_daily',
        message: MSG_IP,
      };
    }

    // 3. CAPTCHA (Cloudflare Turnstile) — PŘED jakýmkoli odesláním e-mailu
    const captcha = await args.verifyCaptcha();
    if (!captcha.ok) {
      logBlock('captcha_failed', { ip, email });
      return {
        ok: false,
        kind: 'error',
        status: 400,
        reason: 'captcha_failed',
        message: MSG_CAPTCHA,
      };
    }

    // 4. per-e-mail cooldown (min. 60 s mezi odesláními) — atomicky SET NX PX.
    //    Jako první z e-mailových kontrol, ať dvojklik nevyčerpá hodinový budget.
    const r = getRedis();
    const acquired = await r.set(
      cooldownKey(emailHash),
      '1',
      'PX',
      EMAIL_COOLDOWN_MS,
      'NX'
    );
    if (acquired === null) {
      // Kód byl právě odeslán → nic nového neposíláme, jen pošleme na verify (generic).
      logBlock('cooldown', { ip, email });
      return { ok: false, kind: 'redirect_verify', reason: 'cooldown' };
    }

    // 5. per-e-mail hodinový limit (3 / h)
    const emailHourly = await rateLimitRedis(
      'otp-email-1h',
      emailHash,
      EMAIL_HOURLY.limit,
      EMAIL_HOURLY.windowMs
    );
    if (!emailHourly.ok) {
      logBlock('email_hourly', { ip, email });
      return { ok: false, kind: 'redirect_verify', reason: 'email_hourly' };
    }

    // 6. Globální pojistka (N / h napříč celou appkou)
    const max = getConfig().OTP_GLOBAL_HOURLY_MAX;
    const globalRl = await rateLimitRedis(
      'otp-global-1h',
      'all',
      max,
      GLOBAL_WINDOW_MS
    );
    if (!globalRl.ok) {
      // Auto-pauza: dočasně zastav VŠECHNA odeslání, ať schránku ochráníme dřív než provider.
      await r.set(AUTOPAUSE_KEY, '1', 'PX', GLOBAL_AUTOPAUSE_MS);
      logger.warn(
        {
          event: 'otp_global_brake',
          max,
          autopauseMs: GLOBAL_AUTOPAUSE_MS,
          alert: true,
        },
        '[otp-guard] ALERT: překročen globální hodinový strop OTP — auto-pauza odesílání'
      );
      logBlock('global_brake', { ip, email, alert: true });
      return {
        ok: false,
        kind: 'error',
        status: 503,
        reason: 'global_brake',
        message: MSG_PAUSED,
      };
    }

    return { ok: true };
  } catch (err) {
    // FAIL-CLOSED: když nedokážeme limity vynutit (typicky Redis výpadek),
    // NEROZESÍLÁME e-maily — chráníme schránku.
    logger.error(
      { err: serializeError(err), email: maskEmail(email) },
      '[otp-guard] guard error — fail-closed'
    );
    return {
      ok: false,
      kind: 'error',
      status: 503,
      reason: 'guard_error',
      message: MSG_BUSY,
    };
  }
}
