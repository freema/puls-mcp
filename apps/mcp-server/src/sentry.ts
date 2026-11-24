import * as Sentry from '@sentry/node';
import { logger } from './logger.js';

let initialized = false;

/**
 * Initialise Sentry for the MCP server. No-op when SENTRY_DSN is unset
 * so dev environments stay clean. Must be called BEFORE express() so
 * Sentry's auto-instrumentation hooks into HTTP/Express on require.
 */
export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('SENTRY_DSN not set — Sentry disabled');
    initialized = true;
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'unknown',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    sendDefaultPii: false,
  });
  logger.info({ environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV }, 'Sentry initialised');
  initialized = true;
}

export { Sentry };
