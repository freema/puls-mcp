import { getConfig } from '~/lib/config';
import { logger } from '~/lib/logger';
import {
  getSmtpFrom,
  getSmtpTransport,
  smtpConfigured,
} from '~/lib/email/smtp.server';
import { renderLoginCodeEmail } from '~/lib/email/templates/login-code.server';

function logMailEnabled(): boolean {
  return String(process.env.PULS_LOG_MAIL ?? '') === '1';
}

function resendConfigured(env: ReturnType<typeof getConfig>): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

/** Deliver e-mail login code: SMTP → Resend → dev log. */
export async function sendLoginCodeEmail(args: {
  email: string;
  code: string;
}): Promise<void> {
  const env = getConfig();
  const log = logger;
  const { subject, html, text } = renderLoginCodeEmail({ code: args.code });

  if (smtpConfigured(process.env)) {
    const t = await getSmtpTransport();
    await t.sendMail({
      from: getSmtpFrom(process.env),
      to: args.email,
      subject,
      text,
      html,
    });
    if (logMailEnabled()) {
      log.info({ to: args.email, subject }, '[mail] SMTP login code sent');
    }
    return;
  }

  if (resendConfigured(env)) {
    const resend = await import('resend');
    const client = new resend.Resend(env.RESEND_API_KEY!);
    const { error } = await client.emails.send({
      from: env.EMAIL_FROM!,
      to: args.email,
      subject,
      html,
      text,
    });
    if (error) {
      log.error({ error }, 'Resend login code failed');
      throw new Error('Nepodařilo se odeslat e-mail');
    }
    return;
  }

  if (env.NODE_ENV !== 'production') {
    log.info(
      { email: args.email, code: args.code },
      'login code (nakonfiguruj SMTP_* nebo RESEND_API_KEY + EMAIL_FROM)'
    );
    return;
  }

  throw new Error(
    'Pro produkci nastavte SMTP_HOST/SMTP_USER/SMTP_PASS nebo RESEND_API_KEY + EMAIL_FROM'
  );
}
