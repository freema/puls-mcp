import { getConfig } from '~/lib/config';
import { logger } from '~/lib/logger';
import {
  getSmtpFrom,
  getSmtpTransport,
  smtpConfigured,
} from '~/lib/email/smtp.server';
import type { RenderedEmail } from '~/lib/email/templates/login-code.server';

async function sendRendered(to: string, msg: RenderedEmail): Promise<void> {
  const env = getConfig();

  if (smtpConfigured(process.env)) {
    const t = await getSmtpTransport();
    await t.sendMail({
      from: getSmtpFrom(process.env),
      to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return;
  }

  if (env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim()) {
    const resend = await import('resend');
    const client = new resend.Resend(env.RESEND_API_KEY);
    const { error } = await client.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) {
      logger.error({ error }, 'Resend trial email failed');
      throw new Error('Trial e-mail send failed');
    }
    return;
  }

  if (env.NODE_ENV !== 'production') {
    logger.info({ to, subject: msg.subject }, 'trial email (no SMTP/Resend)');
    return;
  }

  throw new Error('SMTP nebo RESEND musí být nakonfigurováno pro trial emaily');
}

export { sendRendered as sendTrialEmail };
