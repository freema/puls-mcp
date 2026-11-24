import type { Transporter } from 'nodemailer';

let cached: Transporter | null = null;

export function smtpConfigured(env: NodeJS.ProcessEnv): boolean {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();
  return Boolean(host && user && pass);
}

async function buildTransport(env: NodeJS.ProcessEnv): Promise<Transporter> {
  const nodemailer = (await import('nodemailer')).default;
  const host = env.SMTP_HOST?.trim();
  const port = Number(env.SMTP_PORT ?? 587);
  const secure = String(env.SMTP_SECURE ?? 'false') === 'true';
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();

  if (!host || !user || !pass) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'SMTP_HOST/SMTP_USER/SMTP_PASS must be set when using SMTP'
      );
    }
    return nodemailer.createTransport({ jsonTransport: true });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

/** Lazy-load nodemailer so Vite SSR route graphs never eagerly bundle it. */
export async function getSmtpTransport(
  env: NodeJS.ProcessEnv = process.env
): Promise<Transporter> {
  if (!cached) cached = await buildTransport(env);
  return cached;
}

export function getSmtpFrom(env: NodeJS.ProcessEnv): string {
  return (
    env.SMTP_FROM?.trim() ||
    env.EMAIL_FROM?.trim() ||
    'Puls <noreply@puls.local>'
  );
}

/** @internal test helper */
export function resetSmtpTransportForTests(): void {
  cached = null;
}
