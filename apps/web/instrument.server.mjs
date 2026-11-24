// Loaded via NODE_OPTIONS='--import ./instrument.server.mjs' before the app boots.
// Sentry must be initialized here (before any other module imports) so its
// auto-instrumentation can hook into HTTP/DB drivers correctly.
//
// If SENTRY_DSN is not set, init() is skipped — the SDK becomes a no-op so
// captureException() calls elsewhere are safe.

import * as Sentry from '@sentry/react-router';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    sendDefaultPii: true,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
  });
}
