// @puls/ecommerce-common — doménově neutrální mechanika sdílená platformními
// klienty: retry interceptory (401/423/429), token-cache engine, structured
// logging, mapper helpery. ŽÁDNÁ Shoptet/Upgates sémantika — vše konfigurovatelné.
// Nezávislé na @puls/shoptet-client.

export type { LogFn } from './logging.js';
export { consoleLog } from './logging.js';

export { toNumber } from './mappers.js';

export {
  applyRetryInterceptors,
  type RetryInterceptorOptions,
} from './retry.js';

export {
  createTokenCache,
  isAccessTokenFresh,
  type TokenCache,
  type TokenCacheOptions,
  type FreshToken,
} from './token-cache.js';
