/**
 * Structured logging helper sdílený napříč platformními klienty. Žádná doménová
 * znalost — jen jednotný tvar log callbacku (`msg`, optional `meta`). Connector
 * implementace (Shoptet/Upgates) si předají vlastní logger, default jde na
 * `console.info`.
 */
export type LogFn = (msg: string, meta?: Record<string, unknown>) => void;

/** Default logger — `console.info`. Drží jednotný entrypoint pro pozdější DI. */
export const consoleLog: LogFn = (msg, meta) => {
  if (meta === undefined) {
    console.info(msg);
  } else {
    console.info(msg, meta);
  }
};
