import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

export const logger = isDev
  ? pino({
      name: 'web',
      level: (process.env.LOG_LEVEL || undefined) ?? 'debug',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l' },
      },
    })
  : pino({
      name: 'web',
      level: (process.env.LOG_LEVEL || undefined) ?? 'info',
    });

/**
 * Serialize unknown error into a stable shape for structured logging.
 * Use as `logger.error({ err: serializeError(err), ...ctx }, 'msg')`.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...((err as { cause?: unknown }).cause
        ? { cause: serializeError((err as { cause?: unknown }).cause) }
        : {}),
    };
  }
  return { message: String(err) };
}
