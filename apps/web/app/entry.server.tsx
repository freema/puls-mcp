import * as Sentry from '@sentry/react-router';
import { createReadableStreamFromReadable } from '@react-router/node';
import { renderToPipeableStream } from 'react-dom/server';
import {
  ServerRouter,
  isRouteErrorResponse,
  type RouterContextProvider,
} from 'react-router';
import type { Params } from 'react-router';
import { logger, serializeError } from '~/lib/logger';
import { ensureScheduler } from '~/lib/scheduler.server';

// Boot in-process schedulers (health-pinger a další joby).
// Idempotent — safe across HMR and repeat imports.
ensureScheduler();

const handleRequest = Sentry.createSentryHandleRequest({
  ServerRouter,
  renderToPipeableStream,
  createReadableStreamFromReadable,
});

export default handleRequest;

const sentryHandleError = Sentry.createSentryHandleError({ logErrors: false });

/**
 * React Router calls this for every error thrown from a loader/action.
 * Without it, errors only reach the ErrorBoundary UI and never hit stdout.
 *
 * Order: log to pino first (always works, even when SENTRY_DSN is unset),
 * then forward to Sentry's handler (no-op when DSN is missing).
 */
export function handleError(
  error: unknown,
  args: {
    request: Request;
    params: Params<string>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: RouterContextProvider | any;
  }
): void {
  const { request } = args;

  if (request.signal.aborted) {
    return;
  }

  const ctx = { url: request.url, method: request.method };

  if (isRouteErrorResponse(error)) {
    const level = error.status >= 500 ? 'error' : 'warn';
    logger[level](
      { ...ctx, status: error.status, statusText: error.statusText, data: error.data },
      'route error response'
    );
  } else {
    logger.error({ ...ctx, err: serializeError(error) }, 'unhandled loader/action error');
  }

  sentryHandleError(error, args);
}
